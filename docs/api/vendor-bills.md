# Vendor bills API

Wave 7 (PR #61) ships the `/vendor-bills` resource under the `vendors-api` bundle. Vendor bills are AP-side header-only records (no `vendor_bill_line_items` table in prod, D-W7-6). The `balance_cents` field is maintained by a BIU trigger added in migration 0058.

Base URL: `https://<project>.functions.supabase.co/vendors-api/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply. This file is the per-resource delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts`.
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`.
- Money is integer cents on the wire.
- `issue_date` / `due_date` are calendar `date` strings (`YYYY-MM-DD`).
- Bundle `vendors-api` enforces `verify_jwt = true`.

## RBAC

- `org_owner`, `org_admin` — full reach.
- `accounting` — read + write + approve + pay.
- `ops` — read + write (capture and submit; cannot approve / pay).
- `sales`, `viewer` — read only.
- `customer_user` — no access.

## State machine

Prod `vendor_bills.status` text CHECK has **seven** values:

| State | Description |
|---|---|
| `draft` | Header editable. Only initial state. |
| `pending` | Submitted for review. |
| `approved` | Accountant has signed off. Stamps `approved_at` + `approved_by`. |
| `partially_paid` | One or more `/pay` calls; `0 < paid_cents < total_cents`. |
| `paid` | Terminal. `paid_cents >= total_cents`. Stamps `paid_at`. |
| `overdue` | `due_date < today` and unpaid. Reachable from `approved` / `partially_paid`. |
| `cancelled` | Terminal. Reachable from any non-terminal pre-paid state. |

Legal transitions (`_shared/workflow.ts#VENDOR_BILL_TRANSITIONS`):

| From | To |
|---|---|
| `draft` | `pending`, `cancelled` |
| `pending` | `approved`, `cancelled` |
| `approved` | `partially_paid`, `paid`, `overdue`, `cancelled` |
| `partially_paid` | `paid`, `overdue`, `cancelled` |
| `overdue` | `partially_paid`, `paid`, `cancelled` |
| `paid` | _(terminal)_ |
| `cancelled` | _(terminal)_ |

The Wave 7 backend does not yet auto-flip `approved → overdue` on a schedule; the transition exists in the matrix for a future scheduled job (Phase 12 surface). Today, calling `/pay` on an `overdue` bill works the same as on `approved` — the math determines whether the bill ends up `partially_paid` or `paid`.

Per-state stamps: `approved` writes `approved_at` + `approved_by`; `paid` writes `paid_at`. Other transitions only touch `status` + `updated_at`.

## VendorBill (Zod canon)

```ts
export const VendorBillStateSchema = z.enum([
  'draft', 'pending', 'approved', 'partially_paid', 'paid', 'overdue', 'cancelled',
]);

export const VendorBillSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  bill_number: z.string(),
  vendor_id: UuidSchema,
  po_id: UuidSchema.nullable(),                      // optional parent PO link
  vendor_ref: z.string().nullable(),                 // vendor's own invoice number
  status: VendorBillStateSchema,
  issue_date: z.string().date(),
  due_date: z.string().date(),
  currency_code: z.string().length(3),
  subtotal_cents: CentsSchema,
  tax_cents: CentsSchema,
  total_cents: CentsSchema,
  paid_cents: CentsSchema,
  balance_cents: CentsSchema.nullable(),             // trigger-maintained = total - paid
  notes: z.string().nullable(),
  approved_at: TimestampSchema.nullable(),
  approved_by: UuidSchema.nullable(),
  paid_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
});
```

The trigger `tg_vendor_bills_balance` (BIU, added in migration 0058) recomputes `balance_cents = total_cents - paid_cents` on every write. Handlers MUST NOT update `balance_cents` directly; write the inputs and the trigger fires.

## Routes

| Route | Method | RBAC | Idempotent | Purpose |
|---|---|---|---|---|
| `/vendor-bills` | GET | `vendor_bills.read` | no | List |
| `/vendor-bills/{id}` | GET | `vendor_bills.read` | no | Detail |
| `/vendor-bills` | POST | `vendor_bills.write` | yes | Create draft |
| `/vendor-bills/{id}` | PATCH | `vendor_bills.write` | yes | Edit draft |
| `/vendor-bills/{id}/submit` | POST | `vendor_bills.write` | yes | `draft → pending` |
| `/vendor-bills/{id}/approve` | POST | `vendor_bills.approve` | yes | `pending → approved` (stamps `approved_at` + `approved_by`) |
| `/vendor-bills/{id}/pay` | POST | `vendor_bills.pay` | yes | Bump `paid_cents`; auto-transition to `partially_paid` or `paid` |
| `/vendor-bills/{id}/cancel` | POST | `vendor_bills.write` | yes | `(non-terminal pre-paid) → cancelled` |

### list-vendor-bills / get-vendor-bill

- Filters: `status`, `vendor_id`, `po_id`.
- Pagination: `limit`, opaque `cursor`.
- Sort: `created_at DESC, id DESC`.

### create-vendor-bill

```ts
export const VendorBillCreateSchema = z.object({
  vendor_id: UuidSchema,
  po_id: UuidSchema.nullable().optional(),
  vendor_ref: z.string().max(255).nullable().optional(),
  issue_date: z.string().date().optional(),         // defaults to today
  due_date: z.string().date(),                      // REQUIRED
  currency_code: z.string().length(3).optional(),   // defaults 'USD'
  subtotal_cents: z.number().int().nonnegative(),
  tax_cents: z.number().int().nonnegative().optional(),
  total_cents: z.number().int().nonnegative(),
  notes: z.string().nullable().optional(),
}).strict();
```

- The server picks `bill_number` via `next_doc_number(org, 'vendor_bill')`.
- The handler stamps `paid_cents=0` and `status='draft'`.
- The trigger sets `balance_cents = total_cents - 0 = total_cents` on insert.

The handler does NOT yet validate `subtotal_cents + tax_cents = total_cents` — vendors sometimes round in surprising ways, and the bill captures their numbers. Phase 12 (Wave 8) will add a two-way-match surface that flags PO/bill mismatches.

### patch-vendor-bill

```ts
export const VendorBillPatchSchema = VendorBillCreateSchema.omit({
  vendor_id: true, total_cents: true, subtotal_cents: true,
}).partial().extend({
  subtotal_cents: z.number().int().nonnegative().optional(),
  total_cents: z.number().int().nonnegative().optional(),
}).strict();
```

- Patchable fields: `po_id`, `vendor_ref`, `issue_date`, `due_date`, `currency_code`, `subtotal_cents`, `tax_cents`, `total_cents`, `notes`. `vendor_id` is NOT patchable.
- **Only allowed while `status = 'draft'`.** Outside `draft` returns **409 STATE_CONFLICT** with `cannot edit vendor bill in status=<status>`.

### approve

`POST /vendors-api/vendor-bills/{id}/approve`

- Stamps `approved_at = now()` and `approved_by = caller.userId` in addition to the status flip.
- Cap `vendor_bills.approve`.

### pay (partial + full)

```ts
export const VendorBillPaySchema = z.object({
  amount_cents: z.number().int().positive().optional(),
}).strict();
```

- If `amount_cents` is omitted, the handler pays the full remaining balance (= `total_cents - paid_cents`).
- If supplied, must be `<= remaining`. Excess returns **422 VALIDATION_ERROR** with the message `amount_cents <N> exceeds remaining balance <M>`.
- The handler computes `newPaid = paid_cents + amount`:
  - `newPaid >= total_cents` → `status='paid'` + stamp `paid_at`,
  - else → `status='partially_paid'`.
- Only legal from `approved`, `partially_paid`, or `overdue`. From other states returns **409 STATE_CONFLICT** with `cannot pay vendor bill in status=<status>`.
- Calling pay against a fully-paid bill returns **409 STATE_CONFLICT** with `vendor bill already fully paid`.

```bash
# Partial pay
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"amount_cents":50000}' \
  "$BASE/vendors-api/vendor-bills/$BID/pay"

# Pay remaining balance
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{}' \
  "$BASE/vendors-api/vendor-bills/$BID/pay"
```

### submit / cancel

Plain status-flip routes. Both take an empty body. `submit` requires `vendor_bills.write`; `cancel` requires `vendor_bills.write` and is legal from any non-terminal pre-paid state.

## Sample success response

```json
{
  "data": {
    "id": "b3...",
    "org_id": "t1...",
    "bill_number": "BILL-2026-00042",
    "vendor_id": "v0...",
    "po_id": "p7...",
    "vendor_ref": "ACME-INV-12345",
    "status": "partially_paid",
    "issue_date": "2026-05-16",
    "due_date": "2026-06-30",
    "currency_code": "USD",
    "subtotal_cents": 100000,
    "tax_cents": 8000,
    "total_cents": 108000,
    "paid_cents": 50000,
    "balance_cents": 58000,
    "notes": null,
    "approved_at": "2026-05-16T17:35:22.000Z",
    "approved_by": "u9...",
    "paid_at": null,
    "created_at": "2026-05-16T17:32:01.123Z",
    "updated_at": "2026-05-16T17:38:14.555Z",
    "deleted_at": null
  }
}
```

## Errors

| Code | HTTP | When |
|---|---|---|
| `NOT_FOUND` | 404 | Bill id not visible (RLS or soft-deleted) |
| `STATE_CONFLICT` | 409 | Illegal transition, PATCH outside `draft`, or pay outside `approved`/`partially_paid`/`overdue` |
| `STATE_CONFLICT` (msg `vendor bill already fully paid`) | 409 | Pay against a bill with `balance_cents <= 0` |
| `VALIDATION_ERROR` | 422 | `amount_cents` exceeds remaining balance, or body fails Zod parse |
| `IDEMPOTENCY_CONFLICT` | 409 | Same key, different body hash |
| `INTERNAL_ERROR` | 500 | DB error (see `details.db`) |

## Versioning

PR #61 ships the vendor-bills surface. Trigger `tg_vendor_bills_balance` arrives in migration `0058`. See `TS1/09-api/00-API-CONTRACT.md` §10 for the cross-resource overview.

Multi-invoice (AP-side) payment allocations — i.e., one bank transaction settling multiple bills — remain deferred to Wave 8 Phase 12 via a new `payment_allocations` table (R-W5-PAY-01).
