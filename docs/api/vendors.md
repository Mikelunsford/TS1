# Vendors API

Wave 7 (PR #61) promotes the `vendors-api` bundle from a `GET /` health-only skeleton to the full procurement surface. This file documents the `/vendors` resource. The same bundle also exposes `/purchase-orders` and `/vendor-bills` — see **[Purchase orders API](./purchase-orders.md)** and **[Vendor bills API](./vendor-bills.md)**.

Base URL: `https://<project>.functions.supabase.co/vendors-api/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply to every endpoint below. This file is the per-resource delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts` (single source of truth, byte-mirrored to `apps/web/src/lib/types.ts`).
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`. Same key + same body hash replays the original response with `Idempotent-Replay: true`. Same key + different body returns **409 IDEMPOTENCY_CONFLICT**.
- Money is integer cents on the wire (field names end in `_cents`).
- Timestamps are ISO-8601 with `Z` (the prod DB columns are `timestamptz`); date-only fields like `issue_date` are `YYYY-MM-DD` strings.
- Bundle `vendors-api` enforces `verify_jwt = true`; every request carries a Supabase bearer token.
- **Vendors use `name`, NOT `display_name`.** Vendors did NOT participate in the Wave 6 customers rename — the canonical column is `name`, with `legal_name` for the full registered entity. D-W7-4 in the Wave 7 dispatch plan.

## RBAC

The `/vendors` handlers gate per-route via `requireCap(caller, '<capability>')` against `_shared/capabilities.ts`:

- `org_owner`, `org_admin` — full reach.
- `accounting`, `ops` — read + write.
- `sales`, `viewer` — read only.
- `customer_user` — no access.

## Vendor (Zod canon)

```ts
export const VendorSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  name: z.string().min(1).max(255),
  legal_name: z.string().max(255).nullable(),
  email: z.string().email().nullable(),
  phone: z.string().max(64).nullable(),
  website: z.string().max(255).nullable(),
  tax_id: z.string().max(64).nullable(),
  currency_code: z.string().length(3).nullable(),
  payment_terms_days: z.number().int().nonnegative(),  // default 30 on create
  billing_address: z.record(z.unknown()),              // jsonb; no fixed shape
  external_ref: z.string().max(255).nullable(),
  notes: z.string().nullable(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
});
```

## Routes

| Route | Method | RBAC | Idempotent | Purpose |
|---|---|---|---|---|
| `/vendors` | GET | `vendors.read` | no | List vendors |
| `/vendors/{id}` | GET | `vendors.read` | no | Vendor detail |
| `/vendors` | POST | `vendors.write` | yes | Create |
| `/vendors/{id}` | PATCH | `vendors.write` | yes | Update |
| `/vendors/{id}/archive` | POST | `vendors.write` | yes | Flip `is_active=false` |

### list-vendors

`GET /vendors-api/vendors`

- Filters: `q` (free-text ilike on `name`), `is_active` (`true` | `false`).
- Pagination: `limit` (default 50), opaque `cursor`.
- Sort: `created_at DESC, id DESC`.
- Excludes rows with `deleted_at IS NOT NULL` from the result.

```bash
curl -H "Authorization: Bearer $JWT" \
  "$BASE/vendors-api/vendors?q=acme&is_active=true&limit=25"
```

### get-vendor

`GET /vendors-api/vendors/{id}`

- Returns the full vendor row.
- Returns **404 NOT_FOUND** for a missing or soft-deleted vendor.

### create-vendor

`POST /vendors-api/vendors`

- Idempotent header required.
- The handler stamps `is_active=true`, `payment_terms_days=30` (if omitted), `billing_address={}` (if omitted).

```ts
export const VendorCreateSchema = z.object({
  name: z.string().min(1).max(255),
  legal_name: z.string().max(255).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  tax_id: z.string().max(64).nullable().optional(),
  currency_code: z.string().length(3).nullable().optional(),
  payment_terms_days: z.number().int().nonnegative().optional(),
  billing_address: z.record(z.unknown()).optional(),
  external_ref: z.string().max(255).nullable().optional(),
  notes: z.string().nullable().optional(),
}).strict();
```

```bash
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "name":"Acme Hardware",
    "legal_name":"Acme Hardware LLC",
    "email":"billing@acmehw.example",
    "currency_code":"USD",
    "payment_terms_days":45,
    "tax_id":"12-3456789"
  }' \
  "$BASE/vendors-api/vendors"
```

### patch-vendor

`PATCH /vendors-api/vendors/{id}`

- Partial: any of the create fields plus `is_active`.
- No status-locked guard — vendor records do not have a workflow lifecycle, so you can patch at any time.

```ts
export const VendorPatchSchema = VendorCreateSchema.partial().extend({
  is_active: z.boolean().optional(),
}).strict();
```

### archive-vendor

`POST /vendors-api/vendors/{id}/archive`

- Idempotent header required.
- Flips `is_active=false`. Row is NOT deleted — existing links from POs and vendor bills remain valid.
- To un-archive, PATCH `is_active: true`.

## Sample success response

```json
{
  "data": {
    "id": "v0a1...",
    "org_id": "t1...",
    "name": "Acme Hardware",
    "legal_name": "Acme Hardware LLC",
    "email": "billing@acmehw.example",
    "phone": null,
    "website": null,
    "tax_id": "12-3456789",
    "currency_code": "USD",
    "payment_terms_days": 45,
    "billing_address": {},
    "external_ref": null,
    "notes": null,
    "is_active": true,
    "created_at": "2026-05-16T17:32:01.123Z",
    "updated_at": "2026-05-16T17:32:01.123Z",
    "deleted_at": null
  }
}
```

## Errors

| Code | HTTP | When |
|---|---|---|
| `NOT_FOUND` | 404 | Vendor id not visible to caller (RLS or soft-deleted) |
| `VALIDATION_ERROR` | 422 | Body fails Zod parse |
| `IDEMPOTENCY_CONFLICT` | 409 | Same `Idempotency-Key`, different body hash (universal §0.4) |
| `INTERNAL_ERROR` | 500 | DB error (see `details.db` for the underlying message) |

No domain-specific codes — vendor CRUD is straight Pattern A.

## Versioning

The vendors-api bundle ships Wave 7's procurement surface in PR #61. No migration (the chassis tables existed from Wave 0; D-W7-1 in the Wave 7 dispatch plan). See `TS1/09-api/00-API-CONTRACT.md` §10 for the cross-resource overview.
