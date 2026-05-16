# Vendor bills

A **vendor bill** is the AP-side document — the invoice your vendor sends you that you need to approve and pay. Vendor bills sit in `public.vendor_bills` as **header-only** records: there is no `vendor_bill_line_items` table in prod. The handler accepts subtotal/tax/total directly in the body, and a database trigger keeps `balance_cents = total_cents - paid_cents` in sync as you record payments.

The user-facing pages (`/vendor-bills`, `/vendor-bills/:id`, the pay dialog) are **deferred to Wave 7b**. Wave 7 ships the backend API and Zod canon; the SPA surface lands in a follow-up wave. The flows below are exercised today via **[Vendor bills API](../api/vendor-bills.md)**.

## What a vendor bill is

A vendor bill is one row in `public.vendor_bills` carrying:

- a server-generated **`bill_number`** (`BILL-YYYY-NNNNN` from `next_doc_number(org, 'vendor_bill')`),
- `vendor_id` (required) and an optional `po_id` linking to the parent purchase order,
- an optional `vendor_ref` (the vendor's own invoice number, used for matching),
- a **`status`** — 7-value text CHECK; see lifecycle below,
- an `issue_date` (defaults to today) and a required **`due_date`**,
- a `currency_code` (defaults to `'USD'`),
- the four money fields: `subtotal_cents`, `tax_cents`, `total_cents`, `paid_cents`,
- a trigger-maintained **`balance_cents`** (= `total_cents - paid_cents`; nullable on the DB row but the trigger keeps it populated),
- a `notes` free-text field,
- the per-state stamps `approved_at`, `approved_by`, `paid_at`,
- and the chassis `created_at` / `updated_at` / `deleted_at`.

Unlike purchase orders, vendor bills use the per-state-stamp convention (`approved_at`, `paid_at`) rather than a single `state_changed_at` column. The handler stamps whichever column matches the new status.

### Why no line items?

Prod did not ship a `vendor_bill_line_items` table (D-W7-6 in the Wave 7 dispatch plan). Vendor bills are header-only because:

- AP capture is usually a single-PDF-to-numbers exercise — bookkeepers type the totals off the bill image, not line by line;
- the matching purchase order already has the line-level breakdown, accessible via the `po_id` link;
- line-level matching is a Phase 12 (GL pass) feature, not a Wave 7 commitment.

If you need per-line attribution today, link the bill to a PO via `po_id` and follow the chain.

## Lifecycle

Vendor bills run through seven states. The state machine is enforced server-side by `_shared/workflow.ts#VENDOR_BILL_TRANSITIONS`; illegal transitions return **409 STATE_CONFLICT**.

```
draft ──submit──► pending ──approve──► approved ──pay (partial)──► partially_paid ──pay (final)──► paid
  │                  │                   │                                │
  │                  │                   └──pay (full)─────► paid          │
  │                  │                                                    │
  │                  └──cancel──► cancelled                               │
  │                                                                       │
  └──cancel──► cancelled                                                   │
                                                                          │
              (approved | partially_paid) ──due_date passes──► overdue ──pay──► partially_paid | paid
                                                                          │
              (any non-terminal state) ──cancel──► cancelled              │
                                                                          ▼
                                                                       (paid is terminal; so is cancelled)
```

- **draft** — header is editable. Created by `POST /vendor-bills`.
- **pending** — submitted for review.
- **approved** — accountant has signed off; the bill is payable. Stamps `approved_at` + `approved_by`.
- **partially_paid** — one or more `/pay` calls have bumped `paid_cents` but `paid_cents < total_cents`.
- **paid** — terminal. `paid_cents >= total_cents`. Stamps `paid_at` on the transition.
- **overdue** — reachable from `approved` or `partially_paid` when `due_date < today` and the bill is unpaid. The Wave 7 backend does not auto-flip to overdue on a schedule; today the handler accepts the transition path for a future scheduled job (Phase 12 surface). Paying an overdue bill follows the normal `partially_paid` / `paid` math.
- **cancelled** — terminal. Reachable from any non-terminal pre-paid state.

Once a bill leaves `draft`, the header PATCH route returns **409 STATE_CONFLICT** with the message `cannot edit vendor bill in status=<status>`.

## Capturing an AP bill

`POST /vendors-api/vendor-bills` with `vendor_id`, `due_date`, `subtotal_cents`, `total_cents`, and optionally a `po_id`, `vendor_ref`, `tax_cents`, `issue_date`, `currency_code`, `notes`. The handler stamps `paid_cents=0` and `status='draft'`.

A typical create:

```json
{
  "vendor_id": "v0...",
  "po_id": "p7...",
  "vendor_ref": "ACME-INV-12345",
  "due_date": "2026-06-30",
  "subtotal_cents": 100000,
  "tax_cents": 8000,
  "total_cents": 108000
}
```

The trigger fires on insert and sets `balance_cents = 108000 - 0 = 108000`.

## Approving a bill

Submit → approve in two clicks:

1. **Submit** — `POST /vendor-bills/:id/submit` moves `draft → pending`. Cap `vendor_bills.write`.
2. **Approve** — `POST /vendor-bills/:id/approve` moves `pending → approved`. Stamps `approved_at = now()` and `approved_by = caller.userId`. Cap `vendor_bills.approve`.

Or **Cancel** — `POST /vendor-bills/:id/cancel` moves any non-terminal pre-paid state to `cancelled`. Cap `vendor_bills.write`.

## Paying a bill (partial + full)

`POST /vendors-api/vendor-bills/:id/pay`. Body is optional:

```json
{ "amount_cents": 50000 }
```

If `amount_cents` is omitted, the handler pays the full remaining balance. If supplied, it must be `<= balance_cents` — otherwise the handler returns **422 VALIDATION_ERROR** with the message `amount_cents <N> exceeds remaining balance <M>`.

The handler:

1. reads the current `total_cents`, `paid_cents`, and `balance_cents`;
2. computes `newPaid = paid_cents + amount` and `remaining = total - paid_cents`;
3. transitions status: `newPaid >= total` → `paid` (and stamps `paid_at`); otherwise → `partially_paid`;
4. writes the patch; the BIU trigger updates `balance_cents` to `total - newPaid` on the same write.

Pay is only legal from `approved`, `partially_paid`, or `overdue`. From other statuses (including `draft` and `pending`) the handler returns **409 STATE_CONFLICT**.

Cap `vendor_bills.pay` (typically owner, admin, accounting).

### Multiple partial payments

Each `/pay` call is its own POST with its own `Idempotency-Key`. You can call it as many times as you have payments to record. The trigger keeps the math right on every write.

Wave 7 does not yet wire bank-feed reconciliation; the pay endpoint stamps the bill side only. The full `payments`-table parallel (used today by AR) for AP-side payment records will land in Wave 8 (Phase 12 GL pass with the `payment_allocations` table; tracked as R-W5-PAY-01).

## Linking to a PO

If you supply `po_id` at create time, the bill renders the PO link on the detail page (Wave 7b). The link is informational — the bill's totals are NOT auto-derived from the PO's totals; you still type or paste them. Future phases (12 GL) will add a "match" surface that flags mismatches between PO totals and bill totals.

A bill without a `po_id` is fine — many recurring expenses (utilities, rent, software subscriptions) don't run through purchase orders. The bill stands alone.

## Capabilities

- `vendor_bills.read` — list, get (any staff role).
- `vendor_bills.write` — create, patch, submit, cancel (owner, admin, ops, accounting).
- `vendor_bills.approve` — approve (owner, admin, accounting).
- `vendor_bills.pay` — pay (owner, admin, accounting).

## What's coming next (Wave 7b and beyond)

- **SPA pages** — `/vendor-bills` list with filters (status, vendor, PO, date range), `/vendor-bills/:id` detail with the pay dialog and PO link, workflow buttons. Wave 7b.
- **Two-way match** — Phase 12 (Wave 8) cross-checks bill subtotal against PO subtotal and flags mismatches.
- **Payment allocations** — Phase 12 (Wave 8) wires `payment_allocations` so a single bank transaction can settle multiple bills. R-W5-PAY-01.
- **GL hooks** — Phase 12 emits the journal entry on `approved` (debit expense, credit AP).
- **Overdue scheduler** — Phase 12 wires a daily job to flip `approved → overdue` based on `due_date`.

See **[Purchase orders](./purchase-orders.md)** for the order side. Full route table and schemas: **[Vendor bills API](../api/vendor-bills.md)**.
