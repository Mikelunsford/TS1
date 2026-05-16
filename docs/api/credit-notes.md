# Credit Notes API

Wave 5 ships the credit-notes surface inside the `invoicing-api` Edge Function bundle under `https://<project>.functions.supabase.co/invoicing-api/credit-notes/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply to every endpoint below. This file is the per-resource delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts` (byte-mirrored to `apps/web/src/lib/types.ts`).
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`.
- Money is integer cents on the wire (field names end in `_cents`).
- Timestamps are ISO-8601 with `Z`; `issue_date` is a calendar `date` string (`YYYY-MM-DD`).
- Bundle `invoicing-api` enforces `verify_jwt = true`.

## RBAC at the bundle

The credit-notes routes gate per-handler via `requireCap(caller, '<capability>')` against `_shared/capabilities.ts`:

- `org_owner`, `org_admin` — full reach.
- `accounting` — read, write, issue, apply.
- `sales`, `ops`, `viewer` — read only.
- `customer_user` — read own (RLS Pattern C scoped to the customer's row).

## State machine

Prod `credit_notes.status` text CHECK (four values): `draft`, `issued`, `applied`, `voided`. `voided` is terminal.

Legal transitions (enforced by `_shared/workflow.ts#CREDIT_NOTE_TRANSITIONS`):

| From | To |
|---|---|
| `draft` | `issued`, `voided` |
| `issued` | `applied`, `voided` |
| `applied` | `voided` |
| `voided` | _(terminal)_ |

`from === to` is always legal (idempotent). The `applied → applied` self-transition is the steady-state path for additional `/apply` calls. Illegal transitions return **409 STATE_CONFLICT** with `details.code = 'STATE_TRANSITION_ILLEGAL'`.

## Reason enum

`credit_notes.reason` is a nullable text CHECK (five values): `refund`, `adjustment`, `write_off`, `duplicate`, `other`. Set at create time; not the same as a void reason.

## No `void_reason` column

Unlike `payments` (which has `void_reason text`), `credit_notes` has no `void_reason` column. The void payload accepts a `reason` string for caller-side accountability, but the row only stamps `voided_at`. The reason text is logged in a notes-only fashion server-side; Phase 17 audit enrichment will capture it in the audit log.

## Apply does NOT mutate invoice.paid_cents

The apply handler stamps the link (`credit_notes.invoice_id` if it was previously NULL), bumps `credit_notes.applied_cents` by the supplied amount, and transitions the credit note to `applied`. It **does NOT** mutate the parent invoice's `paid_cents` / `balance_cents` / `payment_status`. The schema-master §9.6 synthetic-payment-row strategy is not viable on prod (`payments.payment_method_id` is a uuid FK, not a text discriminator; `payments.invoice_id` is NOT NULL with strict currency-match semantics). The invoice-side rollup of credit notes is **deferred to Phase 9** (likely a new `credit_note_allocations` join table).

## Credit notes

### list-credit-notes / get-credit-note

`GET /invoicing-api/credit-notes`
`GET /invoicing-api/credit-notes/{id}`

- RBAC: `credit_notes.read` (customer_user is RLS-gated to their own org's rows).
- Idempotent: yes (GET).
- Filters: `q` (free-text matches `credit_note_number` + `notes`), `customer_id`, `invoice_id`, `status` (multi-value), `reason`, `currency_code`, `from` / `to` (date range on `issue_date`).
- Pagination: `limit` (default 50, max 200), opaque `cursor`.
- Sort: `created_at DESC, id DESC`.

```ts
export const CreditNoteSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  credit_note_number: z.string().min(1),
  customer_id: UuidSchema,
  invoice_id: UuidSchema.nullable(),               // nullable — floating credit notes have no parent
  issue_date: z.string(),
  status: CreditNoteStatusSchema,                  // 'draft' | 'issued' | 'applied' | 'voided'
  reason: CreditNoteReasonSchema.nullable(),       // 'refund' | 'adjustment' | 'write_off' | 'duplicate' | 'other'
  currency_code: z.string().length(3),
  amount_cents: CentsSchema,
  applied_cents: CentsSchema,                      // CHECK applied_cents <= amount_cents
  notes: z.string().nullable(),
  voided_at: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

### create-credit-note

`POST /invoicing-api/credit-notes`

- RBAC: `credit_notes.write`.
- Idempotent header required.
- Creates a `draft` with `applied_cents = 0`. The server picks `credit_note_number` via `next_doc_number('credit_note')`.

```ts
export const CreditNoteCreateSchema = z.object({
  customer_id: UuidSchema,
  currency_code: z.string().length(3),
  amount_cents: z.number().int().nonnegative(),
  invoice_id: UuidSchema.nullable().optional(),
  reason: CreditNoteReasonSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  issue_date: z.string().date().optional(),       // defaults to today server-side
});
```

**No `source_invoice_id`** — the column is named `invoice_id` (nullable, since a credit note can be floating against a customer without a specific parent invoice).

### Workflow transitions

| Route | Method | RBAC | Body schema | Effect |
|---|---|---|---|---|
| `/credit-notes/{id}/issue` | POST | `credit_notes.issue` | `CreditNoteIssueSchema` (`{}`) | `draft → issued` |
| `/credit-notes/{id}/apply` | POST | `credit_notes.apply` | `{ invoice_id, amount_cents }` | `issued → applied` (first call); stays `applied` on subsequent calls. Stamps `credit_notes.invoice_id` if previously NULL; bumps `applied_cents`. Does NOT mutate parent invoice (Wave 5 deferral). |
| `/credit-notes/{id}/void` | POST | `credit_notes.write` | `{ reason }` | `(non-terminal) → voided`; stamps `voided_at`. Reason is wire-only — there is no `void_reason` column on the row. |

All three require `Idempotency-Key`.

```ts
export const CreditNoteIssueSchema = z.object({}).strict();

export const CreditNoteApplySchema = z.object({
  invoice_id: UuidSchema,
  amount_cents: z.number().int().positive(),     // <= (amount_cents - applied_cents)
});

export const CreditNoteVoidSchema  = z.object({
  reason: z.string().min(1).max(2000),
});
```

```bash
# Issue a draft credit note
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{}' \
  "$BASE/invoicing-api/credit-notes/$CNID/issue"

# Apply $50 of a credit note to an invoice
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"invoice_id":"'$IID'","amount_cents":5000}' \
  "$BASE/invoicing-api/credit-notes/$CNID/apply"

# Void
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"reason":"Issued in error"}' \
  "$BASE/invoicing-api/credit-notes/$CNID/void"
```

## Errors

Every endpoint returns the universal envelope:

```json
{ "error": { "code": "<CODE>", "message": "<readable>", "details": { /* optional */ } } }
```

Domain codes for `invoicing-api` credit-notes on top of the universal set:

| Code | HTTP | When |
|---|---|---|
| `STATE_CONFLICT` (`details.code = 'STATE_TRANSITION_ILLEGAL'`) | 409 | Workflow handler called against an illegal `from → to` |
| `STATE_CONFLICT` (`details.code = 'CREDIT_NOTE_OVER_APPLIED'`) | 409 | `/apply` body `amount_cents` would push `applied_cents > amount_cents` |
| `STATE_CONFLICT` (`details.code = 'CREDIT_NOTE_CURRENCY_MISMATCH'`) | 409 | `/apply` invoice's `currency_code` doesn't match the credit note's |
| `STATE_CONFLICT` (`details.code = 'CREDIT_NOTE_VOIDED_LOCKED'`) | 409 | Any write against a credit note with `voided_at IS NOT NULL` |

## Versioning

The `invoicing-api` bundle ships in Wave 5 PR #46. Schema-impacting changes ride `migrate.yml` (currently at `0052`).
