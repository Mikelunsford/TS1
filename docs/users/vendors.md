# Vendors

Wave 7 lights up the procurement surface. A **vendor** is a company you buy from — the supplier counterpart to the customer record. Vendors carry contact info, a default payment term, a default billing currency, and a `tax_id` for 1099 / VAT bookkeeping. They are the anchor for both purchase orders (the order-side document) and vendor bills (the AP-side invoice).

The user-facing pages (`/vendors`, `/vendors/:id`, `/vendors/new`) are **deferred to Wave 7b**. Wave 7 ships the backend API and Zod canon; the SPA surface lands in a follow-up wave. Everything described below is exercised today via the API documented in **[Vendors API](../api/vendors.md)**.

## What a vendor is

A vendor is one row in `public.vendors` carrying:

- **name** (`name`, NOT `display_name` — vendors did NOT participate in the Wave 6 customers rename; the canonical field is plain `name`) and optional **legal_name** for the full registered entity,
- contact fields `email`, `phone`, `website`,
- a `tax_id` (free-text string — used for 1099 / VAT / GST identifiers),
- a `currency_code` (3-char ISO) that defaults the currency on POs and vendor bills,
- a `payment_terms_days` integer (defaults to 30 if you create without it; used to default the `due_date` on vendor bills),
- a `billing_address` jsonb blob (no fixed shape — the form just round-trips whatever the SPA passes),
- an `external_ref` text column for upstream system ids,
- a `notes` free-text field,
- an `is_active` boolean (active vendors show on pickers; archived ones do not),
- and the usual `created_at` / `updated_at` / `deleted_at` chassis columns.

Vendors are org-scoped (RLS Pattern A — staff read, ops + accounting write). The unique key is `(org_id, name)` enforced at the application layer; the DB does not have a unique index on name today.

## Adding a vendor

`POST /vendors-api/vendors` with at minimum a `name`. Everything else is optional. The handler stamps `is_active=true`, `payment_terms_days=30` by default, and `billing_address={}` if not supplied.

A typical create body:

```json
{
  "name": "Acme Hardware",
  "legal_name": "Acme Hardware LLC",
  "email": "billing@acmehw.example",
  "phone": "+1-555-0101",
  "currency_code": "USD",
  "payment_terms_days": 45,
  "tax_id": "12-3456789",
  "billing_address": { "line1": "100 Industrial Way", "city": "Portland", "region": "OR", "postal": "97201" }
}
```

The response carries the full row including the server-stamped `id`. Once created, vendors can be linked from POs and vendor bills.

## Editing a vendor

`PATCH /vendors-api/vendors/:id`. Any of the create fields are patchable, plus `is_active` (used to un-archive). The PATCH does NOT require status to be in any particular state — vendor records do not have a workflow lifecycle. You can edit metadata at any time.

The patch is partial (`VendorPatchSchema` is `VendorCreateSchema.partial()` plus `is_active`). Omitted fields are not touched.

## Archiving (and un-archiving) a vendor

`POST /vendors-api/vendors/:id/archive` flips `is_active=false`. The row stays in the table (no row delete); the archive button keeps the record around for referential integrity (existing POs / vendor bills still point at it) while hiding the vendor from active pickers.

To un-archive, `PATCH /vendors-api/vendors/:id` with `{ "is_active": true }` — the archive route is one-way, but the patch route can flip the bit back. There is no separate "restore" endpoint.

## Linking vendors to other records

Vendors are referenced by:

- **purchase orders** (`purchase_orders.vendor_id`) — every PO has exactly one vendor;
- **vendor bills** (`vendor_bills.vendor_id`) — every bill has exactly one vendor;
- **expenses** (`expenses.vendor_id`, optional) — when an out-of-pocket expense is paid to a known vendor (e.g., for receipt categorization); the link is informational, not workflow-bearing.

When you archive a vendor, those links continue to render correctly because the rows are not deleted.

## Capabilities

The vendors-api bundle gates per-handler:

- `vendors.read` — list and get (any staff role: owner, admin, sales, ops, accounting).
- `vendors.write` — create, patch, archive (owner, admin, ops, accounting).

Roles like `viewer` and `customer_user` have read-only or no access; the handler enforces it via `requireCap(caller, ...)`.

## What's coming next (Wave 7b and beyond)

- **SPA pages** — `/vendors` list, `/vendors/:id` detail with a sidecar of linked POs + bills, `/vendors/new` form. Wave 7b.
- **Vendor portal** — a customer-style portal for vendors to view their own POs / bills. Phase 16+ (post-Wave-8).
- **Vendor performance metrics** — on-time delivery, average lead time, billing accuracy. Reporting phase.

See **[Purchase orders](./purchase-orders.md)** and **[Vendor bills](./vendor-bills.md)** for the workflow surfaces. The full route table and request / response schemas live in **[Vendors API](../api/vendors.md)**.
