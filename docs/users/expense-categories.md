# Expense categories

An **expense category** is a small, org-scoped reference record that labels a kind of spend (`Travel`, `Software`, `Office supplies`, etc.) and — once Phase 12 GL lands — points at the chart-of-accounts row that the expense should hit when its journal entry posts. Categories are the lookup table that the expense form's category picker reads from.

The user-facing pages for managing categories (`/settings/expense-categories`) are **deferred to Wave 7b**. Wave 7 ships the backend API; the SPA surface lands in a follow-up wave. Everything below is exercised today via **[Expense categories API](../api/expense-categories.md)**.

## What a category is

A category is one row in `public.expense_categories` carrying:

- a **`code`** — short identifier (1-64 chars), unique within the org. Used as the stable key in URLs, integrations, and reports. Example: `TRAVEL`, `SAAS`, `OFFICE`.
- a **`label`** — display name (1-255 chars). Example: `Travel & lodging`, `SaaS subscriptions`, `Office supplies`.
- an optional **`default_account_id`** — uuid pointing at the org's `chart_of_accounts` row (the GL account this category should hit). Phase 12 (Wave 8) consumes this to auto-build the journal entry on expense pay/reimburse. Until then it's documentary.
- an `is_active` boolean — active categories show on the expense form's picker; archived ones do not.
- the chassis `created_at` / `updated_at`.

The DB enforces **`UNIQUE (org_id, code)`** — attempting to create a duplicate code returns **409 STATE_CONFLICT** with the message `expense category code already exists`.

## Adding a category

`POST /finance-api/expense-categories` with a `code` and `label`, optionally a `default_account_id`:

```json
{
  "code": "TRAVEL",
  "label": "Travel & lodging",
  "default_account_id": "a9..."
}
```

The handler stamps `is_active=true`. The response carries the full row.

## Editing a category

`PATCH /finance-api/expense-categories/:id`. Patchable fields: `label`, `default_account_id`, `is_active`. **The `code` is not patchable** — once a category exists, its code is fixed (codes appear in integrations and reports; renaming them silently would break consumers). If you need a different code, archive the old one and create a new one.

## Archiving

`POST /finance-api/expense-categories/:id/archive` flips `is_active=false`. The row stays in the table; existing expenses pointing at the category continue to render correctly. Archived categories drop off the expense form's picker.

To un-archive, `PATCH .../expense-categories/:id` with `{ "is_active": true }`.

## Listing

`GET /finance-api/expense-categories` lists active categories by default. Pass `?include_inactive=true` to include archived rows (useful for admin tooling).

The list is sorted by `code` ascending. The response uses `{ items, next_cursor: null }` shape — categories are a small lookup table, so the list is unpaginated.

## How categories link to the chart of accounts

The `default_account_id` column points at a `chart_of_accounts` row. Phase 12 (Wave 8) will use it to auto-fill the debit side of the journal entry when an expense moves to `paid` or `reimbursed`:

```
Expense: amount_cents 8500, tax_cents 680, category Travel (default_account_id → 6000 Travel Expense)

Journal entry on /pay:
  Dr 6000 Travel Expense   91.80
        Cr 1000 Cash                91.80
```

Wave 7 does NOT yet wire the GL hook — `default_account_id` is captured today so the eventual Phase 12 rollout is a one-step swap. The `chart_of_accounts` table itself exists in prod from Wave 0 chassis but does not yet have a public CRUD surface (also Phase 12).

## Capabilities

- `expenses.read` — list categories (any staff role with expense visibility).
- `expenses.write` — create, patch, archive (owner, admin, accounting).

The categories live behind the `expenses.*` capability family, not their own — they're considered part of the expenses surface from an RBAC standpoint.

## What's coming next (Wave 7b and beyond)

- **SPA settings page** — `/settings/expense-categories` with a list + new / edit / archive controls. Wave 7b.
- **Chart of accounts API** — Phase 12 (Wave 8) exposes `/chart-of-accounts` CRUD; the category form's `default_account_id` picker reads from there.
- **GL hooks** — Phase 12 wires the category's `default_account_id` into the auto-generated journal entry on expense pay/reimburse.

See **[Expenses](./expenses.md)** for the submission flow. Full route table and schemas: **[Expense categories API](../api/expense-categories.md)**.
