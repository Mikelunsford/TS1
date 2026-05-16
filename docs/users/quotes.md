# Quotes

Wave 4 lights up the quoting workflow. A quote is the priced offer you hand a customer before you commit to building anything — it carries customer + contact info, a list of priced line items, snapshotted tax + currency, and a status that drives the lifecycle. Once accepted, you convert it into a Project (Wave 4 §5). The page lives at `/quotes` and is reachable to staff roles with `quotes.read`.

This walkthrough leads you from sign-in to the core flows: browsing quotes, drafting a new one, editing the line items, moving the quote through approval, and converting it into a project.

## Signing in

Hit the sign-in screen at your org's host (for the default tenant, `team1.example.com`) and submit your credentials. On success you land on `/dashboard`. The left nav now exposes a **Sales** section with two children: **Quotes** and **Projects**.

## What a quote is

A quote is one row in `quotes` plus zero-or-more `quote_line_items`. Each header carries:

- the customer (`customer_id` + a denormalized `customer_name` stamped at create so the row is readable even if the customer is later renamed),
- a contact (`contact_name` + `contact_email` — free text; no linked `contact_id` today),
- a **service type** (`co_pack` or `cross_dock` — the 3PL surface),
- an **origin** (`management` for staff-authored, `customer_intake` for portal-authored),
- a **mode** (`new_quote`, `revision`, `reorder`, `feasibility_only`, `scope_shift`),
- a **currency** + an optional **tax** (snapshotted onto each line at issue),
- a **status** (the lifecycle — see below),
- and the rolled-up money fields `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents` — recomputed from the lines after every edit.

There is also a `materials_only` boolean for the "we're only quoting parts, no labor" surface, and optional `job_type_id` / `opportunity_id` for the future CRM hook-up.

## Lifecycle

Quotes move through six states. The state machine is enforced server-side; the SPA hides illegal action buttons.

```
draft ──submit──► submitted ──approve──► approved ──convert──► project_pending
  │                  │                       │
  │                  └─request-revisions─► revise_requested ──submit──► submitted
  │                  │
  │                  └─decline──► cancelled
  │                                          ▲
  └─────────────────decline──────────────────┘
                                             │
                       approved ──decline────┘
```

- **draft** — the only state in which the header and lines are editable. Created by `POST /quotes` or `POST /quotes/:id/duplicate`.
- **submitted** — sent up the chain for approval. The submit handler auto-stamps `requires_approval = true` when `total_cents >= 2_500_000` ($25,000).
- **revise_requested** — bounced back to the author with a reason. Re-submit returns it to `submitted`.
- **approved** — an `org_owner` / `org_admin` (anyone with `quotes.approve`) signed off. Eligible for convert-to-project.
- **project_pending** — terminal-on-this-side. A project has been spawned; the quote is locked.
- **cancelled** — terminal. The quote is dead; create a new draft or duplicate from this row if you need to retry.

`cancelled` is reachable from `draft`, `submitted`, and `approved` via **Decline**. Once a quote leaves `draft`, the line item editor is read-only; the body and totals are frozen on the header. A copy of every state snapshot is written to `quote_versions` by trigger on every header update; see **Versions** below.

## Browsing quotes

Navigate to `/quotes`. You see a header (`Quotes`), a filter row, and a table.

The filter row contains:

- a free-text **Search** input (matches `quote_number` and `customer_name`),
- a **Status** picker (multi-select of the six states above),
- a **Customer** picker,
- a **Service type** picker (`co_pack` / `cross_dock`),
- a date range for `created_at`.

Table columns: **Quote #** (`quote_number`), **Customer**, **Status** (pill), **Service**, **Total**, **Created**, **Valid until**. Totals render through `MoneyDisplay` against the quote's own `currency_code`.

Pagination uses an opaque cursor in the URL (`?cursor=...`); the default page size is 50 (max 200). Click any row to drill into `/quotes/:id`.

## Creating a quote

From `/quotes` click **New quote**. The form fields are:

- **Customer** — picker. Once selected, the form stamps `customer_name` from the row (the wire stores both `customer_id` and the denormalized name).
- **Contact name** and **Contact email** — optional free-text.
- **Service type** — `co_pack` or `cross_dock`. Required.
- **Origin** — defaults to `management` for staff-authored quotes.
- **Mode** — defaults to `new_quote`. Pick `revision` / `reorder` / `feasibility_only` / `scope_shift` if you're following on from prior work.
- **Materials only** — boolean.
- **Job type** and **Opportunity** — optional pickers (Wave 5+ surfaces).
- **Currency** — defaults to your org's first active currency; required.
- **Tax** — picker (Wave 3 seeds `TAX-0` at 0%). The rate snapshots onto each line at line-create time.
- **Notes** — single free-text field. (There is no separate internal / customer split today; if you need that, prefix the note.)
- **Valid until** — optional timestamp. Customer-facing PDFs (Phase 19) will surface this.

Hit **Save**. The first save sends `POST /quotes-api/quotes` with an `Idempotency-Key` header. Server returns the canonical envelope `{ data: Quote }`; the form rebinds and routes you to `/quotes/:id`. The server picks the quote number via the org's `next_doc_number('quote')` sequence.

## Line items

Open a draft. The **Line items** panel is the lower half of the detail view; it shows a tabular editor with one row per line. Each row carries:

- **Item** — picker against `inventory-api/items`. Optional — you can author a line freehand by typing the description and price.
- **Description** — required free-text (snapshotted at the moment of the line; later edits to the item don't propagate back).
- **Quantity** — numeric. Decimal-friendly (the DB column is `numeric(14,4)`).
- **Unit** — free-text label (e.g., `each`, `hour`, `pallet`). Not a `unit_id` foreign key — the Wave 4 line table stores the unit label, not a reference.
- **Unit price** — entered through `MoneyInput`; the wire stores `unit_price_cents`.
- **Unit cost** — same shape; defaults to 0.
- **Discount** — entered as cents per line (not a percent). Wave 4 does NOT support a header-level discount percent; if you need a 10% off, apply it per line.
- **Tax** — defaults to the quote header's tax. Changing it per line is allowed; the rate is snapshotted into `tax_rate_snapshot` at write time.
- **Position** — drag to reorder.

The editor uses a **bulk replace** semantic: hitting **Save** posts `POST /quotes-api/quotes/:id/line-items` with the entire array. The server deletes all existing lines and inserts the supplied set. There are also single-line **Append** (`POST .../line-items/append`), **Patch** (`PATCH .../line-items/:line_id`), and **Delete** (`DELETE .../line-items/:line_id`) routes if you prefer fine-grained edits. The **Reorder** action posts the new array of line ids.

After every line mutation the server recomputes the quote header's `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents` from the line aggregate. The line totals use the same rounding rule as the rest of the platform (`Math.round` half-up via `lib/money.ts#taxTotalCents`).

Once the quote leaves `draft`, every line-item write returns **409 STATE_CONFLICT** with `details.code = 'QUOTE_LINE_PARENT_LOCKED'`. The editor switches to read-only.

## Workflow buttons

The detail page surfaces one or more workflow buttons in the header, depending on the current status and your capabilities:

- **Submit** (visible on `draft` / `revise_requested`; cap `quotes.write`) — `POST /quotes/:id/submit`. Moves to `submitted`. Auto-stamps `requires_approval` when total ≥ $25,000.
- **Approve** (visible on `submitted`; cap `quotes.approve`) — `POST /quotes/:id/approve`. Moves to `approved`.
- **Request revisions** (visible on `submitted`; cap `quotes.write`) — opens a reason dialog; posts `POST /quotes/:id/request-revisions` with the reason. Moves to `revise_requested`. The reason is written as an activity row.
- **Decline** (visible on `submitted` / `approved`; cap `quotes.write`) — opens a reason dialog; posts `POST /quotes/:id/decline`. Moves to `cancelled`. Reason captured as an activity row.
- **Send** (visible on `submitted` / `approved`; cap `quotes.send`) — opens a small form (`to_email`, optional `message`); posts `POST /quotes/:id/send`. **No state change** — Wave 4 only writes an activity row. Phase 19 will wire the actual email.
- **Accept** (customer-portal verb; cap `quotes.write` for the customer's own row) — `POST /quotes/:id/accept`. **No state change** — activity row only. The "accepted" surface is a Phase 18 portal feature; the route exists today so customer-portal sessions can record intent.
- **Convert to project** (visible on `approved`; cap `quotes.convert`) — opens the convert dialog (`project_name`, optional `due_date`); posts `POST /quotes/:id/convert-to-project`. Calls the existing `convert_quote_to_project(uuid, text, timestamptz)` SECURITY DEFINER RPC. Moves the quote to `project_pending` and returns `{ quote_id, project }` so the SPA can route you straight into the new project.
- **Duplicate** (visible everywhere; cap `quotes.write`) — `POST /quotes/:id/duplicate`. Clones the header + all lines into a new `draft` with a fresh `quote_number`. The new quote has its own id; it is not a version of the source.

The buttons hide themselves when the transition is illegal or when your role lacks the capability. If you somehow trigger an illegal transition (e.g., via an API call), the server returns **409 STATE_CONFLICT** with `details.code = 'STATE_TRANSITION_ILLEGAL'`.

## Versions

The detail page has a **Versions** tab. Every header update on a quote writes a row to `quote_versions` via the `mirror_quote_to_current_version` AFTER UPDATE trigger (regenerated in migration 0050); the create trigger writes `version_number = 1` on insert. Versions are read-only and capture status + service_type + mode + totals + notes at the moment of the change. The versions list is sorted `version_number DESC`.

## PDF export

The **Download PDF** button on the detail page currently returns **501 Not Implemented** with code `PDF_NOT_YET_AVAILABLE`. Phase 19 (post-Wave 4) wires the actual generator. The button is rendered so the eventual rollout is a one-line route-handler swap.

## What's coming next

Phase 18 brings the customer-portal accept-flow (the `/accept` route gets a real state transition; today it stays activity-only). Phase 19 brings the PDF generator and wires `/send` to an actual mail transport. Invoice generation from `project_pending` quotes lands in Phase 7.
