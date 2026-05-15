# Finance API

Wave 3 ships the `finance-api` Edge Function bundle. It exposes currencies, exchange rates, taxes, and payment methods under `https://<project>.functions.supabase.co/finance-api/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply to every endpoint below. This file is the per-module delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts` (single source of truth, byte-mirrored to `apps/web/src/lib/types.ts`).
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`. Same key + same body hash replays the original response with `Idempotent-Replay: true`. Same key + different body returns `409 IDEMPOTENCY_CONFLICT`.
- Dates are `YYYY-MM-DD`; timestamps are ISO-8601 with `Z`.
- Bundle `finance-api` enforces `verify_jwt = true`; every request carries a Supabase bearer token.

## RBAC at the bundle

The finance-api bundle gates per-handler via `requireCap(caller, '<capability>')`. The Wave-3 capability matrix is a role stop-gap (the real matrix lands later, tracked as F-Wave3-03):

- `org_owner`, `org_admin` — read and write everything.
- `accounting` — read and write taxes / payment methods / exchange rates.
- `sales`, `ops` — read everything.
- `viewer`, `customer_user` — read everything except `is_default` toggles.

The `currencies` catalog is global (no org_id); reads are open to any authenticated caller. Writes are `org_owner` / `org_admin` only.

## Currencies

### list-currencies

`GET /finance-api/currencies`

- Auth: bearer JWT.
- RBAC: `finance.currencies.read`.
- Idempotent: yes (GET).
- Filters: `is_active` (boolean query string).

```ts
export const CurrencySchema = z.object({
  code: z.string().length(3),
  label: z.string(),
  symbol: z.string(),
  symbol_position: z.enum(['before', 'after']),
  decimal_sep: z.string(),
  thousand_sep: z.string(),
  cent_precision: z.number().int().min(0).max(4),
  zero_format: z.boolean(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

```bash
curl -H "Authorization: Bearer $JWT" \
  "$BASE/finance-api/currencies?is_active=true"
```

### upsert-currency

`POST /finance-api/currencies`

- RBAC: `finance.currencies.write` (org_admin).
- Idempotent header required. Behaves as an upsert on `code`; same code with new fields updates the row.

```ts
export const CurrencyUpsertSchema = z.object({
  code: z.string().length(3),   // normalized to uppercase server-side
  label: z.string().min(1),
  symbol: z.string().min(1),
  symbol_position: z.enum(['before', 'after']).default('before'),
  decimal_sep: z.string().default('.'),
  thousand_sep: z.string().default(','),
  cent_precision: z.number().int().min(0).max(4).default(2),
  zero_format: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
```

### patch-currency

`PATCH /finance-api/currencies/{code}`

- RBAC: `finance.currencies.write` (org_admin).
- Path code is normalized to uppercase. Cannot change `code` itself — issue a new upsert + deactivate the old code instead.

```ts
export const CurrencyPatchSchema = CurrencyUpsertSchema.omit({ code: true }).partial();
```

## Exchange rates

### list-exchange-rates

`GET /finance-api/exchange-rates?base_code=USD&quote_code=EUR&from=2026-01-01&to=2026-05-31`

- RBAC: `finance.currencies.read`.
- Idempotent: yes (GET).
- Filters: `base_code`, `quote_code`, `from`, `to` (date range, inclusive). All optional; defaults return the most recent 50.
- Sort: `as_of DESC, created_at DESC`.

```ts
export const ExchangeRateSchema = z.object({
  id: UuidSchema,
  base_code: z.string().length(3),
  quote_code: z.string().length(3),
  rate: z.number().positive(),    // numeric(18,8) on the DB
  as_of: z.string().date(),
  source: z.enum(['manual', 'exchangerate.host', 'ecb', 'custom']),
  created_at: TimestampSchema,
  created_by: UuidSchema.nullable(),
});
```

### create-exchange-rate

`POST /finance-api/exchange-rates`

- RBAC: `finance.currencies.write` (org_admin / accounting).
- DB enforces `UNIQUE(base_code, quote_code, as_of)`. Duplicate inserts return `409 STATE_CONFLICT` with `details.code = 'EXCHANGE_RATE_EXISTS'`.

```ts
export const ExchangeRateInsertSchema = z.object({
  base_code: z.string().length(3),
  quote_code: z.string().length(3),
  rate: z.number().positive(),
  as_of: z.string().date(),
  source: z.enum(['manual', 'exchangerate.host', 'ecb', 'custom']).default('manual'),
});
```

## Taxes

Org-scoped catalog. Wave 3 seeds one default 0% tax per org (`code = 'TAX-0'`).

### list-taxes / get-tax

`GET /finance-api/taxes`
`GET /finance-api/taxes/{id}`

- RBAC: `finance.taxes.read`.
- Idempotent: yes (GET).
- Filters: `is_active`, `is_default`.

```ts
export const TaxSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1),
  label: z.string().min(1),
  /** Decimal 0..1 — e.g. 0.0875 for 8.75%. NOT basis points. */
  rate: z.number().min(0).max(1),
  jurisdiction: z.string().nullable(),
  is_compound: z.boolean(),
  is_inclusive: z.boolean(),
  is_default: z.boolean(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

**Rate divergence from API contract §7.** The DB stores `numeric(7,6)` decimals (0..1); the API contract proposed `rate_bp` basis points. We use the DB shape on the wire. F-Wave3-03 tracks reconciliation.

### create-tax / patch-tax

`POST /finance-api/taxes`
`PATCH /finance-api/taxes/{id}`

- RBAC: `finance.taxes.write` (org_admin / accounting).
- `is_default = true` un-defaults the prior default in a two-statement sequence; best-effort rollback on failure (same pattern as LeadConvert — R-W2-04).

```ts
export const TaxCreateSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  rate: z.number().min(0).max(1),
  jurisdiction: z.string().nullable().optional(),
  is_compound: z.boolean().default(false),
  is_inclusive: z.boolean().default(false),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
export const TaxPatchSchema = TaxCreateSchema.partial();
```

### archive-tax

`POST /finance-api/taxes/{id}/archive`

- RBAC: `finance.taxes.write` (org_admin / accounting).
- Sets `is_active = false`. No hard-delete from this endpoint.

## Payment methods

Org-scoped catalog. Wave 3 seeds 7 defaults per org: `cash`, `check`, `ach`, `card`, `wire`, `stripe`, `manual`.

### list-payment-methods / create-payment-method / patch-payment-method / delete-payment-method

`GET /finance-api/payment-methods`
`POST /finance-api/payment-methods`
`PATCH /finance-api/payment-methods/{id}`
`DELETE /finance-api/payment-methods/{id}`

- RBAC: `finance.payment_methods.write` for non-GET (org_admin / accounting).
- `is_default = true` un-defaults the prior default (same shuffle as taxes).
- DELETE is hard. Phase 8 will add a FK guard on `payments.method_id`; today the DELETE handler succeeds without that check.

```ts
export const PaymentMethodSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable(),
  is_default: z.boolean(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export const PaymentMethodCreateSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable().optional(),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
export const PaymentMethodPatchSchema = PaymentMethodCreateSchema.partial();
```

## Errors

Every endpoint returns the universal envelope:

```json
{ "error": { "code": "<CODE>", "message": "<readable>", "details": { /* optional */ } } }
```

Domain codes for finance-api on top of the universal set:

| Code | HTTP | When |
|---|---|---|
| `STATE_CONFLICT` (`details.code = 'EXCHANGE_RATE_EXISTS'`) | 409 | POST /exchange-rates duplicate (base, quote, as_of) |
| `STATE_CONFLICT` | 409 | Generic conflict (`is_default` shuffle race; archive after delete) |

## Versioning

The `finance-api` bundle is deployed via `deploy-functions.yml` and is currently at `v18`. Schema-impacting changes are versioned via `migrate.yml` (currently at `0049`).
