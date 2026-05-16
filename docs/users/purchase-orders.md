# Purchase orders

Wave 7 lights up the order-side of procurement. A **purchase order** (PO) is the document you issue to a vendor committing the org to a buy. POs carry a vendor, an optional project link, a currency, a list of line items with quantities and unit costs, and a lifecycle status that runs from `draft` to `closed`. The line totals roll up to the header by a database trigger (added in migration 0058), so the SPA preview and the persisted totals agree byte-for-byte.

The user-facing pages (`/purchase-orders`, `/purchase-orders/:id`, the receive dialog) are **deferred to Wave 7b**. Wave 7 ships the backend API and Zod canon; the SPA surface lands in a follow-up wave. The flows below are exercised today via the API documented in **[Purchase orders API](../api/purchase-orders.md)**.

## What a PO is

A PO is one row in `public.purchase_orders` plus zero-or-more `public.po_line_items` rows. The header carries:

- a server-generated **`po_number`** (`PO-YYYY-NNNNN` from `next_doc_number(org, 'purchase_order')`),
- `vendor_id` (required) and an optional `project_id`,
- a **`status`** — 7-value text CHECK; see lifecycle below,
- an `issue_date` (defaults to today) and an optional `expected_date`,
- a `currency_code` (3-char ISO; defaults to `'USD'`),
- the four money fields: `subtotal_cents`, `tax_cents`, `shipping_cents`, `total_cents`,
- a `notes` free-text field,
- a single `state_changed_at` timestamp (the Wave 0 chassis convention — POs do not have per-state stamps like invoices do),
- and the chassis `created_at` / `updated_at` / `deleted_at`.

Each line item carries `item_id` (optional link to the inventory catalog), `description` (required, free-text — snapshotted at the moment of the line; later edits to the catalog item don't propagate back), `quantity` (numeric, decimal-friendly), `quantity_received` (numeric, starts at 0), an optional `unit` label, `unit_cost_cents`, the computed `line_total_cents`, and `position` for ordering.

## Lifecycle

POs run through seven states. The state machine is enforced server-side by `_shared/workflow.ts#PURCHASE_ORDER_TRANSITIONS`; illegal transitions return **409 STATE_CONFLICT**.

```
draft ──submit──► submitted ──approve──► approved ──receive (partial)──► partial_received ──receive (final)──► received ──close──► closed
  │                  │                       │                                                                        │
  │                  └──reset──► draft       └──cancel──► cancelled                                                  │
  │                                                                                                                  │
  └──cancel──► cancelled                                                                                             │
                                                                                                                     │
                                  (any non-terminal state) ──cancel──► cancelled                                     │
                                                                                                                     ▼
                                                                                                                  (terminal)
```

- **draft** — the only state in which header fields and line items are editable. Created by `POST /purchase-orders`.
- **submitted** — sent for approval. A submitter can be sent back to `draft` for revision before approval.
- **approved** — ready to receive. The vendor has been notified outside the system.
- **partial_received** — at least one line has `quantity_received > 0` but the receive isn't complete yet (some line has `quantity_received < quantity`). Reached by `POST /purchase-orders/:id/receive` with a partial line set.
- **received** — every line satisfies `quantity_received >= quantity`. The receive endpoint auto-promotes to `received` when the math works out.
- **closed** — terminal accounting close-out marker. Reached from `received` after the vendor bill (or bills) are reconciled.
- **cancelled** — terminal. Reachable from any non-terminal state.

Note the spelling: **`partial_received`** (one r in "partial"), NOT `partially_received`. The DB CHECK uses this spelling and the workflow matrix mirrors it.

The `state_changed_at` timestamp stamps to `now()` on every transition. There are no per-state stamps (e.g., no `approved_at` column) — the audit log table (Wave 8 surface) is the cross-table source of truth for "who did what when".

## Creating a PO

`POST /vendors-api/purchase-orders`. Required fields: `vendor_id`. Optional: `project_id`, `issue_date` (defaults to today), `expected_date`, `currency_code` (defaults to `'USD'`), `tax_cents`, `shipping_cents`, `notes`, and a `lines` array.

A typical create body:

```json
{
  "vendor_id": "v0...",
  "currency_code": "USD",
  "expected_date": "2026-06-15",
  "tax_cents": 0,
  "shipping_cents": 1500,
  "lines": [
    {
      "description": "M8 stainless bolts, box of 100",
      "quantity": 4,
      "unit": "box",
      "unit_cost_cents": 2500,
      "position": 0
    }
  ]
}
```

The server picks the PO number and inserts the header + lines in one round-trip. The line `line_total_cents` is computed handler-side using the canonical half-even rounding helper (`roundHalfEven(quantity * unit_cost_cents)` per F-Wave5-02); the AIUD trigger on `po_line_items` then rolls the `subtotal_cents` and `total_cents` to the header.

The response carries the full PO including the trigger-recomputed totals.

## Editing a draft

`PATCH /vendors-api/purchase-orders/:id` lets you change `project_id`, `issue_date`, `expected_date`, `currency_code`, `tax_cents`, `shipping_cents`, and `notes` — but **only while `status = 'draft'`**. Once submitted, the patch returns **409 STATE_CONFLICT** with the message `cannot edit PO in status=<status>`.

Line item operations have the same draft-only guard:

- **Add a line** — `POST /vendors-api/purchase-orders/:id/lines`.
- **Update a line** — `PATCH /vendors-api/purchase-orders/:id/lines/:lineId`. If `quantity` or `unit_cost_cents` is touched, the handler recomputes `line_total_cents` half-even.
- **Delete a line** — `DELETE /vendors-api/purchase-orders/:id/lines/:lineId`.

After every line mutation the trigger fires and refreshes the header totals.

## Workflow buttons

Each state transition is its own POST route. They all require `Idempotency-Key`.

- **Submit** — `POST /purchase-orders/:id/submit`. Moves `draft → submitted`. Cap `purchase_orders.write`.
- **Approve** — `POST /purchase-orders/:id/approve`. Moves `submitted → approved`. Cap `purchase_orders.approve`.
- **Cancel** — `POST /purchase-orders/:id/cancel`. Moves any non-terminal state to `cancelled`. Cap `purchase_orders.cancel`.
- **Close** — `POST /purchase-orders/:id/close`. Moves `received → closed`. Cap `purchase_orders.write`.
- **Receive** — `POST /purchase-orders/:id/receive`. See below.

## Partial vs full receive

The receive endpoint is the only workflow route that takes a body. The body is a list of `{ po_line_item_id, quantity_received }` updates:

```json
{
  "lines": [
    { "po_line_item_id": "p1...", "quantity_received": 2 },
    { "po_line_item_id": "p2...", "quantity_received": 5 }
  ]
}
```

The handler:

1. updates each line's `quantity_received`;
2. re-reads all lines and checks whether every line satisfies `quantity_received >= quantity`;
3. if yes → transitions the PO to `received`. If at least one line is short → transitions to `partial_received`.

You can call receive multiple times. Each call moves the line counts forward; the second-receive that pushes the last short line over the bar promotes the header to `received`. Calling receive against a PO that is already `partial_received` is legal (it stays in `partial_received` until everything is in).

Receive requires the cap `purchase_orders.receive` and is only legal from `approved` or `partial_received`. From any other status the handler returns **409 STATE_CONFLICT**.

## Close-out

A PO in `received` status can be closed via `POST /purchase-orders/:id/close`. Close is the accounting marker that says "the vendor bills for this PO have been reconciled and there is no further work to do here". It is terminal — there is no path back from `closed` (you can still archive the underlying record via `deleted_at`, but the workflow won't accept any more transitions).

In practice you usually close the PO after the matching vendor bill has been approved and paid. The link between a PO and its vendor bill lives at `vendor_bills.po_id` (nullable — bills can exist without a parent PO).

## Capabilities

- `purchase_orders.read` — list, get (any staff role).
- `purchase_orders.write` — create, patch, line items, submit, close (owner, admin, ops, accounting).
- `purchase_orders.approve` — approve (owner, admin, accounting).
- `purchase_orders.cancel` — cancel (owner, admin, accounting).
- `purchase_orders.receive` — receive (owner, admin, ops).

## What's coming next (Wave 7b and beyond)

- **SPA pages** — `/purchase-orders` list with filters (status, vendor, project, date range), `/purchase-orders/:id` detail with the `POLineEditor` + `POReceiveDialog`, workflow button bar. Wave 7b.
- **Email-the-PO** — Phase 19 wires the actual mail transport.
- **GL hooks** — Phase 12 (Wave 8) emits journal entries on `received` (debit inventory, credit accrued AP).
- **Stock movement triggers** — Phase 13 (Wave 8) wires receive → `stock_movements` insert.

See **[Vendor bills](./vendor-bills.md)** for the AP side. Full route table and Zod schemas: **[Purchase orders API](../api/purchase-orders.md)**.
