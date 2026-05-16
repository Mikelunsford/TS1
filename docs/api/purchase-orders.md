# Purchase orders API

Wave 7 (PR #61) ships the `/purchase-orders` resource under the `vendors-api` bundle. POs are the order-side procurement document. Line items live at `/purchase-orders/:id/lines` (in the same bundle).

Base URL: `https://<project>.functions.supabase.co/vendors-api/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply. This file is the per-resource delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts`.
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`.
- Money is integer cents on the wire.
- `issue_date` / `expected_date` are calendar `date` strings (`YYYY-MM-DD`).
- Bundle `vendors-api` enforces `verify_jwt = true`.

## RBAC

- `org_owner`, `org_admin` — full reach.
- `accounting`, `ops` — read + write + receive.
- `accounting` only — approve.
- `accounting`, `org_owner`, `org_admin` — cancel.
- `sales`, `viewer` — read only.
- `customer_user` — no access.

## State machine

Prod `purchase_orders.status` text CHECK has **seven** values:

| State | Description |
|---|---|
| `draft` | Header + lines editable. Only initial state for new POs. |
| `submitted` | Sent for approval. Can be sent back to `draft` for revision. |
| `approved` | Vendor notified; awaiting receipt. |
| `partial_received` | Some lines have `quantity_received > 0` but not all are full. |
| `received` | Every line has `quantity_received >= quantity`. |
| `closed` | Terminal accounting close-out marker (after bills reconciled). |
| `cancelled` | Terminal. Reachable from any non-terminal state. |

**Spelling**: `partial_received` (one r in "partial"), NOT `partially_received`. The DB CHECK and the workflow matrix use this spelling.

Legal transitions (`_shared/workflow.ts#PURCHASE_ORDER_TRANSITIONS`):

| From | To |
|---|---|
| `draft` | `submitted`, `cancelled` |
| `submitted` | `approved`, `draft`, `cancelled` |
| `approved` | `partial_received`, `received`, `cancelled` |
| `partial_received` | `received`, `cancelled` |
| `received` | `closed`, `cancelled` |
| `closed` | _(terminal)_ |
| `cancelled` | _(terminal)_ |

`from === to` is always legal (idempotent). Illegal transitions return **409 STATE_CONFLICT**.

Every state-changing handler stamps `state_changed_at = now()`. POs use a single state-changed timestamp (the Wave 0 chassis convention) — there are no per-state stamps like `approved_at`. The audit-log surface (Phase 17) is the cross-table source of truth for who-did-what-when.

## PurchaseOrder (Zod canon)

```ts
export const PurchaseOrderStateSchema = z.enum([
  'draft', 'submitted', 'approved', 'partial_received', 'received', 'cancelled', 'closed',
]);

export const PurchaseOrderSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  po_number: z.string(),
  vendor_id: UuidSchema,
  project_id: UuidSchema.nullable(),
  status: PurchaseOrderStateSchema,
  issue_date: z.string().date(),
  expected_date: z.string().date().nullable(),
  currency_code: z.string().length(3),
  subtotal_cents: CentsSchema,                       // trigger-maintained
  tax_cents: CentsSchema,
  shipping_cents: CentsSchema,
  total_cents: CentsSchema,                          // trigger-maintained = subtotal + tax + shipping
  notes: z.string().nullable(),
  state_changed_at: TimestampSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
});
```

## POLineItem (Zod canon)

```ts
export const POLineItemSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  po_id: UuidSchema,
  item_id: UuidSchema.nullable(),                    // optional link to inventory.items
  description: z.string(),
  quantity: z.number(),                              // numeric — decimal-friendly
  quantity_received: z.number(),
  unit: z.string().nullable(),                       // free-text label, NOT a unit_id FK
  unit_cost_cents: CentsSchema,
  line_total_cents: CentsSchema,                     // round_half_even(quantity * unit_cost_cents)
  position: z.number().int().nonnegative(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

Line total math (F-Wave5-02 half-even rounding):

```
line_total_cents = roundHalfEven(quantity * unit_cost_cents)
```

The trigger `tg_po_lines_recompute` (AIUD, added in migration 0058) calls `recompute_purchase_order_totals(po_id)` after every line write. The function sets `purchase_orders.subtotal_cents := SUM(line_total_cents)`, `purchase_orders.total_cents := subtotal + tax + shipping`, and stamps `updated_at`. Handlers MUST NOT update the parent totals manually; the trigger owns the rollup.

## Routes

### Header CRUD

| Route | Method | RBAC | Idempotent | Purpose |
|---|---|---|---|---|
| `/purchase-orders` | GET | `purchase_orders.read` | no | List |
| `/purchase-orders/{id}` | GET | `purchase_orders.read` | no | Detail with lines |
| `/purchase-orders` | POST | `purchase_orders.write` | yes | Create draft |
| `/purchase-orders/{id}` | PATCH | `purchase_orders.write` | yes | Edit draft |

### list-purchase-orders / get-purchase-order

- Filters: `status`, `vendor_id`, `project_id`.
- Pagination: `limit`, opaque `cursor`.
- Sort: `created_at DESC, id DESC`.
- `GET /purchase-orders/{id}` returns `{ ...PurchaseOrder, lines: POLineItem[] }` (lines sorted `position ASC`).

### create-purchase-order

```ts
export const PurchaseOrderCreateSchema = z.object({
  vendor_id: UuidSchema,
  project_id: UuidSchema.nullable().optional(),
  issue_date: z.string().date().optional(),         // defaults to today
  expected_date: z.string().date().nullable().optional(),
  currency_code: z.string().length(3).optional(),   // defaults 'USD'
  tax_cents: z.number().int().nonnegative().optional(),
  shipping_cents: z.number().int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(z.object({
    item_id: UuidSchema.nullable().optional(),
    description: z.string().min(1).max(2000),
    quantity: z.number().positive(),
    unit: z.string().max(32).nullable().optional(),
    unit_cost_cents: z.number().int().nonnegative(),
    position: z.number().int().nonnegative().optional(),
  })).optional(),
}).strict();
```

- The server picks `po_number` via `next_doc_number(org, 'purchase_order')`.
- The handler inserts the header + each line in one round-trip; the trigger fires per line and rolls up the totals.

### patch-purchase-order

```ts
export const PurchaseOrderPatchSchema = z.object({
  project_id: UuidSchema.nullable().optional(),
  issue_date: z.string().date().optional(),
  expected_date: z.string().date().nullable().optional(),
  currency_code: z.string().length(3).optional(),
  tax_cents: z.number().int().nonnegative().optional(),
  shipping_cents: z.number().int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
}).strict();
```

- **Only allowed while `status = 'draft'`.** Outside `draft` returns **409 STATE_CONFLICT** with the message `cannot edit PO in status=<status>`.
- The `vendor_id` is NOT patchable — to re-target the PO at a different vendor, cancel and re-create.

### Workflow transitions

| Route | Method | RBAC | Body | Effect |
|---|---|---|---|---|
| `/purchase-orders/{id}/submit` | POST | `purchase_orders.write` | `{}` | `draft → submitted` |
| `/purchase-orders/{id}/approve` | POST | `purchase_orders.approve` | `{}` | `submitted → approved` |
| `/purchase-orders/{id}/cancel` | POST | `purchase_orders.cancel` | `{}` | `(any non-terminal) → cancelled` |
| `/purchase-orders/{id}/close` | POST | `purchase_orders.write` | `{}` | `received → closed` |
| `/purchase-orders/{id}/receive` | POST | `purchase_orders.receive` | `PurchaseOrderReceiveSchema` | Updates `quantity_received` per line; auto-transitions to `partial_received` or `received` |

All five require `Idempotency-Key`.

### receive (partial + full)

```ts
export const PurchaseOrderReceiveSchema = z.object({
  lines: z.array(z.object({
    po_line_item_id: UuidSchema,
    quantity_received: z.number().nonnegative(),
  })).min(1),
}).strict();
```

Semantics:

1. Updates each line's `quantity_received`.
2. Re-reads all lines and computes `allReceived = lines.every(l => l.quantity_received >= l.quantity)`.
3. Transitions the PO to `received` if `allReceived`, else `partial_received`.
4. Stamps `state_changed_at = now()`.

Only legal from `approved` or `partial_received`. From other states the handler returns **409 STATE_CONFLICT** with the message `cannot receive PO in status=<status>`.

```bash
# Submit + approve + partial receive flow
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{}' \
  "$BASE/vendors-api/purchase-orders/$POID/submit"

curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{}' \
  "$BASE/vendors-api/purchase-orders/$POID/approve"

curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"lines":[{"po_line_item_id":"'$L1'","quantity_received":2}]}' \
  "$BASE/vendors-api/purchase-orders/$POID/receive"
```

### Line items

| Route | Method | RBAC | Idempotent | Purpose |
|---|---|---|---|---|
| `/purchase-orders/{id}/lines` | POST | `purchase_orders.write` | yes | Append a line |
| `/purchase-orders/{id}/lines/{lineId}` | PATCH | `purchase_orders.write` | yes | Update a line |
| `/purchase-orders/{id}/lines/{lineId}` | DELETE | `purchase_orders.write` | yes | Remove a line |

All three are **draft-only**. From any other status they return **409 STATE_CONFLICT** with `cannot edit lines in PO status=<status>` (or `cannot delete lines in PO status=<status>` on DELETE).

```ts
export const POLineItemCreateSchema = z.object({
  item_id: UuidSchema.nullable().optional(),
  description: z.string().min(1).max(2000),
  quantity: z.number().positive(),
  unit: z.string().max(32).nullable().optional(),
  unit_cost_cents: z.number().int().nonnegative(),
  position: z.number().int().nonnegative().optional(),
}).strict();

export const POLineItemPatchSchema = z.object({
  description: z.string().min(1).max(2000).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(32).nullable().optional(),
  unit_cost_cents: z.number().int().nonnegative().optional(),
  position: z.number().int().nonnegative().optional(),
}).strict();
```

On PATCH, if `quantity` or `unit_cost_cents` is touched the handler recomputes `line_total_cents` half-even using the current persisted values for any field not in the body. The trigger then fires and rolls up the PO header totals.

DELETE removes the row outright; line history before issue is not preserved at the line level (the cross-table audit log is the trace).

## Errors

| Code | HTTP | When |
|---|---|---|
| `NOT_FOUND` | 404 | PO id not visible (RLS or soft-deleted) |
| `STATE_CONFLICT` | 409 | Illegal transition, PATCH/lines outside `draft`, or receive outside `approved`/`partial_received` |
| `VALIDATION_ERROR` | 422 | Body fails Zod parse |
| `IDEMPOTENCY_CONFLICT` | 409 | Same key, different body hash |
| `INTERNAL_ERROR` | 500 | DB error (see `details.db`) |

## Versioning

PR #61 ships the full PO surface. Trigger `tg_po_lines_recompute` arrives in migration `0058`. See `TS1/09-api/00-API-CONTRACT.md` §10 for the cross-resource overview.
