# Payments API

Wave 5 ships the payments surface inside the `invoicing-api` Edge Function bundle under `https://<project>.functions.supabase.co/invoicing-api/payments/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply to every endpoint below. This file is the per-resource delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts` (byte-mirrored to `apps/web/src/lib/types.ts`).
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`.
- Money is integer cents on the wire (field names end in `_cents`); the DB CHECK is `amount_cents > 0`.
- Timestamps are ISO-8601 with `Z`.
- Bundle `invoicing-api` enforces `verify_jwt = true`.

## RBAC at the bundle

The payments routes gate per-handler via `requireCap(caller, '<capability>')` against `_shared/capabilities.ts`:

- `org_owner`, `org_admin` — full reach.
- `accounting` — read, write, void.
- `sales`, `ops`, `viewer` — read only.
- `customer_user` — read own (RLS Pattern C scoped to the customer's row).

## Currency rule

A payment's `currency_code` MUST match the parent invoice's `currency_code`. The `assert_invoice_payment_currency` trigger (added in migration 0052) enforces this on the DB; handler-side validation also rejects mismatches before insert with **409 STATE_CONFLICT** `details.code = 'PAYMENT_CURRENCY_MISMATCH'`.

## 1:1 invoice link (no allocations)

A payment is tied to exactly one invoice via `invoice_id NOT NULL`. There is no `allocations[]` field on the create body and no `/allocate` route. Multi-invoice payments would require a new `payment_allocations` join table and are **deferred to Phase 12**.

## Payments

### list-payments / get-payment

`GET /invoicing-api/payments`
`GET /invoicing-api/payments/{id}`

- RBAC: `payments.read` (customer_user is RLS-gated to their own org's rows).
- Idempotent: yes (GET).
- Filters: `q` (free-text matches `payment_number` + `reference`), `customer_id`, `invoice_id`, `payment_method_id`, `currency_code`, `voided` (`true` / `false`), `from` / `to` (date range on `paid_at`).
- Pagination: `limit` (default 50, max 200), opaque `cursor`.
- Sort: `paid_at DESC, id DESC`.

```ts
export const PaymentSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  payment_number: z.string().min(1),
  customer_id: UuidSchema,
  invoice_id: UuidSchema,                          // NOT NULL — 1:1 with invoice
  payment_method_id: UuidSchema.nullable(),        // uuid FK; NOT a text discriminator
  paid_at: TimestampSchema,
  amount_cents: CentsSchema,                       // CHECK > 0
  currency_code: z.string().length(3),             // MUST match invoice.currency_code
  exchange_rate: z.union([z.number(), z.string()]).nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  external_ref: z.string().nullable(),
  cleared_at: z.string().nullable(),               // Phase 12 GL pass sets this; Wave 5 leaves NULL
  voided_at: z.string().nullable(),
  void_reason: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

```bash
curl -H "Authorization: Bearer $JWT" \
  "$BASE/invoicing-api/payments?customer_id=$CID&voided=false&limit=25"
```

### create-payment

`POST /invoicing-api/payments`

- RBAC: `payments.write`.
- Idempotent header required.
- `amount_cents` must be `> 0` (DB CHECK) and `<= invoice.balance_cents` (handler-enforced; returns **409 STATE_CONFLICT** `details.code = 'PAYMENT_OVER_BALANCE'`).
- `currency_code` must match parent invoice's currency.
- `paid_at` defaults to server-side `now()` when omitted.
- On insert, the `recompute_invoice_totals` trigger fires and rolls the amount into `invoice.paid_cents` + `invoice.balance_cents` + `invoice.payment_status`.

```ts
export const PaymentCreateSchema = z.object({
  customer_id: UuidSchema,
  invoice_id: UuidSchema,
  amount_cents: z.number().int().positive(),
  currency_code: z.string().length(3),
  paid_at: TimestampSchema.optional(),
  payment_method_id: UuidSchema.nullable().optional(),
  reference: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  external_ref: z.string().max(120).nullable().optional(),
  exchange_rate: z.number().positive().nullable().optional(),
});
```

**No `received_at`, `method_id`, or `allocations[]`** — those exist in the dispatch text but not on the prod table. The column names are `paid_at` and `payment_method_id`; allocations are deferred to Phase 12.

```bash
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"customer_id":"'$CID'","invoice_id":"'$IID'","amount_cents":12500,"currency_code":"USD","paid_at":"2026-05-16T14:30:00Z"}' \
  "$BASE/invoicing-api/payments"
```

### patch-payment

`PATCH /invoicing-api/payments/{id}`

- RBAC: `payments.write`.
- Idempotent: yes.
- Allowed only while `voided_at IS NULL`. Otherwise **409 STATE_CONFLICT** `details.code = 'PAYMENT_VOIDED_LOCKED'`.
- `customer_id`, `invoice_id`, and `currency_code` are immutable — to correct any of them, void and re-record.
- A change to `amount_cents` re-fires the recompute trigger.

```ts
export const PaymentPatchSchema = z.object({
  paid_at: TimestampSchema.optional(),
  amount_cents: z.number().int().positive().optional(),
  payment_method_id: UuidSchema.nullable().optional(),
  reference: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  external_ref: z.string().max(120).nullable().optional(),
  exchange_rate: z.number().positive().nullable().optional(),
});
```

### void-payment

`POST /invoicing-api/payments/{id}/void`

- RBAC: `payments.void`.
- Idempotent header required.
- Stamps `voided_at = now()` + `void_reason`. The recompute trigger fires and rolls the invoice back (subtracts the voided amount from `paid_cents`, recomputes `balance_cents` + `payment_status`, and bumps the invoice status back from `paid` to `partially_paid` or `pending` as appropriate).
- Voiding is terminal at the row level — no "un-void" handler.

```ts
export const PaymentVoidSchema = z.object({
  void_reason: z.string().min(1).max(2000),
});
```

```bash
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"void_reason":"Reversed by bank — NSF"}' \
  "$BASE/invoicing-api/payments/$PID/void"
```

## Errors

Every endpoint returns the universal envelope:

```json
{ "error": { "code": "<CODE>", "message": "<readable>", "details": { /* optional */ } } }
```

Domain codes for `invoicing-api` payments on top of the universal set:

| Code | HTTP | When |
|---|---|---|
| `STATE_CONFLICT` (`details.code = 'PAYMENT_OVER_BALANCE'`) | 409 | `amount_cents > invoice.balance_cents` on create or patch |
| `STATE_CONFLICT` (`details.code = 'PAYMENT_CURRENCY_MISMATCH'`) | 409 | `currency_code` doesn't match parent invoice (caught by handler before the trigger fires) |
| `STATE_CONFLICT` (`details.code = 'PAYMENT_VOIDED_LOCKED'`) | 409 | PATCH on a payment with `voided_at IS NOT NULL` |
| `STATE_CONFLICT` (`details.code = 'INVOICE_NOT_PAYABLE'`) | 409 | Create against an invoice in `draft` / `cancelled` / `refunded` status |

## Versioning

The `invoicing-api` bundle ships in Wave 5 PR #46. Schema-impacting changes ride `migrate.yml` (currently at `0052`).
