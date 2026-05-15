# Settings

Wave 3 lights up four settings pages: **Currencies**, **Taxes**, **Payment methods**, and **Exchange rates**. Each lives under `/settings/*` and is reachable to staff roles (`org_owner` / `org_admin` / `accounting`). The left nav exposes a **Settings** section with the four children.

`/settings` (no child) redirects to `/settings/currencies`.

## Currencies

Path: `/settings/currencies`.

Currencies are global reference data — the catalog is shared across all orgs; there are no per-org rows. The page shows the 10 ISO 4217 currencies the platform ships with (USD, EUR, GBP, CAD, MXN, AUD, JPY, CHF, BRL, INR).

For each row you see:

- **Code** (PK, immutable),
- **Label**,
- **Symbol** + **Symbol position** (`before` / `after`),
- **Decimals** (`cent_precision`, 0–4),
- **Active** toggle.

Toggling **Active** issues `PATCH /finance-api/currencies/{code}` with `{ is_active: <new> }`. The wire field accepts a 3-letter code only (`USD`, not `usd` or `Dollar`). New currencies are added via `POST /finance-api/currencies` — same Zod schema as PATCH; case is normalized to uppercase on the server. Adding a custom currency is org-admin-only; toggling is the same gate.

There is no soft-delete or hard-delete from the UI: setting `is_active = false` is the only way to suppress a currency from pickers.

## Taxes

Path: `/settings/taxes`.

Taxes are org-scoped (each org has its own rates). Wave 3 seeds one default 0% tax (`code = 'TAX-0'`, `is_default = true`) per org so quotes and invoices land somewhere reasonable from day one.

The page shows a table:

- **Code** (unique per org),
- **Label**,
- **Rate** (displayed as a percent — e.g., 8.75% — wire stays decimal 0..1),
- **Jurisdiction**,
- **Compound** + **Inclusive** flags,
- **Default** + **Active** flags.

Click **New tax** to open the create form. The rate field is `RateInputPercent` — you type `8.75`, the form stores `0.0875` on the wire. `step="any"` allows fractional precision so `8.875` is accepted as well.

`is_default = true` is partial-unique per org (Postgres partial unique index). When you set a tax as default, the server first un-defaults the prior default in a two-statement sequence; if the second statement fails, the prior default is restored on a best-effort basis. The semantics match the LeadConvert pattern (R-W2-04) — a future SQL RPC will make this atomic when the payment pipeline lands.

Archiving (`POST /finance-api/taxes/{id}/archive`) sets `is_active = false`. No hard-delete from the UI.

## Payment methods

Path: `/settings/payment-methods`.

Payment methods are org-scoped. Wave 3 seeds 7 defaults per org: **Cash**, **Check**, **ACH transfer**, **Card**, **Wire transfer**, **Stripe**, **Manual entry**. None are flagged as `is_default` out of the box; you opt one in.

The table columns are: **Code** (unique per org), **Label**, **Description**, **Default**, **Active**.

Setting **Default** follows the same un-default-prior shuffle as taxes. **Active** is the soft-suppress; **Delete** is a hard delete (`DELETE /finance-api/payment-methods/{id}`) — only fires if no historical payments reference the method (Phase 8 payments are not yet shipped, so the FK check is currently a no-op).

## Exchange rates

Path: `/settings/exchange-rates`.

Exchange rates are global (no org_id) — the platform-wide FX catalog. Wave 3 seeds zero rates; you enter them manually or pull from a future scheduled job (`exchange-rates-fetch` per architecture §4.5).

The page has two parts:

- **Insert form** — pick **Base** and **Quote** currency, enter the **Rate** (`numeric(18,8)`), pick the **As-of** date (defaults to today), set **Source** (`manual` / `exchangerate.host` / `ecb` / `custom`).
- **Filtered list** — filter by base / quote / date range; sort by `as_of DESC`.

Insert sends `POST /finance-api/exchange-rates`. The DB enforces `UNIQUE(base_code, quote_code, as_of)` — a duplicate triggers `409 STATE_CONFLICT` with `details.code = 'EXCHANGE_RATE_EXISTS'`, surfaced in the toast.

There is no edit or delete from the UI today; if a rate is wrong, insert a new one with a later `as_of`. Quotes / invoices in future waves snapshot the rate at issuance.

## What's coming next

The **Quotes** module (Phase 4) reads the active default tax, the org's preferred currency, and the latest exchange_rates row for non-USD documents. The **Invoices** module (Phase 7) does the same. The **Payments** module (Phase 8) reads `payment_methods` and uses `is_default` to pre-select. The settings UI today is the source of truth for all of them.
