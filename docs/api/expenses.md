# Expenses API

Wave 7 (PR #62) extends the `finance-api` bundle with `/expenses`. Expenses are single-line out-of-pocket purchase records that flow through a 6-state submitter → accounting workflow. `total_cents` is maintained by a BIU trigger added in migration 0058.

Base URL: `https://<project>.functions.supabase.co/finance-api/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply. This file is the per-resource delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts`.
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`.
- Money is integer cents on the wire.
- `spent_at` is a calendar `date` string (`YYYY-MM-DD`).
- Bundle `finance-api` enforces `verify_jwt = true`.

## RBAC

- Any staff role (including `sales`, `ops`) — `expenses.read`, `expenses.write`, `expenses.submit` on their own rows. RLS Pattern: `expenses_insert_self` + `expenses_update_self_draft` (covers own `draft` / `submitted` / `rejected`).
- `org_owner`, `org_admin`, `accounting` — `expenses.approve` (approve, reject, reimburse, pay). RLS Pattern: `expenses_approve_fin`.
- `viewer`, `customer_user` — no access.

The list endpoint with `?me=true` filters to the caller's own rows; without it, all staff see all of the org's expenses (RLS Pattern: `expenses_select_staff`).

## State machine

Prod `expenses.status` text CHECK has **six** values:

| State | Description |
|---|---|
| `draft` | Submitter editing. |
| `submitted` | Sent to accounting. |
| `approved` | Accounting signed off. Stamps `approved_at` + `approved_by`. |
| `rejected` | Accounting sent back. Submitter can edit + re-submit. Reason stamped into `notes`. |
| `reimbursed` | Terminal. Out-of-pocket → employee. Stamps `paid_at`. |
| `paid` | Terminal. Direct → vendor. Stamps `paid_at`. |

Legal transitions (`_shared/workflow.ts#EXPENSE_TRANSITIONS`):

| From | To |
|---|---|
| `draft` | `submitted` |
| `submitted` | `approved`, `rejected` |
| `rejected` | `submitted` |
| `approved` | `reimbursed`, `paid` |
| `reimbursed` | _(terminal)_ |
| `paid` | _(terminal)_ |

There is no `cancelled` state — abandoned expenses stay as drafts or get hard-deleted by admin tooling. Illegal transitions return **409 STATE_CONFLICT**.

### Why two terminals (`reimbursed` vs `paid`)?

The two terminals carry different GL semantics (Phase 12, Wave 8):

- **`reimbursed`** — the org owes the submitter cash. Future JE: `Dr expense category default_account, Cr employee-payable`.
- **`paid`** — the org paid the vendor directly (corporate card, ACH). Future JE: `Dr expense category default_account, Cr cash`.

Wave 7 stamps both with `paid_at` but does not yet emit GL — the distinction is preserved on the wire so the Phase 12 swap is a one-liner.

## Expense (Zod canon)

```ts
export const ExpenseStateSchema = z.enum([
  'draft', 'submitted', 'approved', 'rejected', 'reimbursed', 'paid',
]);

export const ExpenseSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  expense_number: z.string(),
  category_id: UuidSchema.nullable(),
  vendor_id: UuidSchema.nullable(),
  project_id: UuidSchema.nullable(),
  account_id: UuidSchema.nullable(),                 // direct GL override; usually null
  spent_at: z.string().date(),
  description: z.string().nullable(),
  status: ExpenseStateSchema,
  currency_code: z.string().length(3),
  amount_cents: CentsSchema,                         // pre-tax
  tax_cents: CentsSchema,
  tax_id: UuidSchema.nullable(),
  total_cents: CentsSchema,                          // trigger-maintained = amount + tax
  paid_at: TimestampSchema.nullable(),
  receipt_url: z.string().nullable(),                // stop-gap until Phase 16 attachments
  notes: z.string().nullable(),                      // also stamps rejection markers
  submitted_by: UuidSchema.nullable(),
  approved_by: UuidSchema.nullable(),
  approved_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
});
```

The trigger `tg_expenses_total` (BIU, added in migration 0058) sets `total_cents := amount_cents + tax_cents` on every insert / update. Handlers MUST NOT update `total_cents` directly; write the inputs and the trigger fires.

## Routes

| Route | Method | RBAC | Idempotent | Purpose |
|---|---|---|---|---|
| `/expenses` | GET | `expenses.read` | no | List |
| `/expenses/{id}` | GET | `expenses.read` | no | Detail |
| `/expenses` | POST | `expenses.write` | yes | Create draft |
| `/expenses/{id}` | PATCH | `expenses.write` | yes | Edit draft or rejected |
| `/expenses/{id}/submit` | POST | `expenses.submit` | yes | `draft → submitted` (or `rejected → submitted`) |
| `/expenses/{id}/approve` | POST | `expenses.approve` | yes | `submitted → approved` (stamps `approved_at` + `approved_by`) |
| `/expenses/{id}/reject` | POST | `expenses.approve` | yes | `submitted → rejected` (stamps reason into `notes`) |
| `/expenses/{id}/reimburse` | POST | `expenses.approve` | yes | `approved → reimbursed` (stamps `paid_at`) |
| `/expenses/{id}/pay` | POST | `expenses.approve` | yes | `approved → paid` (stamps `paid_at`) |

### list-expenses

- Filters: `status`, `category_id`, `project_id`, `me=true` (= filter by `submitted_by = caller.userId`).
- Pagination: `limit`, opaque `cursor`.
- Sort: `created_at DESC, id DESC`.

```bash
# My pending expenses
curl -H "Authorization: Bearer $JWT" \
  "$BASE/finance-api/expenses?me=true&status=submitted"
```

### create-expense

```ts
export const ExpenseCreateSchema = z.object({
  category_id: UuidSchema.nullable().optional(),
  vendor_id: UuidSchema.nullable().optional(),
  project_id: UuidSchema.nullable().optional(),
  account_id: UuidSchema.nullable().optional(),
  spent_at: z.string().date().optional(),            // defaults to today
  description: z.string().nullable().optional(),
  currency_code: z.string().length(3).optional(),   // defaults 'USD'
  amount_cents: z.number().int().nonnegative(),     // REQUIRED
  tax_cents: z.number().int().nonnegative().optional(),
  tax_id: UuidSchema.nullable().optional(),
  receipt_url: z.string().max(2048).nullable().optional(),
  notes: z.string().nullable().optional(),
}).strict();
```

- The server picks `expense_number` via `next_doc_number(org, 'expense')`.
- The handler stamps `status='draft'` and `submitted_by = caller.userId`.
- The trigger fires and sets `total_cents = amount_cents + (tax_cents ?? 0)`.

### patch-expense

```ts
export const ExpensePatchSchema = ExpenseCreateSchema.partial().strict();
```

- Patchable only while `status IN ('draft', 'rejected')` — rejected expenses can be edited and resubmitted (the typical "fix the receipt and try again" flow).
- Outside `draft` / `rejected` the handler returns **409 STATE_CONFLICT** with `cannot edit expense in status=<status>`.
- PATCH from `rejected` does NOT clear the rejection marker in `notes` — the audit trail stays intact.

### reject (stamps reason into notes)

```ts
export const ExpenseRejectSchema = z.object({
  reason: z.string().min(1).max(2000),
}).strict();
```

Rejection reasons live in `notes` because prod does not ship a `rejection_reason` column (D-W7-7). The handler appends a marker line to the existing `notes`:

```
<existing notes text>
[REJECTED 2026-05-13T14:22:01.000Z by 7c8d-9e10-...]: <reason>
```

The bracketed prefix disambiguates user-entered notes from rejection text. Multiple reject cycles append additional marker lines (rare in practice — rejected expenses are typically fixed and resubmitted, not re-rejected).

Cap `expenses.approve`. Returns **409 STATE_CONFLICT** if the source status is not `submitted`.

### approve / reimburse / pay

All three flip the status with cap `expenses.approve`:

- **approve** — stamps `approved_at = now()` and `approved_by = caller.userId`.
- **reimburse** — stamps `paid_at = now()`. Terminal.
- **pay** — stamps `paid_at = now()`. Terminal.

```bash
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{}' \
  "$BASE/finance-api/expenses/$EID/approve"

curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{}' \
  "$BASE/finance-api/expenses/$EID/reimburse"
```

### submit

`POST /finance-api/expenses/{id}/submit` flips `draft → submitted` or `rejected → submitted`. Cap `expenses.submit` (any submitter on own rows; RLS enforces ownership).

## Sample success response

```json
{
  "data": {
    "id": "ex...",
    "org_id": "t1...",
    "expense_number": "EXP-2026-00042",
    "category_id": "ec...",
    "vendor_id": null,
    "project_id": null,
    "account_id": null,
    "spent_at": "2026-05-12",
    "description": "Client lunch — Acme prospect",
    "status": "approved",
    "currency_code": "USD",
    "amount_cents": 8500,
    "tax_cents": 680,
    "tax_id": null,
    "total_cents": 9180,
    "paid_at": null,
    "receipt_url": "https://drive.example/receipt-2026-05-12.pdf",
    "notes": null,
    "submitted_by": "u9...",
    "approved_by": "ac...",
    "approved_at": "2026-05-13T10:08:11.000Z",
    "created_at": "2026-05-12T22:14:55.000Z",
    "updated_at": "2026-05-13T10:08:11.000Z",
    "deleted_at": null
  }
}
```

## Errors

| Code | HTTP | When |
|---|---|---|
| `NOT_FOUND` | 404 | Expense id not visible (RLS or soft-deleted) |
| `STATE_CONFLICT` | 409 | Illegal transition, or PATCH outside `draft`/`rejected` |
| `VALIDATION_ERROR` | 422 | Body fails Zod parse |
| `IDEMPOTENCY_CONFLICT` | 409 | Same key, different body hash |
| `INTERNAL_ERROR` | 500 | DB error (see `details.db`) |

## Cross-references

- **[Expense categories API](./expense-categories.md)** for the lookup table the expense form's category picker reads.
- See `TS1/09-api/00-API-CONTRACT.md` §11 for the cross-resource overview.

## Versioning

PR #62 ships the expenses surface. Trigger `tg_expenses_total` arrives in migration `0058`. Multi-line expenses (an `expense_line_items` table) are NOT planned — single-line is the canonical shape per D-W7-7 and the Wave 0 BUILD-ORDER. If you need per-line attribution, file one expense per line.
