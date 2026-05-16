# Credit notes

Wave 5 ships the `/credit-notes` surface. A **credit note** is a customer credit issued against an invoice (or against an open customer balance). It carries an amount, a reason, and a workflow state. The page lives at `/credit-notes` and is reachable to staff roles with `credit_notes.read`.

## What a credit note is

A credit note is one row in `credit_notes` with:

- the customer (`customer_id`) and optional parent invoice (`invoice_id`, nullable),
- an `issue_date` (the date the credit was issued),
- a workflow `status` (`draft` | `issued` | `applied` | `voided`),
- an optional `reason` enum (`refund` | `adjustment` | `write_off` | `duplicate` | `other`),
- a `currency_code` (3 chars),
- an `amount_cents` (total credit available; the upper bound on what can be applied),
- an `applied_cents` (running total of what has actually been applied; enforced `<= amount_cents` by a DB CHECK),
- a free-text `notes` field,
- a `voided_at` timestamp (set by the void handler; there is **no `void_reason` column** on the row).

## Lifecycle

Credit notes move through four states. The state machine is enforced server-side by `_shared/workflow.ts#CREDIT_NOTE_TRANSITIONS`.

```
draft ──issue──► issued ──apply──► applied
  │                │                  │
  └──void──► voided ◄──void───────────┘
```

- **draft** — initial state. Editable only by re-issuing or voiding (Wave 5 does not ship a `PATCH /credit-notes/:id` route — see API doc).
- **issued** — credit is live; can be applied to one or more invoices. Reached via `POST /credit-notes/:id/issue`.
- **applied** — `applied_cents` has been bumped at least once via `/apply`. The state moves to `applied` on the first apply call; further apply calls (up to `amount_cents - applied_cents`) stay in `applied`.
- **voided** — terminal. Reachable from any non-terminal state. Stamps `voided_at`.

## Creating a credit note

From `/credit-notes` click **New credit note**. Form fields:

- **Customer** — required picker.
- **Currency** — required (3 chars).
- **Amount** — `amount_cents` (entered through `MoneyInput`; must be `>= 0`).
- **Invoice** — optional picker (filter to the customer's open invoices). If set, the credit note will default to applying against this invoice; if blank, the credit note is "floating" against the customer.
- **Reason** — optional picker (`refund` | `adjustment` | `write_off` | `duplicate` | `other`).
- **Issue date** — optional `date`; defaults to today server-side.
- **Notes** — optional free-text.

Hit **Save**. Posts `POST /invoicing-api/credit-notes` with an `Idempotency-Key` header. Server returns `{ data: CreditNote }` in `draft` state. The server picks `credit_note_number` via the org's `next_doc_number('credit_note')` sequence.

## Workflow buttons

The detail page surfaces one or more workflow buttons in the header, depending on the current status:

- **Issue** (visible on `draft`; cap `credit_notes.issue`) — `POST /credit-notes/:id/issue`. Moves `draft → issued`.
- **Apply** (visible on `issued`; cap `credit_notes.apply`) — opens a dialog for `{ invoice_id, amount_cents }`. The amount cannot exceed `credit_note.amount_cents - credit_note.applied_cents`. Posts `POST /credit-notes/:id/apply`. Moves `issued → applied` on the first call; stays `applied` on subsequent calls. Bumps `applied_cents`.
- **Void** (visible on `draft` | `issued` | `applied`; cap `credit_notes.write`) — opens a required reason dialog; posts `POST /credit-notes/:id/void`. Moves to `voided` and stamps `voided_at`. The reason is captured wire-side for audit purposes but is NOT persisted on the row (there is no `void_reason` column on `credit_notes`; this differs from `payments.void_reason`). Phase 17 audit enrichment will capture the reason in the audit log.

The buttons hide themselves when the transition is illegal or when your role lacks the capability.

## Wave 5 known limitation: apply does NOT mutate invoice.paid_cents

When you apply a credit note to an invoice, Wave 5's apply handler:

- stamps the link (`credit_notes.invoice_id` if it was previously NULL),
- bumps `credit_notes.applied_cents` by the supplied amount,
- transitions the credit note to `applied` (or stays `applied` if already there).

It **does NOT mutate** the parent invoice's `paid_cents` / `balance_cents` / `payment_status`. The schema-master §9.6 proposal was to write a synthetic `payments` row with `payment_method='credit_note'` on apply, but this is not viable on prod for two reasons:

1. `payments.amount_cents > 0` CHECK is fine, but `payments.payment_method_id` is a `uuid` FK against `payment_methods`, not a free-text discriminator. A synthetic `'credit_note'` payment-method row would have to be seeded in every org, and the FK would still point at a row that doesn't represent an actual payment.
2. `payments.invoice_id` is `NOT NULL` and `payments.currency_code` must match the invoice's currency (enforced by the `assert_invoice_payment_currency` trigger); both constraints are fine for a credit-note shim but the broader semantic is wrong (a synthetic payment row would also re-fire the recompute trigger and bump `paid_cents`, which would conflict with whatever Phase 9 designs).

**Phase 9 is the canonical owner** of the invoice-side rollup of credit notes. The likely design is a new `credit_note_allocations` join table (mirror of the future `payment_allocations` table for multi-invoice payments) so a single credit note can be split across multiple invoices and the invoice rollup is computed from the join, not from synthetic payment rows. Until then, the apply call stamps the link and bumps `applied_cents` only; reconciling the invoice's open balance against issued credit notes is a manual step (or use the Payments tab + a regular payment if you need to mark the invoice as paid in the meantime).

## Browsing credit notes

Navigate to `/credit-notes`. The filter row contains:

- a free-text **Search** input (matches `credit_note_number` and `notes`),
- a **Customer** picker,
- a **Status** picker (`draft` | `issued` | `applied` | `voided`),
- a **Reason** picker,
- a **Currency** picker,
- a date range for `issue_date`.

Table columns: **Credit note #**, **Customer**, **Status** (pill), **Reason**, **Amount**, **Applied**, **Issue date**. Totals render through `MoneyDisplay` against the credit note's own `currency_code`.

## Customer detail Credit Notes tab

The customer detail page (`/customers/:id`) has a **Credit Notes** tab listing every credit note for this customer across all invoices.

`customer_user` role sees only their own customer's credit notes (RLS Pattern C scopes the read to `customer_user.customer_id = credit_notes.customer_id`).

## What's coming next

Phase 9 owns the invoice-side rollup (the deferred work above). Phase 17 audit enrichment captures the wire-side void reason in the audit log so the reason text isn't lost even though the row column doesn't exist.
