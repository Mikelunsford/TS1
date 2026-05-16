# Credit Note Allocations API

Wave 6 (PR #56, migration 0056) lands Phase 9: a new `credit_note_allocations` ledger table that owns the invoice-side rollup of credit notes. The Wave 5 limitation — `applyCreditNote` stamped the link and bumped `credit_notes.applied_cents` but did NOT mutate `invoices.paid_cents` / `invoices.balance_cents` — is closed (R-W5-CN-01).

The universal envelope, headers, idempotency, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply.

## Conventions in this document

- Allocations are written via `POST /credit-notes/{id}/apply` — there is no direct `/credit-note-allocations` write surface.
- Reads are exposed via `GET /credit-notes/{id}/allocations` and `GET /invoices/{id}/allocations`.
- Bundle `invoicing-api` enforces `verify_jwt = true`.

## What an allocation is

A `credit_note_allocations` row is one ledger entry: "this credit note covered this amount of this invoice." The table is the source of truth for two derived quantities maintained by triggers:

- `credit_notes.applied_cents` — recomputed as `SUM(amount_cents)` across all non-deleted allocations of the credit note.
- `invoices.balance_cents` — `total_cents − paid_cents − SUM(credit_note_allocations.amount_cents WHERE invoice_id = invoices.id AND deleted_at IS NULL)`.

`invoices.paid_cents` stays payments-only — credit note coverage is a separate ledger from cash receipts, by design (audit clarity; Phase 12 GL pass needs the two columns split).

## Schema

```ts
export const CreditNoteAllocationSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  credit_note_id: UuidSchema,
  invoice_id: UuidSchema,
  amount_cents: CentsSchema,                  // CHECK amount_cents > 0
  created_at: TimestampSchema,
  created_by: UuidSchema.nullable(),
  deleted_at: z.string().nullable(),          // soft delete; void flows set this
});
```

Table constraints (prod, migration 0056):

- `PRIMARY KEY (id)`.
- `FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id)`.
- `FOREIGN KEY (invoice_id) REFERENCES invoices(id)`.
- `UNIQUE (credit_note_id, invoice_id)` — one row per credit-note × invoice pair. A second `/apply` against the same pair returns **409 STATE_CONFLICT** (`details.code = 'ALLOCATION_ALREADY_EXISTS'`); split the credit note across invoices if you need partial coverage of two invoices from one CN.
- `CHECK (amount_cents > 0)`.

## RBAC

The handlers gate per `requireCap(caller, '<capability>')`:

- `org_owner`, `org_admin`, `accounting` — `/apply` write.
- `sales`, `ops`, `viewer` — read only.
- `customer_user` — Pattern C scoped read (visible only if the parent invoice belongs to the caller's customer row).

## Apply behavior change

### Pre-Wave-6 (Wave 5 handler)

`POST /invoicing-api/credit-notes/{id}/apply` with body `{ invoice_id, amount_cents }`:

1. Updated `credit_notes.invoice_id` (if previously NULL) + `applied_cents += amount_cents`.
2. Transitioned `status → 'applied'` once `applied_cents == amount_cents`.
3. Did NOT touch the parent invoice. The user-facing `invoice.balance_cents` was wrong by exactly `applied_cents` until the deferred Phase 9 fix.

### Post-Wave-6 (Phase 9 handler)

Same wire shape, same idempotency contract — different DB side effect:

1. Handler INSERTs into `credit_note_allocations (org_id, credit_note_id, invoice_id, amount_cents, created_by)`.
2. `tg_credit_note_allocations_sync_credit_note` AFTER INSERT/UPDATE/DELETE recomputes `credit_notes.applied_cents := SUM(amount_cents WHERE deleted_at IS NULL)` and flips `status='applied'` once `applied_cents == amount_cents`.
3. `tg_credit_note_allocations_recompute_invoice` AFTER INSERT/UPDATE/DELETE calls `recompute_invoice_totals(NEW.invoice_id)`, which now subtracts the new `SUM(credit_note_allocations.amount_cents)` from `balance_cents`.

The handler no longer hand-bumps `applied_cents` or runs a `fullyApplied` check — the trigger owns both. The bulk-replace + manual rollup pattern from Wave 5 is gone.

A 23505 unique-violation on `(credit_note_id, invoice_id)` is caught and surfaced as **409 STATE_CONFLICT** with `details.code = 'ALLOCATION_ALREADY_EXISTS'`.

## Routes

### list-credit-note-allocations

`GET /invoicing-api/credit-notes/{id}/allocations`

- RBAC: `credit_notes.read`.
- Idempotent: yes.
- Sort: `created_at ASC`.

```bash
curl -H "Authorization: Bearer $JWT" \
  "$BASE/invoicing-api/credit-notes/$CNID/allocations"
```

### list-invoice-allocations

`GET /invoicing-api/invoices/{id}/allocations`

- RBAC: `invoices.read`.
- Idempotent: yes.
- Sort: `created_at ASC`.
- Surfaces every credit-note allocation that touches this invoice. The invoice detail's **Credit Notes** tab consumes this.

### apply-credit-note (allocation INSERT)

`POST /invoicing-api/credit-notes/{id}/apply`

- RBAC: `credit_notes.apply`.
- Idempotent header required.
- Body schema unchanged from Wave 5:

```ts
export const CreditNoteApplySchema = z.object({
  invoice_id: UuidSchema,
  amount_cents: z.number().int().positive(),     // <= (amount_cents - applied_cents)
});
```

- Currency parity: invoice and credit note must agree on `currency_code` — otherwise **409 STATE_CONFLICT** (`details.code = 'CREDIT_NOTE_CURRENCY_MISMATCH'`).
- Over-apply guard: `amount_cents + current_applied > credit_note.amount_cents` → **409 STATE_CONFLICT** (`details.code = 'CREDIT_NOTE_OVER_APPLIED'`).

```bash
# Apply $50 of a credit note to an invoice
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"invoice_id":"'$IID'","amount_cents":5000}' \
  "$BASE/invoicing-api/credit-notes/$CNID/apply"
```

Sample success response:

```json
{
  "data": {
    "allocation": {
      "id": "a3...",
      "credit_note_id": "cn...",
      "invoice_id": "in...",
      "amount_cents": 5000,
      "created_at": "2026-05-16T17:32:01.123Z"
    },
    "credit_note_applied_cents": 5000,
    "invoice_balance_cents": 145000
  }
}
```

## Void semantics

`POST /credit-notes/{id}/void` does NOT hard-delete the allocations. The handler stamps `deleted_at = now()` on every allocation row owned by the credit note; both triggers re-run with the soft-deleted rows filtered out, restoring `invoice.balance_cents` and clearing `credit_notes.applied_cents`. The credit note transitions to `voided`.

## Errors

| Code | HTTP | When |
|---|---|---|
| `STATE_CONFLICT` (`details.code = 'ALLOCATION_ALREADY_EXISTS'`) | 409 | A second `/apply` against the same `(credit_note_id, invoice_id)` pair. |
| `STATE_CONFLICT` (`details.code = 'CREDIT_NOTE_OVER_APPLIED'`) | 409 | `amount_cents` would push `applied_cents > amount_cents`. |
| `STATE_CONFLICT` (`details.code = 'CREDIT_NOTE_CURRENCY_MISMATCH'`) | 409 | Invoice and credit note have different `currency_code`. |
| `STATE_CONFLICT` (`details.code = 'CREDIT_NOTE_VOIDED_LOCKED'`) | 409 | Apply against a credit note with `voided_at IS NOT NULL`. |
| `NOT_FOUND` | 404 | Credit note or invoice not visible to the caller. |

## Versioning

The `invoicing-api` bundle ships the Phase 9 handler swap in PR #56. The `credit_note_allocations` table + extended `recompute_invoice_totals` ride migration `0056`. Bundle redeploys to v36 via `deploy-functions.yml`.
