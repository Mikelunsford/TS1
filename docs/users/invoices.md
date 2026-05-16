# Invoices

Wave 5 lights up the invoicing surface. An **invoice** is the snapshotted billable document you hand a customer after the work is scoped (or the goods are shipped) — it carries customer + currency snapshots, a list of priced line items, header-level totals rolled up from those lines, and a status that drives the payment lifecycle. The page lives at `/invoices` and is reachable to staff roles with `invoices.read`.

This walkthrough leads you from sign-in to the core flows: browsing invoices, creating one (from scratch, from a quote, or from a project), editing line items while it's still a draft, moving the invoice through the lifecycle, recording payments, and applying credit notes.

## What an invoice is

An invoice is one row in `invoices` plus zero-or-more `invoice_line_items`, plus a rolled-up `payments` aggregate and an optional `credit_notes` link. Each header carries:

- the customer (`customer_id` + a denormalized `customer_name_snapshot` stamped at create time, NOT NULL on the DB, so the row is readable even if the customer is later renamed),
- optional `project_id` and `quote_id` link columns (the canonical lineage when the invoice was converted from a project or quote),
- optional `converted_from_type` (`quote` | `project`) + `converted_from_id` link columns (the audit-trail counterpart to the above — both are written by the from-quote / from-project handlers),
- a **status** (the lifecycle — see below) plus a `payment_status` rollup (`unpaid` | `partially_paid` | `paid`) maintained by the `recompute_invoice_totals` trigger,
- a **currency** (`currency_code`, 3 chars) and optional **tax** snapshot (`tax_id` + `tax_rate_snapshot` — snapshotted at create from the source quote or the org default; never edited live on the invoice),
- an `issue_date` + `due_date` (both `date`),
- a single `notes` field (free text; no `notes_internal` / `notes_customer` split),
- an optional `recurring` cadence on the invoice row itself (`daily` | `weekly` | `monthly` | `quarterly` | `annually` — nullable; non-recurring rows leave it `NULL`),
- lifecycle timestamps `state_changed_at`, `pending_at`, `sent_at`, `paid_at`, `cancelled_at`, `on_hold_at`,
- and the rolled-up money fields `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`, `paid_cents`, `balance_cents` — populated by the `recompute_invoice_totals` trigger (regenerated in migration 0052) on every line-item or payment write. **`balance_cents` is the source of truth for "how much is still owed"**; it is bigint nullable on the DB and equals `total_cents - paid_cents` whenever a recompute fires.

There is also a `cancellation_reason` text column (set by `/void`), an `external_ref` text column for upstream system ids, and a `pdf_path` text column reserved for the Phase 19 PDF generator.

## Lifecycle

Invoices move through nine states. The state machine is enforced server-side by `_shared/workflow.ts#INVOICE_TRANSITIONS`; the SPA hides illegal action buttons.

```
draft ──submit──► pending ──send──► sent ──record-payment──► partially_paid ──record-payment──► paid ──refund──► refunded
  │                  │                │                                                         │
  │                  └──hold──► on_hold ──release──► pending                                   └──refund──► refunded
  │                  │                                                                       
  │                  └──void──► cancelled                                                    
  │                                          ▲                                              
  │                                          │                                              
  └──void──────────────────────────────────► cancelled                                       
                                                                                            
                       (sent | partially_paid) ──overdue-flag──► overdue ──record-payment──► partially_paid | paid
                                                                       └──void──► cancelled
```

- **draft** — the only state in which header fields (other than the snapshotted customer + currency) and line items are editable. Created by `POST /invoices`, `POST /invoices/from-quote`, `POST /invoices/from-project`, or `POST /invoices/:id/duplicate`.
- **pending** — submitted; ready to send. The submit handler bumps `state_changed_at` + `pending_at`.
- **sent** — emailed (or marked as sent). `sent_at` stamped on the first transition.
- **partially_paid** — has at least one non-voided payment with `sum(amount_cents) < total_cents`. Reached automatically by the recompute trigger when a payment is recorded.
- **paid** — fully paid. Reached automatically when `paid_cents >= total_cents`. `paid_at` stamped.
- **overdue** — `due_date < today` and not yet fully paid. Reached by a scheduled job (Phase 12 surface; Wave 5 exposes the state on the enum without auto-flagging).
- **refunded** — terminal. Reachable from `paid` or `partially_paid`. Wave 5 does not ship a refund handler beyond the state value; Phase 12 GL pass wires the workflow.
- **cancelled** — terminal. Reachable from any non-terminal pre-paid state via `/void`. Stamps `cancelled_at` + `cancellation_reason`.
- **on_hold** — paused mid-flight. Reachable from `pending` or `sent`. Stamps `on_hold_at`. Released back to `pending` via `/release`.

Once an invoice leaves `draft`, the line-item editor is read-only and header `PATCH` returns **409 STATE_CONFLICT** with `details.code = 'INVOICE_LOCKED_AFTER_ISSUE'`. A copy of every state-changing header update is written to `invoice_versions` by the `mirror_invoice_to_current_version` AFTER UPDATE trigger; the create trigger writes `version_number = 1` on insert. See **Versions** below.

## Browsing invoices

Navigate to `/invoices`. You see a header (`Invoices`), a filter row, and a table.

The filter row contains:

- a free-text **Search** input (matches `invoice_number` and `customer_name_snapshot`),
- a **Status** picker (multi-select of the nine states above),
- a **Payment status** picker (`unpaid` | `partially_paid` | `paid`),
- a **Customer** picker,
- a **Currency** picker,
- a date range for `issue_date`.

Table columns: **Invoice #** (`invoice_number`), **Customer**, **Status** (pill), **Payment** (pill), **Total**, **Balance**, **Issue date**, **Due date**. Totals render through `MoneyDisplay` against the invoice's own `currency_code`.

Pagination uses an opaque cursor in the URL (`?cursor=...`); the default page size is 50 (max 200). Click any row to drill into `/invoices/:id`.

## Creating an invoice

There are three entry points; all three land on `/invoices/:id` in `draft` state after success.

### From scratch via `/invoices/new`

Click **New invoice** on `/invoices`. Form fields:

- **Customer** — picker. Once selected, the form stamps `customer_name_snapshot` from the row.
- **Due date** — required `date`.
- **Currency** — required (`currency_code`, 3 chars). Falls back to the org's default if you leave it blank in the create payload, but the SPA forces an explicit selection.
- **Issue date** — optional `date`; defaults to today server-side.
- **Tax** — optional picker. The rate snapshots onto the header as `tax_rate_snapshot` at create time and onto each line as the line is added.
- **Notes** — single free-text field.
- **Recurring** — optional picker (`daily` | `weekly` | `monthly` | `quarterly` | `annually`). Leave blank for a one-off invoice.
- **External ref** — optional free-text (upstream system id).

Hit **Save**. The form posts `POST /invoicing-api/invoices` with an `Idempotency-Key` header. Server returns `{ data: Invoice }`; the SPA routes you to `/invoices/:id`. The server picks `invoice_number` via the org's `next_doc_number('invoice')` sequence.

### From a quote via the "From Quote" dialog

On `/invoices/new` or `/invoices` click **From quote**. Pick the source quote (must be in `approved` or `project_pending` status) and a `due_date`. The dialog posts `POST /invoicing-api/invoices/from-quote` which calls the `convert_quote_to_invoice(uuid, date)` SECURITY DEFINER RPC (added in migration 0052). The RPC:

- creates a new `draft` invoice with the supplied `due_date`,
- snapshots the customer, currency, and tax from the quote,
- copies every quote line item into `invoice_line_items` (per-line snapshots preserved),
- stamps `converted_from_type='quote'` + `converted_from_id=<quote_id>` and the `quote_id` link.

The recompute trigger fires on each line insert; the resulting `total_cents` / `subtotal_cents` / `tax_cents` match the source quote exactly (per F-Wave5-02 half-even rounding parity).

If the source quote is not in `approved` or `project_pending` status, the handler returns **409 STATE_CONFLICT** with `details.code = 'CONVERT_QUOTE_WRONG_STATUS'`.

### From a project via the "From Project" dialog

On `/invoices/new` or `/invoices` click **From project**. Pick the source project and a `due_date`. Posts `POST /invoicing-api/invoices/from-project`, which spawns a new `draft` invoice with the project's customer + currency snapshots and the `project_id` link. Wave 5 does not yet copy project deliverables as line items (Phase 12 will wire the per-deliverable billing surface); the invoice lands empty and you add lines manually.

## Line items

Open a draft. The **Line items** panel is the lower half of the detail view; it shows a tabular editor with one row per line. Each row carries:

- **Item** — picker against `inventory-api/items`. Optional — you can author a line freehand by typing the description and price.
- **Description** — required free-text (snapshotted at the moment of the line; later edits to the item don't propagate back).
- **Quantity** — numeric. Decimal-friendly (the DB column is `numeric(14,4)`).
- **Unit** — free-text label (e.g., `each`, `hour`, `pallet`). Not a `unit_id` foreign key — the Wave 5 line table stores the unit label, not a reference.
- **Unit price** — entered through `MoneyInput`; the wire stores `unit_price_cents`.
- **Unit cost** — same shape; defaults to 0.
- **Discount** — entered as cents per line (not a percent). There is no header-level discount percent.
- **Tax** — defaults to the invoice header's tax. Changing it per line is allowed; the rate is snapshotted into `tax_rate_snapshot` at write time.
- **Position** — drag to reorder.

The math per line:

```
line_subtotal_cents = round(quantity * unit_price_cents) - discount_cents
tax_amount_cents    = roundHalfEven(line_subtotal_cents * tax_rate_snapshot)   // F-Wave5-02
line_total_cents    = line_subtotal_cents + tax_amount_cents
```

F-Wave5-02 (PR #45) flipped per-line tax rounding to **half-even** across SPA, BE, and every test fixture (closes R-W3-07). The DB recompute trigger uses the same half-even rule for the header rollup, so SPA-side previews and final DB totals agree byte-for-byte.

The editor uses a **bulk replace** semantic: hitting **Save** posts `POST /invoicing-api/invoices/:id/line-items` with the entire array. The server deletes all existing lines and inserts the supplied set. There are also single-line **Append** (`POST .../line-items/append`), **Patch** (`PATCH .../line-items/:line_id`), and **Delete** (`DELETE .../line-items/:line_id`) routes if you prefer fine-grained edits. The **Reorder** action posts the new array of line ids.

After every line mutation the DB recompute trigger on `invoice_line_items` AIUD rolls totals up to the parent invoice automatically — handlers do not manually update the parent.

Once the invoice leaves `draft`, every line-item write returns **409 STATE_CONFLICT** with `details.code = 'INVOICE_LOCKED_AFTER_ISSUE'`. The editor switches to read-only.

## Workflow buttons

The detail page surfaces one or more workflow buttons in the header, depending on the current status and your capabilities. Each button shows a tooltip describing the `from → to` transition:

- **Submit** (visible on `draft`; cap `invoices.write`) — `POST /invoices/:id/submit`. Moves `draft → pending` and stamps `pending_at`.
- **Send** (visible on `pending` | `on_hold` | `sent`; cap `invoices.send`) — opens a small form (`email`, optional `message`); posts `POST /invoices/:id/send`. Moves to `sent` and stamps `sent_at` on the first transition. Re-sends on `sent` are idempotent and do not re-stamp the timestamp. Wave 5 writes an activity row and does NOT yet wire an actual mail transport (Phase 19 surface).
- **Hold** (visible on `pending` | `sent`; cap `invoices.write`) — opens an optional reason dialog; posts `POST /invoices/:id/hold`. Moves to `on_hold` and stamps `on_hold_at`.
- **Release** (visible on `on_hold`; cap `invoices.write`) — opens an optional reason dialog; posts `POST /invoices/:id/release`. Moves `on_hold → pending` and clears `on_hold_at`.
- **Void** (visible on any non-terminal status; cap `invoices.void`) — opens a required reason dialog; posts `POST /invoices/:id/void`. Moves to `cancelled` and stamps `cancelled_at` + `cancellation_reason`. **NOTE**: the dispatch text contract names this transition "void"; the prod schema models it as `status='cancelled'`. The handler returns **409 STATE_CONFLICT** with `details.code = 'INVOICE_HAS_PAYMENTS'` if there are non-voided payments rolled up (you must void those first).
- **Duplicate** (visible everywhere; cap `invoices.write`) — `POST /invoices/:id/duplicate`. Clones the header + all lines into a new `draft` with a fresh `invoice_number`. The new invoice has its own id; it is not a version of the source.
- **Download PDF** (visible everywhere; cap `invoices.read`) — `GET /invoices/:id/pdf`. **Returns 501** with code `PDF_NOT_YET_AVAILABLE`. Phase 19 will wire actual rendering; the button is rendered today so the eventual rollout is a one-line route-handler swap.

The buttons hide themselves when the transition is illegal or when your role lacks the capability. If you somehow trigger an illegal transition (e.g., via an API call), the server returns **409 STATE_CONFLICT** with `details.code = 'STATE_TRANSITION_ILLEGAL'`.

## Versions

The detail page has a **Versions** tab. Every header update on an invoice writes a row to `invoice_versions` via the `mirror_invoice_to_current_version` AFTER UPDATE trigger (added in migration 0052); the `create_v1_for_invoice` AFTER INSERT trigger writes `version_number = 1` on insert. Versions are read-only and capture status + payment_status + issue_date + due_date + notes + currency_code + the four `_cents` totals + `paid_cents` at the moment of the change. The versions list is sorted `version_number DESC`.

## Payments tab

The detail page has a **Payments** tab listing every payment recorded against this invoice. Each row shows `payment_number`, `paid_at`, `amount_cents`, the payment method, the reference, and a void badge if `voided_at` is set.

Click **Record payment** to open a small dialog (the same dialog the standalone `/payments/new` page uses, pre-filled with this invoice). Required fields: `amount_cents` (capped at `invoice.balance_cents`), `paid_at`. The currency is pinned to the invoice's `currency_code` and validated server-side by the `assert_invoice_payment_currency` trigger (added in migration 0052).

Once you save, the `recompute_invoice_totals` trigger fires on the payment insert and rolls the new amount into `invoice.paid_cents` + `invoice.balance_cents` + `invoice.payment_status`. If the new `paid_cents >= total_cents` the trigger also bumps the invoice status to `paid` and stamps `paid_at`.

See **[Payments](./payments.md)** for the full payment surface.

## Credit Notes tab

The detail page has a **Credit Notes** tab listing every credit note that points at this invoice (`credit_notes.invoice_id = invoice.id` with `status IN ('issued', 'applied')`).

Click **Apply credit** to navigate to the credit-note apply dialog (or to the credit-notes list filtered by this customer if you don't yet have one issued).

**Wave 5 known limitation:** the credit-note apply handler stamps the link and bumps `applied_cents` on the credit note but does NOT mutate the invoice's `paid_cents`. The synthetic-payment-row strategy proposed in schema master §9.6 is not viable on prod (`payments.amount_cents > 0` CHECK is fine but `payment_method_id` is a `uuid` FK, not the text `'credit_note'`, and `payments.invoice_id` is `NOT NULL`). The invoice-side rollup of credit notes is **deferred to Phase 9** (likely via a new `credit_note_allocations` table). See **[Credit notes](./credit-notes.md)** for the workflow.

## What's coming next

Phase 9 owns the canonical invoice-side rollup of credit notes (the deferred work above). Phase 12 GL pass wires the overdue auto-flag job and the refund handler. Phase 19 wires the PDF generator and the actual mail transport behind `/send`.
