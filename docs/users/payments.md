# Payments

Wave 5 ships the `/payments` surface alongside the invoicing flow. A **payment** is a row that reduces an invoice's outstanding balance via the `recompute_invoice_totals` trigger; it is immutable once `voided_at` is stamped. The page lives at `/payments` and is reachable to staff roles with `payments.read`.

## What a payment is

A payment is one row in `payments` tied 1:1 to a single invoice via `invoice_id NOT NULL`. Each row carries:

- the customer (`customer_id`) and parent invoice (`invoice_id`),
- a payment-method link (`payment_method_id` — `uuid` FK, nullable),
- `paid_at` (the timestamp the payment cleared the customer's hands),
- `amount_cents` (always > 0; enforced by a CHECK constraint),
- `currency_code` (3 chars; **must match the parent invoice's currency**, enforced by the `assert_invoice_payment_currency` trigger added in migration 0052),
- optional `exchange_rate`, `reference`, `description`, `external_ref`,
- a `cleared_at` timestamp (Phase 12 GL pass will set this; Wave 5 leaves it `NULL`),
- and void columns `voided_at` + `void_reason` (both `NULL` on an active payment).

A 1:1 FK to a single invoice means a single payment cannot be split across multiple invoices. Multi-invoice allocations would require a new `payment_allocations` join table and are **deferred to Phase 12**.

## Recording a payment

There are two entry points:

1. From `/payments` click **Record payment**.
2. From an invoice detail page's **Payments** tab, click **Record payment** (pre-fills `invoice_id`).

Form fields:

- **Invoice** — picker (only invoices with `balance_cents > 0` and `status NOT IN ('cancelled', 'refunded')` are listed). Once selected, the customer and currency are pinned from the invoice and become read-only.
- **Amount** — entered through `MoneyInput`; the wire stores `amount_cents`. Must be `> 0` (DB CHECK) and `<= invoice.balance_cents` (handler-enforced).
- **Paid at** — required ISO-8601 timestamp; defaults to "now" server-side if omitted.
- **Payment method** — optional picker (against `payment_methods`).
- **Reference** — optional free-text (max 120 chars; the bank-side reference or check number).
- **Description** — optional free-text (max 2000 chars).
- **External ref** — optional free-text (upstream system id).
- **Exchange rate** — optional positive number (used if you're booking against a non-functional currency invoice; Wave 5 does not yet wire the FX math, Phase 12 will).

Hit **Save**. The form posts `POST /invoicing-api/payments` with an `Idempotency-Key` header. Server returns `{ data: Payment }`.

On insert the `recompute_invoice_totals` trigger fires on the `payments` table and rolls the new amount into `invoice.paid_cents` + `invoice.balance_cents` + `invoice.payment_status`. If the new `paid_cents >= total_cents` the trigger also bumps the invoice status to `paid` and stamps `paid_at`.

## Editing a payment

A payment can be patched only while `voided_at IS NULL`. `PATCH /invoicing-api/payments/:id` accepts the same fields as create except `customer_id`, `invoice_id`, and `currency_code` (those are immutable; if you got them wrong, void and re-record). `amount_cents` stays positive if supplied. Any change to `amount_cents` re-fires the recompute trigger.

## Voiding a payment

Click **Void** on the payment detail page (visible to roles with the `payments.void` capability). A required reason dialog opens; posts `POST /invoicing-api/payments/:id/void` with a `void_reason` (1–2000 chars). The handler stamps `voided_at = now()` + `void_reason`; the `recompute_invoice_totals` trigger fires and rolls the invoice back (subtracting the voided amount from `paid_cents`, recomputing `balance_cents` + `payment_status`, and bumping the invoice status back from `paid` to `partially_paid` or `pending` as appropriate).

Voiding is terminal at the row level — there is no "un-void" handler. If you need to re-record, create a fresh payment.

## Browsing payments

Navigate to `/payments`. The filter row contains:

- a free-text **Search** input (matches `payment_number` and `reference`),
- a **Customer** picker,
- an **Invoice** picker,
- a **Payment method** picker,
- a **Currency** picker,
- a **Status** toggle (`active` / `voided`),
- a date range for `paid_at`.

Table columns: **Payment #**, **Customer**, **Invoice #**, **Method**, **Amount**, **Paid at**, **Status** (active / voided pill). Totals render through `MoneyDisplay` against the payment's own `currency_code`. Pagination uses an opaque cursor.

## Customer detail Payments tab

The customer detail page (`/customers/:id`) has a **Payments** tab listing every payment for this customer across all invoices.

`customer_user` role sees only their own customer's payments (RLS Pattern C scopes the read to `customer_user.customer_id = payments.customer_id`).

## What's coming next

Phase 12 (GL pass) wires the `cleared_at` reconciliation flow against bank statements, the FX revaluation pass for non-functional-currency payments, and the multi-invoice `payment_allocations` table for the split-payment surface.
