# Inventory API

Wave 3 ships the `inventory-api` Edge Function bundle. It exposes items, item categories, and units under `https://<project>.functions.supabase.co/inventory-api/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply to every endpoint below. This file is the per-module delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts` (byte-mirrored to `apps/web/src/lib/types.ts`).
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`.
- Money is integer cents on the wire (field names end in `_cents`).
- Bundle `inventory-api` enforces `verify_jwt = true`.

## RBAC at the bundle

- `org_owner`, `org_admin` — read and write everything.
- `ops`, `sales` — read and write items / categories / units.
- `accounting`, `viewer`, `customer_user` — read only.

## Items

Wave 3 renamed the legacy `pricing_menu` table to `items` (migration 0049). The 34 pre-Wave-0 rows are visible immediately; new columns (`currency_code`, `unit_id`, `category_id`, `tax_id`, `is_inventoried`, `reorder_point`) are NULL on the legacy rows and required-or-defaulted on new ones.

A backwards-compat read-only view `public.pricing_menu` over `items` filtered by `item_kind` is retained; nothing in the SPA reads it. Target drop: Wave 4 after zero-caller telemetry.

### list-items / get-item

`GET /inventory-api/items`
`GET /inventory-api/items/{id}`

- RBAC: `inventory.items.read`.
- Idempotent: yes (GET).
- Filters: `category_id`, `q` (ILIKE on description + item_code), `is_active`, `is_inventoried`.
- Pagination: `limit` (default 50, max 200), opaque `cursor`.
- Sort: `created_at DESC, id DESC`.

```ts
export const ItemSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  item_code: z.string().min(1),         // SKU; unique per org
  description: z.string().min(1),       // display-name surface
  /** Legacy free-text category; deprecated in favor of category_id. */
  category: z.string().nullable(),
  category_id: UuidSchema.nullable(),
  item_kind: z.enum(['labor', 'material', 'pass_through', 'fee', 'service']),
  unit_id: UuidSchema.nullable(),
  tax_id: UuidSchema.nullable(),
  currency_code: z.string().length(3).nullable(),
  unit_price_cents: CentsSchema,
  unit_cost_cents: CentsSchema,
  markup_pct: z.number().nullable(),
  is_active: z.boolean(),
  is_inventoried: z.boolean(),
  reorder_point: z.number().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
});
```

```bash
curl -H "Authorization: Bearer $JWT" \
  "$BASE/inventory-api/items?q=widget&is_active=true&limit=20"
```

### create-item / patch-item

`POST /inventory-api/items`
`PATCH /inventory-api/items/{id}`

- RBAC: `inventory.items.write` (org_admin / ops / sales).
- `item_code` is unique per org; duplicate insert returns `409 STATE_CONFLICT`.

```ts
export const ItemCreateSchema = z.object({
  item_code: z.string().min(1),
  description: z.string().min(1),
  item_kind: z.enum(['labor', 'material', 'pass_through', 'fee', 'service']).default('material'),
  category_id: UuidSchema.nullable().optional(),
  unit_id: UuidSchema.nullable().optional(),
  tax_id: UuidSchema.nullable().optional(),
  currency_code: z.string().length(3).nullable().optional(),
  unit_price_cents: CentsSchema.default(0),
  unit_cost_cents: CentsSchema.default(0),
  markup_pct: z.number().nullable().optional(),
  is_inventoried: z.boolean().default(false),
  reorder_point: z.number().nullable().optional(),
});
export const ItemPatchSchema = ItemCreateSchema.partial();
```

### archive-item

`POST /inventory-api/items/{id}/archive`

- RBAC: `inventory.items.write`.
- Sets both `deleted_at = now()` AND `is_active = false`. The list endpoint filters `deleted_at IS NULL` by default; pass `is_active=false` in the query string to surface archived rows on top of that.

## Item categories

Org-scoped tree. The handler returns a **flat list**; the SPA composes the tree from `parent_id` client-side. No depth limit is enforced server-side; the SPA's `CategoryTree` component handles arbitrary nesting.

### list-item-categories / create / patch / delete

`GET /inventory-api/item-categories`
`POST /inventory-api/item-categories`
`PATCH /inventory-api/item-categories/{id}`
`DELETE /inventory-api/item-categories/{id}`

- RBAC: `inventory.categories.read` for GET; `inventory.categories.write` for non-GET (org_admin / ops).
- DELETE blocked with `409 STATE_CONFLICT` (`details.code = 'CATEGORY_REFERENCED'`) if any item references the category. The pre-delete check is explicit (`.eq('category_id', id)` count); not relying on the DB FK error.

```ts
export const ItemCategorySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1),      // unique per org
  label: z.string().min(1),
  parent_id: UuidSchema.nullable(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export const ItemCategoryCreateSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  parent_id: UuidSchema.nullable().optional(),
  is_active: z.boolean().default(true),
});
export const ItemCategoryPatchSchema = ItemCategoryCreateSchema.partial();
```

## Units

Org-scoped catalog. Wave 3 seeds 5 defaults per org: `each`, `hour`, `pallet`, `kg`, `lb`.

### list-units / create / patch / delete

`GET /inventory-api/units`
`POST /inventory-api/units`
`PATCH /inventory-api/units/{id}`
`DELETE /inventory-api/units/{id}`

- RBAC: `inventory.units.read` for GET; `inventory.units.write` for non-GET (org_admin / ops).
- DELETE blocked with `409 STATE_CONFLICT` (`details.code = 'UNIT_REFERENCED'`) if any item references the unit.

```ts
export const UnitSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1),                   // unique per org
  label: z.string().min(1),
  family: z.enum(['count', 'time', 'weight', 'length']).nullable(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export const UnitCreateSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  family: z.enum(['count', 'time', 'weight', 'length']).nullable().optional(),
  is_active: z.boolean().default(true),
});
export const UnitPatchSchema = UnitCreateSchema.partial();
```

## Errors

Domain codes for inventory-api on top of the universal set:

| Code | HTTP | When |
|---|---|---|
| `STATE_CONFLICT` (`details.code = 'CATEGORY_REFERENCED'`) | 409 | DELETE /item-categories/{id} with referencing items |
| `STATE_CONFLICT` (`details.code = 'UNIT_REFERENCED'`) | 409 | DELETE /units/{id} with referencing items |
| `STATE_CONFLICT` | 409 | Duplicate `item_code` (org-unique) on create |

## Versioning

The `inventory-api` bundle is at `v19`. Schema-impacting changes ride `migrate.yml` (currently at `0049`).
