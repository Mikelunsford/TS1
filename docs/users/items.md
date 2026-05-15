# Items

Wave 3 lights up the items catalog. Items are the SKUs you sell, buy, or list as labor — they back quote lines, invoice lines, expense lines, and inventory. The page lives at `/items` and is reachable to any signed-in member with `inventory.items.read` (every role today; the real capability matrix lands later).

This walkthrough leads you from sign-in to the four core flows: browsing items, creating a category tree, creating an item with a unit / tax / currency / default price, and archiving an item that's no longer offered.

## Signing in

Hit the sign-in screen at your org's host (for the default tenant, `team1.example.com`) and submit your credentials. On success you land on `/dashboard`. The left nav now exposes an **Inventory** section with two children: **Items** and **Categories**.

## Browsing items

Navigate to `/items`. You see a header (`Items`), a filter row, and a table.

The filter row contains:

- a free-text **Search** input (matches `description` and `item_code`),
- a **Category** picker (loaded from `inventory-api/item-categories`),
- an **Archived** toggle to include soft-deleted rows,
- an **Inventoried only** toggle (filters to items with `is_inventoried = true`).

The table columns are: **Code** (`item_code`), **Description**, **Category**, **Unit price**, **Unit cost**, **Currency**, **Active**. The first paint is a skeleton; the API call to `inventory-api/items` replaces it as soon as it resolves.

Prices render through `MoneyDisplay` — every row uses its own `currency_code` so a USD item and a EUR item show side-by-side correctly. Items shipped from the pre-Wave-0 chassis carry `currency_code = NULL`; they fall back to `USD` in the display until you edit them.

Pagination uses an opaque cursor in the URL (`?cursor=...`); the default page size is 50 (max 200). An empty filter result shows the empty state with a primary action linking to the New Item page.

Click any row to drill in.

## Creating a category tree

Categories give items hierarchy. Navigate to `/items/categories` (sidebar: Inventory → Categories).

The page shows a flat editor and a tree preview. Each category has:

- `code` (unique within your org),
- `label`,
- optional `parent_id` (drag-into-row or pick from the dropdown).

Click **New category**, fill `code` + `label`, optionally pick a parent, and save. The tree updates in place. Categories are soft-protected against deletion: if any item references the category, the delete button returns **409 STATE_CONFLICT** and the toast tells you which item.

There is no per-org default category. New items can leave `category_id` null until you start grouping.

## Creating an item

From `/items` click **New item**, or open an existing row and click **Edit**.

The form fields are:

- **Name** — maps to `description`. Required.
- **SKU / Item code** — maps to `item_code`. Required and unique across your org.
- **Kind** — one of `labor` / `material` / `pass_through` / `fee` / `service`.
- **Category** — picker.
- **Unit** — picker. Wave 0 seeds 5 units per org: `each`, `hour`, `pallet`, `kg`, `lb`.
- **Tax** — picker. Wave 3 seeds one default 0% tax (`TAX-0`).
- **Currency** — picker. Wave 3 seeds 10 ISO 4217 currencies (USD, EUR, GBP, CAD, MXN, AUD, JPY, CHF, BRL, INR).
- **Unit price** and **Unit cost** — entered through `MoneyInput`. You type the dollars-and-cents string; the form stores integer cents on the wire (`unit_price_cents`, `unit_cost_cents`). The math helper at `lib/money.ts` is the only path; no float drift.
- **Is inventoried** — boolean; when true, the item participates in stock movements (Phase 13 surface; the field is durable today).
- **Reorder point** — `numeric(14,4)` quantity threshold used by future stock alerts.

Hit **Save**. The first save sends `POST /inventory-api/items` with an `Idempotency-Key` header; subsequent saves on the same form session reuse the key (replays are no-op). Server returns the canonical envelope `{ data: Item }`; the form rebinds to the returned row.

## Archiving an item

From the detail page, click **Archive**. This issues `POST /inventory-api/items/{id}/archive`. The handler sets both `deleted_at = now()` and `is_active = false`. The list page filters out soft-deleted rows by default; flip **Archived** on the filter row to see them.

There is no hard-delete from the UI today. The legacy `pricing_menu` table is now a backwards-compat view over `items`; nothing reads it from the SPA, but it stays in place until Wave 4 confirms zero external callers.

## What's coming next

Quote lines (Phase 4) consume `item_id`, snapshot `unit_price_cents` + `currency_code` + `tax_id` at issue, and store the rounded `line_total_cents` + `tax_amount_cents` per line. Invoice lines (Phase 7) and PO lines (Phase 10) follow the same shape. None of those flows surface in the UI yet.
