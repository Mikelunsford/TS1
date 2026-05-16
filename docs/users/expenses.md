# Expenses

Wave 7 lights up the expense surface. An **expense** is an out-of-pocket purchase by a staff member that the org reimburses (or a direct-to-vendor payment that's not big enough to warrant a full purchase order + vendor bill cycle). Each expense is one row in `public.expenses` — single-line, no separate `expense_line_items` table. Total is the trigger-maintained sum of `amount_cents + tax_cents`.

The user-facing pages (`/expenses`, `/expenses/:id`, `/expenses/new`, `/my-expenses`) are **deferred to Wave 7b**. Wave 7 ships the backend API and Zod canon; the SPA surface lands in a follow-up wave. The flows below are exercised today via **[Expenses API](../api/expenses.md)**.

## What an expense is

An expense is one row in `public.expenses` carrying:

- a server-generated **`expense_number`** (`EXP-YYYY-NNNNN` from `next_doc_number(org, 'expense')`),
- an optional `category_id` (links to `expense_categories`; documents what kind of spend it is and which GL account it should hit when Phase 12 GL lands),
- an optional `vendor_id` (for receipts paid to a known vendor),
- an optional `project_id` (for billable / project-tagged expenses),
- an optional `account_id` (direct override of the category's `default_account_id`),
- a `spent_at` calendar date (defaults to today on create),
- a free-text `description`,
- a **`status`** — 6-value text CHECK; see lifecycle below,
- `currency_code` (3-char ISO; defaults to `'USD'`),
- `amount_cents` (the pre-tax amount; required),
- `tax_cents` (defaults to 0),
- an optional `tax_id` linking to the org's tax table,
- a trigger-maintained **`total_cents`** (= `amount_cents + tax_cents`),
- a `paid_at` timestamp (stamped by the reimburse / pay endpoints),
- an optional `receipt_url` (free-text URL — the attachments surface is Phase 16, so this is a stop-gap until then),
- a `notes` free-text field (also used to stamp rejection reasons; see below),
- `submitted_by` (the user who created the row — stamped at create from `caller.userId`),
- `approved_by` + `approved_at` (stamped by the approve endpoint),
- and the chassis `created_at` / `updated_at` / `deleted_at`.

### Why single-line?

The Wave 0 chassis (D-W7-7) shipped expenses as single-line records because expense reports are usually one receipt = one row. If you need to capture a multi-line receipt, file one expense per line. This matches the Wave 0 BUILD-ORDER spec verbatim.

## Lifecycle

Expenses run through six states. The state machine is enforced server-side by `_shared/workflow.ts#EXPENSE_TRANSITIONS`; illegal transitions return **409 STATE_CONFLICT**.

```
draft ──submit──► submitted ──approve──► approved ──reimburse──► reimbursed
                       │                     │
                       │                     └──pay──► paid
                       │
                       └──reject──► rejected ──edit + submit──► submitted
```

- **draft** — the submitter is still drafting; only the submitter can see / edit (RLS Pattern: `expenses_update_self_draft` allows the submitter to edit own draft / submitted / rejected rows).
- **submitted** — sent to accounting for review.
- **approved** — accounting has signed off. Stamps `approved_at` + `approved_by`.
- **rejected** — accounting sent it back. The submitter can edit and re-submit (`rejected → submitted` is in the matrix). The rejection reason is stamped into `notes` with a marker prefix (see below).
- **reimbursed** — terminal. The org has paid the submitter back for an out-of-pocket spend. Stamps `paid_at`.
- **paid** — terminal. The org has paid the vendor directly (e.g., a corporate card transaction). Stamps `paid_at`.

There is no `cancelled` state on expenses — a rejected expense is editable and re-submittable, which covers the "abandoned" case. Submitters who want to throw away a draft just leave it in `draft`; admin tooling can hard-delete drafts that pile up.

## Submitting an expense

`POST /finance-api/expenses`. Required: `amount_cents`. Optional: `category_id`, `vendor_id`, `project_id`, `account_id`, `spent_at` (defaults today), `description`, `currency_code` (defaults `USD`), `tax_cents`, `tax_id`, `receipt_url`, `notes`. The handler stamps `status='draft'` and `submitted_by = caller.userId`.

A typical create:

```json
{
  "category_id": "ec...",
  "spent_at": "2026-05-12",
  "description": "Client lunch — Acme prospect",
  "amount_cents": 8500,
  "tax_cents": 680,
  "currency_code": "USD",
  "receipt_url": "https://drive.example/receipt-2026-05-12.pdf"
}
```

The BIU trigger fires and sets `total_cents = 8500 + 680 = 9180`. The response carries the full row with `expense_number` and `total_cents` populated.

Once you've drafted the row you can either:

- continue to **`PATCH /expenses/:id`** to refine it (legal while status is `draft` or `rejected` — see "Edit while rejected" below), or
- **`POST /expenses/:id/submit`** to send it to accounting.

## Edit-while-rejected

When accounting rejects an expense (`POST /expenses/:id/reject` with `{ reason }`), the row moves to `status='rejected'` and the rejection reason is stamped into `notes` with a marker:

```
<existing notes text>
[REJECTED 2026-05-13T14:22:01.000Z by 7c8d-9e10-...]: Receipt is illegible, please re-photograph
```

The marker disambiguates user-entered notes from rejection text. There is no separate `rejection_reason` column in prod (D-W7-7).

From `rejected` the submitter can:

- PATCH the row to fix the issue (allowed because `_shared/handlers/expenses.ts` permits PATCH from `draft` or `rejected`),
- POST `/submit` to send it back (the `rejected → submitted` transition is in the matrix).

PATCH from `rejected` does NOT clear the rejection marker — the audit trail stays in `notes` for traceability. If you want to start fresh, create a new expense.

## Approval

`POST /finance-api/expenses/:id/approve` moves `submitted → approved`. Stamps `approved_at = now()` and `approved_by = caller.userId`. Cap `expenses.approve` (typically owner, admin, accounting).

Or **reject** — `POST /finance-api/expenses/:id/reject` with a required `reason` (1-2000 chars). Cap `expenses.approve`. Moves `submitted → rejected`.

## Reimbursed vs paid

Both are terminal. They mean different things on the books:

- **Reimbursed** (`POST /expenses/:id/reimburse`) — the org has paid the submitter back for an out-of-pocket spend. Use this for the typical "I bought lunch on my personal card, please send the cash back" flow.
- **Paid** (`POST /expenses/:id/pay`) — the org has paid the vendor directly. Use this for corporate-card transactions or pre-paid arrangements where the submitter never spent personal money.

Both routes stamp `paid_at = now()` and require `expenses.approve` capability. Both are only legal from `approved`. The downstream GL treatment differs (Phase 12 surface) — reimbursed expenses produce an employee-payable journal entry; paid expenses do not — which is why the two states are kept distinct on the wire today even though Wave 7 doesn't yet wire GL.

## Capabilities

- `expenses.read` — list, get. List with `?me=true` filters to the caller's own rows.
- `expenses.submit` — submit (any submitter on their own draft).
- `expenses.write` — create, patch (any submitter on own; accounting can edit any).
- `expenses.approve` — approve, reject, reimburse, pay (owner, admin, accounting).

The RLS policies on `expenses` mirror this:

- `expenses_insert_self` — any staff can insert own `draft`.
- `expenses_update_self_draft` — submitter can update own `draft` / `submitted` / `rejected`.
- `expenses_select_staff` — all staff can read the org's expenses.
- `expenses_approve_fin` — accounting role can patch any row's status field.

## What's coming next (Wave 7b and beyond)

- **SPA pages** — `/expenses` list with filters (status, category, project, submitter, date range), `/my-expenses` filtered view, `/expenses/:id` detail with the workflow button bar and a receipt preview, `/expenses/new` form. Wave 7b.
- **Attachments** — Phase 16 replaces the free-text `receipt_url` with the canonical attachments table.
- **GL hooks** — Phase 12 (Wave 8) emits journal entries on `paid` / `reimbursed` (debit expense category's `default_account_id`, credit cash or employee-payable).
- **Bulk import** — receipt photo OCR + bulk submit. Reporting phase.

See **[Expense categories](./expense-categories.md)** for how categories link expenses to the chart of accounts. Full route table and schemas: **[Expenses API](../api/expenses.md)**.
