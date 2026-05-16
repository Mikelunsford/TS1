# Invoices API

Wave 5 ships the `invoicing-api` Edge Function bundle. It exposes invoice headers, invoice line items, lifecycle workflow, the invoice-versions mirror, plus the sibling payments and credit-notes resources under `https://<project>.functions.supabase.co/invoicing-api/...`. This file documents the invoice + invoice-line-item surface; see `payments.md` and `credit-notes.md` for the other two resources in the same bundle.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply to every endpoint below. This file is the per-resource delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts` (single source of truth, byte-mirrored to `apps/web/src/lib/types.ts`).
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`. Same key + same body hash replays the original response with `Idempotent-Replay: true`. Same key + different body returns `409 IDEMPOTENCY_CONFLICT`.
- Money is integer cents on the wire (field names end in `_cents`).
- Timestamps are ISO-8601 with `Z` (the prod DB columns are `timestamptz`); `issue_date` and `due_date` are calendar `date` strings (`YYYY-MM-DD`).
- Bundle `invoicing-api` enforces `verify_jwt = true`; every request carries a Supabase bearer token.

## RBAC at the bundle

The `invoicing-api` bundle gates per-handler via `requireCap(caller, '<capability>')` against `_shared/capabilities.ts`:

- `org_owner`, `org_admin` — full reach.
- `accounting` — read, write, send, void, refund, cancel.
- `sales`, `ops`, `viewer` — read only.
- `customer_user` — read own (RLS Pattern C scoped to the customer's row).

## State machine

Prod `invoices.status` text CHECK (nine values): `draft`, `pending`, `sent`, `partially_paid`, `paid`, `overdue`, `refunded`, `cancelled`, `on_hold`. The dispatch-text contract verbs `issued` and `void` map to prod values: "issue" is the `draft → pending` transition (route `/submit`); "void" is the `* → cancelled` transition (route `/void`).

Legal transitions (enforced by `_shared/workflow.ts#INVOICE_TRANSITIONS`):

| From | To |
|---|---|
| `draft` | `pending`, `cancelled` |
| `pending` | `sent`, `cancelled`, `on_hold` |
| `sent` | `partially_paid`, `paid`, `overdue`, `cancelled`, `on_hold` |
| `partially_paid` | `paid`, `overdue`, `refunded` |
| `paid` | `refunded` |
| `overdue` | `partially_paid`, `paid`, `cancelled` |
| `on_hold` | `pending`, `sent`, `cancelled` |
| `refunded` | _(terminal)_ |
| `cancelled` | _(terminal)_ |

`from === to` is always legal (idempotent). Illegal transitions return **409 STATE_CONFLICT** with `details.code = 'STATE_TRANSITION_ILLEGAL'`.

Transitions to `partially_paid` / `paid` are normally driven by the `recompute_invoice_totals` trigger off `payments` inserts, not by direct workflow calls.

## Payment-status rollup

`invoices.payment_status` is a separate text CHECK (`unpaid` | `partially_paid` | `paid`) maintained by the recompute trigger. Read-only on the API surface (no write route).

## Recurring cadence

`invoices.recurring` is a nullable text CHECK on the invoice row itself (NOT a separate recurring-config table): `daily` | `weekly` | `monthly` | `quarterly` | `annually`. Non-recurring invoices leave the column NULL. Set it at create time via `InvoiceCreate.recurring`; once set, the column is patchable while the invoice is in `draft`.

## Invoices

### list-invoices / get-invoice

`GET /invoicing-api/invoices`
`GET /invoicing-api/invoices/{id}`

- RBAC: `invoices.read` (customer_user is RLS-gated to their own org's rows).
- Idempotent: yes (GET).
- Filters: `q` (free-text matches `invoice_number` + `customer_name_snapshot`), `status` (multi-value), `payment_status`, `customer_id`, `currency_code`, `from` / `to` (date range on `issue_date`).
- Pagination: `limit` (default 50, max 200), opaque `cursor`.
- Sort: `created_at DESC, id DESC`.

```ts
export const InvoiceSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  invoice_number: z.string().min(1),
  customer_id: UuidSchema,
  customer_name_snapshot: z.string().min(1),     // denormalized NOT NULL on the DB
  project_id: UuidSchema.nullable(),
  quote_id: UuidSchema.nullable(),
  status: InvoiceStateSchema,                    // 9 values; see state machine
  payment_status: InvoicePaymentStatusSchema,    // 'unpaid' | 'partially_paid' | 'paid'
  recurring: InvoiceRecurringSchema.nullable(),  // 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually'
  content: z.string().nullable(),
  notes: z.string().nullable(),
  issue_date: z.string(),                        // YYYY-MM-DD
  due_date: z.string(),                          // YYYY-MM-DD
  state_changed_at: TimestampSchema,
  approved: z.boolean(),
  is_overdue: z.boolean(),
  converted_from_type: z.enum(['quote', 'project']).nullable(),
  converted_from_id: UuidSchema.nullable(),
  currency_code: z.string().length(3),
  exchange_rate: z.union([z.number(), z.string()]).nullable(),
  subtotal_cents: CentsSchema,
  discount_cents: CentsSchema,
  tax_cents: CentsSchema,
  total_cents: CentsSchema,
  paid_cents: CentsSchema,
  balance_cents: CentsSchema.nullable(),         // populated by recompute_invoice_totals trigger
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: z.union([z.number(), z.string()]).nullable(),
  pdf_path: z.string().nullable(),               // reserved for Phase 19
  external_ref: z.string().nullable(),
  sent_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  cancellation_reason: z.string().nullable(),
  pending_at: z.string().nullable(),
  on_hold_at: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

```bash
curl -H "Authorization: Bearer $JWT" \
  "$BASE/invoicing-api/invoices?status=pending&status=sent&limit=25"
```

### create-invoice

`POST /invoicing-api/invoices`

- RBAC: `invoices.write`.
- Idempotent header required.
- Creates a `draft`. The server picks `invoice_number` via `next_doc_number('invoice')`.

```ts
export const InvoiceCreateSchema = z.object({
  customer_id: UuidSchema,
  due_date: z.string().date(),                                  // YYYY-MM-DD; required
  currency_code: z.string().length(3),                          // required
  quote_id: UuidSchema.nullable().optional(),
  project_id: UuidSchema.nullable().optional(),
  issue_date: z.string().date().optional(),                     // defaults to today server-side
  customer_name_snapshot: z.string().min(1).max(200).optional(),
  notes: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  recurring: InvoiceRecurringSchema.nullable().optional(),
  exchange_rate: z.number().positive().nullable().optional(),
  tax_id: UuidSchema.nullable().optional(),
  tax_rate_snapshot: z.number().min(0).max(1).nullable().optional(),
  external_ref: z.string().max(120).nullable().optional(),
});
```

**No `source_project_id`, `notes_customer`, `terms`, or `tax_inclusive`** — those exist in the dispatch text but not on the prod table. The lineage columns are `project_id` + `quote_id` (the canonical links) and `converted_from_type` + `converted_from_id` (the audit-trail counterparts, written by the from-quote / from-project handlers). There is no `tax_inclusive` flag on prod.

### patch-invoice

`PATCH /invoicing-api/invoices/{id}`

- RBAC: `invoices.write`.
- Idempotent: yes.
- Only allowed while `status = 'draft'`. Outside `draft` returns **409 STATE_CONFLICT** with `details.code = 'INVOICE_LOCKED_AFTER_ISSUE'`.

```ts
export const InvoicePatchSchema = InvoiceCreateSchema.partial();
```

### Workflow transitions

| Route | Method | RBAC | Body schema | Effect |
|---|---|---|---|---|
| `/invoices/{id}/submit` | POST | `invoices.write` | `InvoiceSubmitSchema` (`{}`) | `draft → pending`; stamps `pending_at` |
| `/invoices/{id}/send` | POST | `invoices.send` | `{ email?, message? }` | `(pending\|on_hold\|sent) → sent`; stamps `sent_at` on first transition. Activity row only — Phase 19 wires actual email. |
| `/invoices/{id}/void` | POST | `invoices.void` | `{ reason }` | `(non-terminal) → cancelled`; stamps `cancelled_at` + `cancellation_reason`. **Returns 409 INVOICE_HAS_PAYMENTS if non-voided payments roll up.** |
| `/invoices/{id}/hold` | POST | `invoices.write` | `{ reason? }` | `(pending\|sent) → on_hold`; stamps `on_hold_at` |
| `/invoices/{id}/release` | POST | `invoices.write` | `{ reason? }` | `on_hold → pending`; clears `on_hold_at` |
| `/invoices/{id}/duplicate` | POST | `invoices.write` | `InvoiceDuplicateSchema` (`{}`) | Clones header + lines as a new `draft` with a fresh `invoice_number` |
| `/invoices/from-quote` | POST | `invoices.write` | `{ quote_id, due_date }` | Calls `convert_quote_to_invoice(uuid, date)` RPC (added in 0052). Source quote must be `approved` or `project_pending`. |
| `/invoices/from-project` | POST | `invoices.write` | `{ project_id, due_date }` | Spawns a `draft` invoice linked to the project. |

All eight require `Idempotency-Key`.

```ts
export const InvoiceSubmitSchema   = z.object({}).strict();
export const InvoiceSendSchema     = z.object({
  email: z.string().email().optional(),
  message: z.string().max(8000).optional(),
});
export const InvoiceVoidSchema     = z.object({ reason: z.string().min(1).max(2000) });
export const InvoiceHoldSchema     = z.object({ reason: z.string().max(2000).optional() });
export const InvoiceReleaseSchema  = z.object({ reason: z.string().max(2000).optional() });
export const InvoiceDuplicateSchema = z.object({}).strict();

export const InvoiceConvertFromQuoteSchema   = z.object({
  quote_id: UuidSchema,
  due_date: z.string().date(),
});
export const InvoiceConvertFromProjectSchema = z.object({
  project_id: UuidSchema,
  due_date: z.string().date(),
});
```

```bash
# Submit a draft
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{}' \
  "$BASE/invoicing-api/invoices/$IID/submit"

# Convert an approved quote to an invoice
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"quote_id":"'$QID'","due_date":"2026-06-30"}' \
  "$BASE/invoicing-api/invoices/from-quote"

# Void an invoice
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"reason":"Customer disputed before send"}' \
  "$BASE/invoicing-api/invoices/$IID/void"
```

### get-invoice-pdf

`GET /invoicing-api/invoices/{id}/pdf`

- RBAC: `invoices.read`.
- **Returns 501** with `error.code = 'PDF_NOT_YET_AVAILABLE'`. Phase 19 will wire the generator. Route is exposed so SPA buttons can render their disabled state from a real handler rather than a feature flag.

### list-invoice-versions

`GET /invoicing-api/invoices/{id}/versions`

- RBAC: `invoices.read`.
- Idempotent: yes (GET).
- Reads `invoice_versions` mirror rows for the invoice, sorted `version_number DESC`. The mirror is populated by the `create_v1_for_invoice` AFTER INSERT trigger and `mirror_invoice_to_current_version` AFTER UPDATE trigger (both added in migration 0052).

```ts
export const InvoiceVersionSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  invoice_id: UuidSchema,
  version_number: z.number().int().nonnegative(),
  status: InvoiceStateSchema,
  payment_status: InvoicePaymentStatusSchema,
  issue_date: z.string(),
  due_date: z.string(),
  notes: z.string().nullable(),
  currency_code: z.string().length(3),
  subtotal_cents: CentsSchema,
  discount_cents: CentsSchema,
  tax_cents: CentsSchema,
  total_cents: CentsSchema,
  paid_cents: CentsSchema,
  created_at: TimestampSchema,
});
```

## Invoice line items

Resource: `/invoices/{invoice_id}/line-items`. Wave 5 uses a **bulk replace** semantic for the POST (the server deletes all existing lines and inserts the supplied set); single-line append / patch / delete / reorder routes are also exposed.

Per-line tax math (F-Wave5-02 half-even rounding):

```
line_subtotal_cents = round(quantity * unit_price_cents) - discount_cents
tax_amount_cents    = roundHalfEven(line_subtotal_cents * tax_rate_snapshot)
line_total_cents    = line_subtotal_cents + tax_amount_cents
```

After every line mutation the DB recompute trigger on `invoice_line_items` AIUD rolls totals up to the parent invoice automatically — handlers do NOT manually update the parent (unlike quotes-api, which recomputes inline because there is no trigger for quote totals). The trigger uses the same half-even rule the SPA preview uses, so client-side and server-side totals agree byte-for-byte.

### list-invoice-lines

`GET /invoicing-api/invoices/{invoice_id}/line-items`

- RBAC: `invoices.read`.
- Idempotent: yes (GET).
- Sort: `position ASC`.

```ts
export const InvoiceLineSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  invoice_id: UuidSchema,
  invoice_version_id: UuidSchema.nullable(),
  item_id: UuidSchema.nullable(),
  description: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),    // numeric(14,4)
  unit: z.string().nullable(),                    // free-text label, NOT a unit_id FK
  unit_price_cents: CentsSchema,
  unit_cost_cents: CentsSchema,
  discount_cents: CentsSchema,                    // per-line cents (NOT a percent)
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: z.union([z.number(), z.string()]).nullable(),
  tax_amount_cents: CentsSchema,
  line_total_cents: CentsSchema,
  position: z.number().int().nonnegative(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,                    // (quote_line has no updated_at; invoice_line does)
});
```

### replace-invoice-lines / append-invoice-line

`POST /invoicing-api/invoices/{invoice_id}/line-items`
`POST /invoicing-api/invoices/{invoice_id}/line-items/append`

- RBAC: `invoices.write`.
- Idempotent header required.
- Parent invoice must be in `draft`; otherwise **409 STATE_CONFLICT** with `details.code = 'INVOICE_LOCKED_AFTER_ISSUE'`.

```ts
export const InvoiceLineUpsertSchema = z.object({
  item_id: UuidSchema.nullable().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unit: z.string().max(40).nullable().optional(),
  unit_price_cents: z.number().int().nonnegative(),
  unit_cost_cents: z.number().int().nonnegative().default(0),
  discount_cents: z.number().int().nonnegative().default(0),
  tax_id: UuidSchema.nullable().optional(),
  position: z.number().int().nonnegative(),
});

export const InvoiceLineReplaceSchema = z.object({
  lines: z.array(InvoiceLineUpsertSchema).max(500),
});
```

```bash
# Replace every line on a draft invoice
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"lines":[{"description":"Co-pack labor","quantity":120,"unit":"hour","unit_price_cents":7500,"unit_cost_cents":4500,"discount_cents":0,"position":0}]}' \
  "$BASE/invoicing-api/invoices/$IID/line-items"
```

### patch-invoice-line / delete-invoice-line

`PATCH /invoicing-api/invoices/{invoice_id}/line-items/{line_id}`
`DELETE /invoicing-api/invoices/{invoice_id}/line-items/{line_id}`

- RBAC: `invoices.write`.
- Same parent-locked guard.
- PATCH body: `InvoiceLineUpsertSchema.partial()`.
- DELETE is hard at the line level — `invoice_versions` is the audit trail for header state; line history before issue is not preserved.

### reorder-invoice-lines

`POST /invoicing-api/invoices/{invoice_id}/line-items/reorder`

- RBAC: `invoices.write`.
- Two-pass negative-shift safe under any future `UNIQUE(invoice_id, position)` constraint.

```ts
export const InvoiceLineReorderSchema = z.object({
  line_ids: z.array(UuidSchema).min(1).max(500),
});
```

## Errors

Every endpoint returns the universal envelope:

```json
{ "error": { "code": "<CODE>", "message": "<readable>", "details": { /* optional */ } } }
```

Domain codes for `invoicing-api` invoices on top of the universal set:

| Code | HTTP | When |
|---|---|---|
| `STATE_CONFLICT` (`details.code = 'STATE_TRANSITION_ILLEGAL'`) | 409 | Workflow handler called against an illegal `from → to` |
| `STATE_CONFLICT` (`details.code = 'INVOICE_LOCKED_AFTER_ISSUE'`) | 409 | PATCH or line-item write when `status != 'draft'` |
| `STATE_CONFLICT` (`details.code = 'INVOICE_HAS_PAYMENTS'`) | 409 | `/void` called when non-voided payments roll up to the invoice |
| `STATE_CONFLICT` (`details.code = 'CONVERT_QUOTE_WRONG_STATUS'`) | 409 | `/from-quote` called against a quote not in `approved` or `project_pending` |
| `PDF_NOT_YET_AVAILABLE` | 501 | `GET /invoices/{id}/pdf` (Phase 19 surface) |

## Versioning

The `invoicing-api` bundle ships in Wave 5 PR #46. Schema-impacting changes ride `migrate.yml` (currently at `0052`).
