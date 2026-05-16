# Expense categories API

Wave 7 (PR #62) extends the `finance-api` bundle with `/expense-categories`. Categories are an org-scoped lookup table that labels expense kinds and (once Phase 12 GL lands) points each kind at a chart-of-accounts row.

Base URL: `https://<project>.functions.supabase.co/finance-api/...`.

The universal envelope, headers, idempotency, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply. This file is the per-resource delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts`.
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`.
- Bundle `finance-api` enforces `verify_jwt = true`.

## RBAC

The category routes sit under the `expenses.*` capability family (categories are considered part of the expenses surface, not their own resource family):

- `org_owner`, `org_admin`, `accounting` — read + write.
- `ops`, `sales` — read only.
- `viewer`, `customer_user` — no access.

## ExpenseCategory (Zod canon)

```ts
export const ExpenseCategorySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1).max(64),                  // unique within org
  label: z.string().min(1).max(255),
  default_account_id: UuidSchema.nullable(),         // future Phase 12 GL link
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

The DB enforces **`UNIQUE (org_id, code)`**. Duplicate codes return **409 STATE_CONFLICT** with the message `expense category code already exists`.

## Routes

| Route | Method | RBAC | Idempotent | Purpose |
|---|---|---|---|---|
| `/expense-categories` | GET | `expenses.read` | no | List |
| `/expense-categories` | POST | `expenses.write` | yes | Create |
| `/expense-categories/{id}` | PATCH | `expenses.write` | yes | Update (label / default_account_id / is_active) |
| `/expense-categories/{id}/archive` | POST | `expenses.write` | yes | Flip `is_active=false` |

### list-expense-categories

`GET /finance-api/expense-categories`

- Defaults to active categories only. Pass `?include_inactive=true` to include archived rows.
- Sort: `code ASC`.
- Response shape: `{ items: ExpenseCategory[], next_cursor: null }`. The list is unpaginated — categories are a small lookup table.

```bash
curl -H "Authorization: Bearer $JWT" \
  "$BASE/finance-api/expense-categories?include_inactive=true"
```

### create-expense-category

```ts
export const ExpenseCategoryCreateSchema = z.object({
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(255),
  default_account_id: UuidSchema.nullable().optional(),
}).strict();
```

- The handler stamps `is_active=true`.
- Duplicate `(org_id, code)` returns **409 STATE_CONFLICT** with the message `expense category code already exists`.

```bash
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "code":"TRAVEL",
    "label":"Travel & lodging",
    "default_account_id":"a9..."
  }' \
  "$BASE/finance-api/expense-categories"
```

### patch-expense-category

```ts
export const ExpenseCategoryPatchSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  default_account_id: UuidSchema.nullable().optional(),
  is_active: z.boolean().optional(),
}).strict();
```

- **`code` is NOT patchable.** Codes appear in integrations and reports; renaming them silently would break consumers. To change a code, archive the old category and create a new one.

### archive-expense-category

`POST /finance-api/expense-categories/{id}/archive`

- Flips `is_active=false`. Row stays in the table — existing expenses linking to it continue to render correctly.
- To un-archive, PATCH `is_active: true`.

## Sample success response

```json
{
  "data": {
    "id": "ec...",
    "org_id": "t1...",
    "code": "TRAVEL",
    "label": "Travel & lodging",
    "default_account_id": "a9...",
    "is_active": true,
    "created_at": "2026-05-16T17:32:01.123Z",
    "updated_at": "2026-05-16T17:32:01.123Z"
  }
}
```

## Errors

| Code | HTTP | When |
|---|---|---|
| `NOT_FOUND` | 404 | Category id not visible to caller |
| `STATE_CONFLICT` (msg `expense category code already exists`) | 409 | Create with a duplicate `(org_id, code)` — DB raises 23505 |
| `VALIDATION_ERROR` | 422 | Body fails Zod parse |
| `IDEMPOTENCY_CONFLICT` | 409 | Same key, different body hash |
| `INTERNAL_ERROR` | 500 | DB error (see `details.db`) |

## Cross-references

- The `default_account_id` field is captured today but not yet consumed. Phase 12 (Wave 8) wires it into the auto-generated journal entry on expense `paid` / `reimbursed`.
- The chart-of-accounts CRUD surface (`/chart-of-accounts`) lands in Phase 12; it shares the `finance-api` bundle.
- See **[Expenses API](./expenses.md)** for the expense lifecycle that consumes these categories.

## Versioning

PR #62 ships the expense-categories surface. No migration; the `expense_categories` table existed from Wave 0 chassis (D-W7-1 in the Wave 7 dispatch plan). See `TS1/09-api/00-API-CONTRACT.md` §11 for the cross-resource overview.
