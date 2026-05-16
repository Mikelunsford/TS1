/**
 * State-machine matrix for Wave 4 quote / project / phase workflows.
 *
 * This file is BYTE-MIRRORED into `apps/web/src/lib/workflow.ts` so the SPA
 * gates buttons on the same matrix the server enforces. The contract test
 * (`pnpm test:contract`) asserts the two copies are structurally identical.
 *
 * Alignment with prod enums (verified 2026-05-15 against
 * project_id=ozvanymuzaqbexchuoxz, schema_migrations=0050):
 *
 *   quote_state    : draft | submitted | revise_requested | approved |
 *                    project_pending | cancelled
 *   project_state  : pending | in_production | completed | cancelled |
 *                    ready_to_build | ready_to_ship
 *   project_phases.status (text CHECK)
 *                  : pending | active | completed | cancelled
 *
 * The Wave 4 dispatch text proposed quote states `sent / accepted / declined /
 * converted_to_project` which DO NOT exist in the enum. The constitutional
 * invariant "TS state machines preserved verbatim" (TS1/08-database/00-
 * SCHEMA-MASTER.md §15) is the deciding rule. So:
 *
 *   - `POST /quotes/:id/submit`             → draft → submitted
 *   - `POST /quotes/:id/approve`            → submitted → approved
 *   - `POST /quotes/:id/request-revisions`  → submitted → revise_requested
 *   - `POST /quotes/:id/decline`            → submitted|approved → cancelled
 *   - `POST /quotes/:id/convert-to-project` → approved → project_pending
 *   - `POST /quotes/:id/send`               → NO state change; activity row only
 *   - `POST /quotes/:id/accept`             → NO state change; activity row only
 *
 * R-W4-PF-01 (closed) tracks the divergence; the original dispatch
 * verbs are preserved as the SPA-facing route names but their semantics
 * are bound to the existing enum.
 */

export type QuoteState =
  | 'draft'
  | 'submitted'
  | 'revise_requested'
  | 'approved'
  | 'project_pending'
  | 'cancelled';

export type ProjectState =
  | 'pending'
  | 'ready_to_build'
  | 'in_production'
  | 'ready_to_ship'
  | 'completed'
  | 'cancelled';

export type PhaseStatus = 'pending' | 'active' | 'completed' | 'cancelled';

/**
 * Invoice state — prod `invoices.status` text CHECK (verified 2026-05-15,
 * schema_migrations=0052). Nine values; `refunded` and `cancelled` are
 * terminal.
 */
export type InvoiceState =
  | 'draft'
  | 'pending'
  | 'sent'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'refunded'
  | 'cancelled'
  | 'on_hold';

/**
 * Credit note state — prod `credit_notes.status` text CHECK (verified
 * 2026-05-15, schema_migrations=0052). Four values; `voided` is terminal.
 */
export type CreditNoteState = 'draft' | 'issued' | 'applied' | 'voided';

/**
 * Purchase order state — prod `purchase_orders.status` text CHECK (verified
 * 2026-05-16, schema_migrations=0058). Seven values; `cancelled` and `closed`
 * are terminal. `closed` is reached from `received` after vendor-bill
 * finalization — accounting close-out marker.
 */
export type PurchaseOrderState =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'partial_received'
  | 'received'
  | 'cancelled'
  | 'closed';

/**
 * Vendor bill state — prod `vendor_bills.status` text CHECK (verified
 * 2026-05-16, schema_migrations=0058). Seven values. `overdue` is a soft
 * indicator (set by handler / background when `due_date < today` and unpaid)
 * and IS reachable from `approved` / `partially_paid`. `paid` and `cancelled`
 * are terminal.
 */
export type VendorBillState =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled';

/**
 * Expense state — prod `expenses.status` text CHECK (verified 2026-05-16,
 * schema_migrations=0058). Six values; no `cancelled` (rejected expenses can
 * be resubmitted). `paid` and `reimbursed` are terminal payment states.
 */
export type ExpenseState =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'reimbursed'
  | 'paid';

/**
 * Journal entry state — prod `journal_entries.status` text CHECK (verified
 * 2026-05-16, schema_migrations=0058). Three values; `reversed` is terminal.
 * `draft` entries may be reversed without ever being posted (audit trail for
 * abandoned drafts). Posting a balanced entry stamps `posted_at`; reversing
 * a posted entry creates a mirror entry with flipped debits/credits and
 * stamps `reversed_at` + `reversed_by_entry_id` on the original.
 */
export type JournalEntryState = 'draft' | 'posted' | 'reversed';

/**
 * Receiving order state — prod `receiving_order_state` pg enum (verified
 * 2026-05-16, schema_migrations=0060). Four values; `received` and `cancelled`
 * are terminal. `partial` is reachable from `open` and is a terminal-pending
 * state on the way to `received` (continuing receipts on a partial RO transition
 * partial -> received once the cumulative received_qty reaches expected_qty).
 */
export type ReceivingOrderState = 'open' | 'partial' | 'received' | 'cancelled';

/**
 * Production run state — prod `production_run_state` pg enum (verified
 * 2026-05-16). Four values; `completed` and `cancelled` are terminal.
 * Lifecycle: scheduled -> in_progress -> completed.
 */
export type ProductionRunState = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Shipment state — prod `shipment_state` pg enum (verified 2026-05-16).
 * Four values; `shipped` and `cancelled` are terminal. Lifecycle:
 * scheduled -> loading -> shipped.
 */
export type ShipmentState = 'scheduled' | 'loading' | 'shipped' | 'cancelled';

/**
 * Period close state — Wave 8e / Phase 18. Backed by the
 * `period_close_state` pg enum on prod (verified 2026-05-16,
 * post-0062 schema_migrations=0062). Lifecycle:
 *
 *   open -> in_review -> closed
 *
 * `open` ↔ `in_review` is bidirectional (an in-review period can be
 * sent back to open for late-arriving entries before a close commit).
 * `closed -> reopened` is the only legal exit from terminal `closed`,
 * and a reopened period flows back through `in_review` before it can
 * be closed again (audit trail + double-confirmation).
 *
 * The /close + /reopen endpoints hit dedicated RPCs (close_period,
 * reopen_period) rather than a generic state-stamp PATCH because both
 * carry side-effects (draft-JE preflight, stamped audit markers).
 * The state-stamp PATCH handles the open ↔ in_review back-edit only.
 */
export type PeriodCloseState = 'open' | 'in_review' | 'closed' | 'reopened';

/**
 * Quote transitions matrix. Every (from -> to) listed here is a legal real
 * state change. Endpoints whose semantics are timestamp/activity-only (send,
 * accept) DO NOT appear here; the handler stamps state_changed_at + emits an
 * activity row without invoking assertTransition.
 */
export const QUOTE_TRANSITIONS: Record<QuoteState, readonly QuoteState[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'revise_requested', 'cancelled'],
  revise_requested: ['submitted', 'cancelled'],
  approved: ['project_pending', 'cancelled'],
  project_pending: ['cancelled'],
  cancelled: [],
};

/**
 * Project transitions matrix. Lifecycle: pending -> ready_to_build ->
 * in_production -> ready_to_ship -> completed. `cancelled` reachable from any
 * non-terminal state. `reopen` (completed -> in_production or ready_to_ship)
 * is a backstop and not part of the forward path; it lives here so the helper
 * can validate it.
 */
export const PROJECT_TRANSITIONS: Record<ProjectState, readonly ProjectState[]> = {
  pending: ['ready_to_build', 'in_production', 'cancelled'],
  ready_to_build: ['in_production', 'cancelled'],
  in_production: ['ready_to_ship', 'completed', 'cancelled'],
  ready_to_ship: ['completed', 'cancelled'],
  completed: ['in_production', 'ready_to_ship'], // reopen path
  cancelled: [],
};

/**
 * Phase transitions matrix. Phase status is plain text + CHECK constraint on
 * the DB (not an enum), but the allowed transitions are the same shape as the
 * quote / project matrices.
 */
export const PHASE_TRANSITIONS: Record<PhaseStatus, readonly PhaseStatus[]> = {
  pending: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: ['active'],
  cancelled: [],
};

/**
 * Invoice transitions matrix (TS1/08-database/00-SCHEMA-MASTER.md §15).
 * Lifecycle: draft -> pending -> sent -> partially_paid -> paid; overdue
 * reachable from sent / partially_paid; on_hold reachable from pending / sent;
 * refunded reachable from paid / partially_paid (terminal); cancelled
 * reachable from any non-terminal pre-paid state (terminal).
 */
export const INVOICE_TRANSITIONS: Record<InvoiceState, readonly InvoiceState[]> = {
  draft: ['pending', 'cancelled'],
  pending: ['sent', 'cancelled', 'on_hold'],
  sent: ['partially_paid', 'paid', 'overdue', 'cancelled', 'on_hold'],
  partially_paid: ['paid', 'overdue', 'refunded'],
  paid: ['refunded'],
  overdue: ['partially_paid', 'paid', 'cancelled'],
  on_hold: ['pending', 'sent', 'cancelled'],
  refunded: [],
  cancelled: [],
};

/**
 * Credit note transitions matrix (CHECK constraint values).
 * Lifecycle: draft -> issued -> applied; voided reachable from any
 * non-terminal state and is terminal.
 */
export const CREDIT_NOTE_TRANSITIONS: Record<CreditNoteState, readonly CreditNoteState[]> = {
  draft: ['issued', 'voided'],
  issued: ['applied', 'voided'],
  applied: ['voided'],
  voided: [],
};

/**
 * Purchase order transitions (Wave 7 / Phase 10). Lifecycle:
 *   draft → submitted → approved → partial_received → received → closed.
 * `cancelled` reachable from any non-terminal state. `submitted → draft` is
 * a back-step for revision before approval (keeps the BUILD-ORDER intent of
 * "edit draft" while letting an approver send it back).
 */
export const PURCHASE_ORDER_TRANSITIONS: Record<PurchaseOrderState, readonly PurchaseOrderState[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'draft', 'cancelled'],
  approved: ['partial_received', 'received', 'cancelled'],
  partial_received: ['received', 'cancelled'],
  received: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

/**
 * Vendor bill transitions (Wave 7 / Phase 10). Lifecycle:
 *   draft → pending → approved → partially_paid → paid.
 * `overdue` reachable from `approved` / `partially_paid` (set by handler when
 * due_date < today). `cancelled` reachable from any non-terminal pre-paid
 * state. `paid` and `cancelled` are terminal.
 */
export const VENDOR_BILL_TRANSITIONS: Record<VendorBillState, readonly VendorBillState[]> = {
  draft: ['pending', 'cancelled'],
  pending: ['approved', 'cancelled'],
  approved: ['partially_paid', 'paid', 'overdue', 'cancelled'],
  partially_paid: ['paid', 'overdue', 'cancelled'],
  overdue: ['partially_paid', 'paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

/**
 * Expense transitions (Wave 7 / Phase 11). Lifecycle:
 *   draft → submitted → approved → (reimbursed | paid).
 * `rejected` reachable from `submitted`; rejected expenses can be re-edited
 * by the submitter and re-submitted (rejected → submitted). `reimbursed` is
 * out-of-pocket reimbursement to employee; `paid` is direct payment to vendor.
 * Both terminal.
 */
export const EXPENSE_TRANSITIONS: Record<ExpenseState, readonly ExpenseState[]> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  rejected: ['submitted'],
  approved: ['reimbursed', 'paid'],
  reimbursed: [],
  paid: [],
};

/**
 * Journal entry transitions (Wave 8 / Phase 12). Lifecycle:
 *   draft → posted → reversed.
 * `reversed` reachable from both `draft` and `posted` — reversing a draft
 * is the audit-friendly equivalent of discarding an unposted entry, while
 * reversing a posted entry produces a mirror entry with flipped debits and
 * credits. `reversed` is terminal.
 */
export const JOURNAL_ENTRY_TRANSITIONS: Record<JournalEntryState, readonly JournalEntryState[]> = {
  draft: ['posted', 'reversed'],
  posted: ['reversed'],
  reversed: [],
};

/**
 * Receiving order transitions (Wave 8d / Phase 13). Lifecycle:
 *   open -> partial -> received.
 * `cancelled` reachable from `open` / `partial` only — a fully received RO
 * is terminal. Continuing receipts on a partial RO drive it the rest of the
 * way to `received` (partial -> received).
 */
export const RECEIVING_ORDER_TRANSITIONS: Record<ReceivingOrderState, readonly ReceivingOrderState[]> = {
  open: ['partial', 'received', 'cancelled'],
  partial: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

/**
 * Production run transitions (Wave 8d / Phase 13). Lifecycle:
 *   scheduled -> in_progress -> completed.
 * `cancelled` reachable from any non-terminal state. `completed` and
 * `cancelled` are terminal.
 */
export const PRODUCTION_RUN_TRANSITIONS: Record<ProductionRunState, readonly ProductionRunState[]> = {
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/**
 * Shipment transitions (Wave 8d / Phase 13). Lifecycle:
 *   scheduled -> loading -> shipped.
 * `cancelled` reachable from `scheduled` / `loading` only. `shipped` and
 * `cancelled` are terminal.
 */
export const SHIPMENT_TRANSITIONS: Record<ShipmentState, readonly ShipmentState[]> = {
  scheduled: ['loading', 'cancelled'],
  loading: ['shipped', 'cancelled'],
  shipped: [],
  cancelled: [],
};

/**
 * Period close transitions (Wave 8e / Phase 18). Lifecycle:
 *   open -> in_review -> closed.
 * `open` ↔ `in_review` is bidirectional. `closed -> reopened` is the
 * only legal exit from closed (only via the /reopen endpoint, which
 * calls reopen_period). A `reopened` row re-enters the cycle through
 * `in_review`. Stamping the row from `closed` back to a non-reopened
 * state is illegal — the audit trail demands the reopened intermediate.
 */
export const PERIOD_CLOSE_TRANSITIONS: Record<PeriodCloseState, readonly PeriodCloseState[]> = {
  open: ['in_review'],
  in_review: ['open', 'closed'],
  closed: ['reopened'],
  reopened: ['in_review'],
};

export type WorkflowMachine =
  | 'quote'
  | 'project'
  | 'phase'
  | 'invoice'
  | 'credit_note'
  | 'purchase_order'
  | 'vendor_bill'
  | 'expense'
  | 'journal_entry'
  | 'receiving_order'
  | 'production_run'
  | 'shipment'
  | 'period_close';

type Matrix = Record<string, readonly string[]>;

function getMatrix(machine: WorkflowMachine): Matrix {
  switch (machine) {
    case 'quote':
      return QUOTE_TRANSITIONS as Matrix;
    case 'project':
      return PROJECT_TRANSITIONS as Matrix;
    case 'phase':
      return PHASE_TRANSITIONS as Matrix;
    case 'invoice':
      return INVOICE_TRANSITIONS as Matrix;
    case 'credit_note':
      return CREDIT_NOTE_TRANSITIONS as Matrix;
    case 'purchase_order':
      return PURCHASE_ORDER_TRANSITIONS as Matrix;
    case 'vendor_bill':
      return VENDOR_BILL_TRANSITIONS as Matrix;
    case 'expense':
      return EXPENSE_TRANSITIONS as Matrix;
    case 'journal_entry':
      return JOURNAL_ENTRY_TRANSITIONS as Matrix;
    case 'receiving_order':
      return RECEIVING_ORDER_TRANSITIONS as Matrix;
    case 'production_run':
      return PRODUCTION_RUN_TRANSITIONS as Matrix;
    case 'shipment':
      return SHIPMENT_TRANSITIONS as Matrix;
    case 'period_close':
      return PERIOD_CLOSE_TRANSITIONS as Matrix;
  }
}

/**
 * Return true if `from -> to` is a legal transition for the named machine.
 * Idempotent: `from === to` is always allowed (callers stamping a row a
 * second time with the same status should not 409 themselves).
 */
export function canTransition(
  machine: WorkflowMachine,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const matrix = getMatrix(machine);
  const allowed = matrix[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Throw a STATE_CONFLICT shape when the transition is illegal. Handlers
 * catch the thrown ApiError and route it through `fromApiError` / the
 * envelope helper. The error is a plain Error subclass on this layer to
 * avoid a circular import with responses.ts; handlers re-wrap via
 * `throw new ApiError('STATE_CONFLICT', err.message, 409)`.
 */
export class WorkflowError extends Error {
  readonly machine: WorkflowMachine;
  readonly from: string;
  readonly to: string;
  constructor(machine: WorkflowMachine, from: string, to: string) {
    super(
      `workflow ${machine}: illegal transition ${from} -> ${to}`,
    );
    this.machine = machine;
    this.from = from;
    this.to = to;
    this.name = 'WorkflowError';
  }
}

export function assertTransition(
  machine: WorkflowMachine,
  from: string,
  to: string,
): void {
  if (!canTransition(machine, from, to)) {
    throw new WorkflowError(machine, from, to);
  }
}
