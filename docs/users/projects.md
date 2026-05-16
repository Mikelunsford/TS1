# Projects

Wave 4 lights up the projects surface. A project is the operational record that follows a quote into the shop: it has a BOM (Phase 6), receivings (Phase 10), production runs (Phase 11), shipments (Phase 12), and an invoice (Phase 7) all hanging off it. Wave 4 ships the header + phases editor + lifecycle workflow; the downstream surfaces light up in later phases. The page lives at `/projects` and is reachable to staff roles with `projects.read`.

This walkthrough covers: where projects come from, browsing them, editing the header, the lifecycle and how to close / reopen, and managing phases.

## Where projects come from

Most projects come from the quote-convert flow. From an `approved` quote, click **Convert to project** — the SPA posts `POST /quotes-api/quotes/:id/convert-to-project` with the new project name and an optional due date. The server calls the existing `convert_quote_to_project(uuid, text, timestamptz)` RPC, which atomically creates a `projects` row, transitions the source quote to `project_pending`, and returns the new project. You're routed straight to `/projects/:id`.

You can also create a project directly via the **New project** button on `/projects` (capability `projects.write`) — for ad-hoc work where there's no source quote, or to backfill an existing job. The form takes a name, customer (optional), currency, total, budget, and due date. Most users won't need this path.

## What a project carries

A project header is one row in `projects` (migration 0042 + 0050). It has:

- **Project number** — auto-assigned via `next_doc_number('project')`.
- **Name** — the operational label (`name` column; not `display_name`).
- **Source quote** — optional `quote_id` FK back to the original quote.
- **Customer** — `customer_id` + denormalized `customer_name`.
- **Status** — the lifecycle (see below).
- **Currency** — defaults from the source quote / org.
- **Total** + **Budget** — money fields in cents. Total is what the customer pays; budget is what you're allowed to spend internally.
- **Due date** — optional timestamp.
- **Invoice** — optional `invoice_id` once Phase 7 hooks it up.
- **Lifecycle timestamps** — `bom_finalized_at`, `ready_to_build_at`, `sent_to_production_at`, `production_started_at`, `production_completed_at`, `ready_to_ship_at`, `shipping_completed_at`. The handlers stamp the relevant column on each transition; the detail page surfaces them on the activity timeline.

## Lifecycle

Projects have six states. The state machine is enforced server-side; the SPA hides illegal action buttons.

```
pending ──► ready_to_build ──► in_production ──► ready_to_ship ──► completed
   │              │                  │                  │             │
   └──────────────┴──────────────────┴──────────────────┴─────► cancelled
                                                                      ▲
                                              (terminal: cancelled is reachable from any state)

completed ──reopen──► in_production
completed ──reopen──► ready_to_ship
```

- **pending** — created. BOM is not yet finalized.
- **ready_to_build** — BOM signed off; awaiting the production hand-off.
- **in_production** — work in progress on the shop floor.
- **ready_to_ship** — production complete; awaiting shipment.
- **completed** — shipped (or otherwise fully done). The header stamps `shipping_completed_at`.
- **cancelled** — terminal. Killed off mid-flight.

`completed` is reopenable. The detail page has a **Reopen** button that drops the project back to `in_production` by default, or `ready_to_ship` if you choose. Reopen clears the `shipping_completed_at` stamp.

`cancelled` is **not** reopenable today. If you cancel and need to come back, create a new project (or run the quote-convert flow again from the source quote, which now requires a new quote since the original is in `project_pending`).

## Browsing projects

Navigate to `/projects`. You see a header (`Projects`), a filter row, and a table.

The filter row:

- a free-text **Search** input (matches `project_number` and `name`),
- a **Status** picker (multi-select of the six states),
- a **Customer** picker,
- a date range for `created_at` and `due_date`.

Table columns: **Project #**, **Name**, **Customer**, **Status** (pill), **Total**, **Due**, **Created**. Pagination uses an opaque cursor.

Click any row to open `/projects/:id`.

## Editing the header

From the detail page, click **Edit**. The form mirrors the create surface — name, customer, currency, total, budget, due date. Hit **Save**. The wire sends `PATCH /projects-api/projects/:id` with an `Idempotency-Key`. There is no "lock after start" — header edits are allowed at any state, but the lifecycle timestamps are only stamped by the workflow buttons; you can't backdate them by hand.

## Closing and reopening

The **Close** button (capability `projects.close`) is visible from any non-`completed`, non-`cancelled` state. It opens a reason dialog (optional) and posts `POST /projects/:id/close`. The handler transitions the project to `completed` and stamps `shipping_completed_at = now()` if it wasn't already set. The reason is written as an activity row.

The **Reopen** button (same capability) is visible only on `completed`. It posts `POST /projects/:id/reopen` with `{ to: 'in_production' | 'ready_to_ship' }` (default `in_production`) and clears `shipping_completed_at`. The handler validates via the same state machine, so you can't reopen into `pending` or earlier.

To cancel a project, use the workflow buttons on the lifecycle widget on the detail page (any state → `cancelled`). The button is gated by `projects.write`; the activity row captures the reason.

## Phases

A project is a sequence of phases. Phases give you a planning + status surface beneath the header — think "Engineering / Procurement / Fabrication / Assembly / QA" or whatever your shop calls them. Wave 4 ships phases as free-form (no template); Phase 6 (BOM) and Phase 11 (production runs) will hang off them.

The **Phases** panel on `/projects/:id` shows a sortable list. Each row carries:

- **Position** — drag to reorder.
- **Name** — required free-text.
- **Description** — optional free-text.
- **Status** — `pending` / `active` / `completed` / `cancelled`. Pill in the row; menu to change.
- **Planned start** + **Planned end** — timestamps (not dates — DB column is `timestamptz`).
- **Actual start** + **Actual end** — stamped by the server on the first `→ active` and `→ completed` transitions respectively.
- **Budget** — cents.
- **Notes** — free-text.

### Phase lifecycle

```
pending ──► active ──► completed
   │           │
   └─cancel────┴─► cancelled
                       ▲
   (terminal cancel reachable from any state)

completed ──reopen──► active
```

- **pending** — created, not yet started.
- **active** — work in progress. First transition into this state stamps `actual_start_at = now()`.
- **completed** — done. First transition into this state stamps `actual_end_at = now()`.
- **cancelled** — terminal; the row sticks around for audit.

### Phase actions

- **New phase** (cap `projects.write`) — `POST /projects/:project_id/phases`. Position defaults to the end of the list.
- **Edit** (cap `projects.write`) — `PATCH /projects/:project_id/phases/:phase_id`. Name, description, planned times, budget, notes.
- **Change status** — `PUT /projects/:project_id/phases/:phase_id/status`. Gated by the state machine; illegal transitions return **409 STATE_CONFLICT**.
- **Reorder** — drag handles; `POST /projects/:project_id/phases/reorder` with the new array of phase ids. Uses a two-pass negative-shift to stay safe under any uniqueness constraint on `(project_id, position)`.
- **Delete** — `DELETE /projects/:project_id/phases/:phase_id`. **Soft delete** — the row stays in the DB with a `deleted_at` stamp; it's removed from the list view but preserved for audit. There is no hard-delete from the UI.

## What's coming next

Phase 6 ships the BOM editor that hangs off the project + uses phases for grouping. Phase 7 ships invoice generation from the project; the `invoice_id` column on the header lights up at that point. Phase 10 (receiving orders), Phase 11 (production runs), and Phase 12 (shipments) all consume `project_id` once they ship.
