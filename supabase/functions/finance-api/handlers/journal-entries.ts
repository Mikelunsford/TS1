/**
 * finance-api — /journal-entries handlers (Wave 8 / Phase 12).
 *
 * Endpoints:
 *   GET    /journal-entries              — list (filters: status, source_type,
 *                                            source_id, from, to)
 *   POST   /journal-entries              — create draft + lines (single transaction
 *                                            via service-role; lines must contain
 *                                            ≥ 2 rows; per-line CHECKs enforced)
 *   GET    /journal-entries/:id          — detail (with embedded lines[])
 *   PATCH  /journal-entries/:id          — patch draft only; full-replace `lines`
 *                                            semantics
 *   POST   /journal-entries/:id/post     — draft → posted; check_journal_balance
 *                                            raises on imbalance → 422
 *   POST   /journal-entries/:id/reverse  — (draft|posted) → reversed; creates
 *                                            mirror entry with flipped debits/
 *                                            credits; stamps reversed_at +
 *                                            reversed_by_entry_id on original
 *
 * State machine: see JOURNAL_ENTRY_TRANSITIONS in _shared/workflow.ts.
 * `check_journal_balance(p_entry_id uuid)` is a void RPC that RAISES on
 * imbalance — the post handler calls it and converts the raise into a
 * VALIDATION_ERROR 422.
 *
 * Numbering: `next_doc_number(p_org_id, 'journal_entry')` returns the
 * yearly-reset JE-<5d> sequence (seeded for Team1 from Wave 0).
 *
 * Out of scope here (deferred to Wave 8b): JE auto-generation hooks
 * (invoice send / payment create / expense paid / vendor_bill posted)
 * and period close / locking.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  JournalEntryCreateSchema,
  JournalEntryPatchSchema,
  JournalEntryPostSchema,
  JournalEntryReverseSchema,
  JournalEntryLineSchema,
  JournalEntrySchema,
  type JournalEntry,
  type JournalEntryLine,
  type JournalEntryLineInput,
} from '../../_shared/types.ts';
import { assertTransition, WorkflowError } from '../../_shared/workflow.ts';

// ─── Period-close trigger → 422 PERIOD_CLOSED envelope ─────────────────────
// Migration 0074 (Wave 11C) installs a BEFORE INSERT OR UPDATE OF entry_date
// trigger on journal_entries that RAISEs 'period_closed: ...' (SQLSTATE
// P0001) when the entry_date falls inside any closed period for the org.
// We detect that here by message-prefix because PostgREST surfaces the
// exception as a generic error object (the SQLSTATE is in `code` on the
// error). Either signal is sufficient.
function isPeriodClosedError(e: { message?: string; code?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === 'P0001' && (e.message ?? '').includes('period_closed')) return true;
  return (e.message ?? '').startsWith('period_closed');
}
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../_helpers.ts';
import { getNextDocNumber, NumberingError } from '../../_shared/numbering.ts';
import { writeAudit } from '../../_shared/audit.ts';

// ─── Wave 11B audit sweep — Sub-agent B owns this block (R-W10-AUDIT-01). ───
// Skip state-change paths — DB triggers handle those (0041/0047/0058/0060).
// For journal_entries: post/reverse are already trigger-audited (mig 0058).
// We instrument create + non-state PATCH (draft-only edits).

const JE_COLS =
  'id, org_id, entry_number, entry_date, description, status, source_type, ' +
  'source_id, currency_code, posted_at, reversed_at, reversed_by_entry_id, ' +
  'created_at, updated_at';

const JEL_COLS =
  'id, org_id, journal_entry_id, account_id, debit_cents, credit_cents, memo, position';

interface JeRow {
  id: string;
  org_id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  status: string;
  source_type: string | null;
  source_id: string | null;
  currency_code: string;
  posted_at: string | null;
  reversed_at: string | null;
  reversed_by_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

interface JelRow {
  id: string;
  org_id: string;
  journal_entry_id: string;
  account_id: string;
  debit_cents: number;
  credit_cents: number;
  memo: string | null;
  position: number;
}

function rowToJe(row: JeRow): JournalEntry {
  return JournalEntrySchema.parse(row);
}

function rowToJel(row: JelRow): JournalEntryLine {
  return JournalEntryLineSchema.parse(row);
}

function workflowToApiError(e: unknown): never {
  if (e instanceof WorkflowError) {
    throw new ApiError('STATE_CONFLICT', e.message, 409, {
      machine: e.machine,
      from: e.from,
      to: e.to,
    });
  }
  throw e;
}

async function fetchJeRow(caller: Caller, id: string): Promise<JeRow> {
  const { data, error } = await admin()
    .from('journal_entries')
    .select(JE_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'journal_entries lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'journal entry not found', 404);
  return data as JeRow;
}

async function fetchJeLines(caller: Caller, entryId: string): Promise<JelRow[]> {
  const { data, error } = await admin()
    .from('journal_entry_lines')
    .select(JEL_COLS)
    .eq('journal_entry_id', entryId)
    .eq('org_id', caller.orgId)
    .order('position', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'journal_entry_lines lookup failed', 500, {
      detail: error.message,
    });
  }
  return (data ?? []) as JelRow[];
}

async function nextJournalEntryNumber(orgId: string): Promise<string> {
  try {
    return await getNextDocNumber(admin(), orgId, 'journal_entry');
  } catch (e) {
    if (e instanceof NumberingError) {
      throw new ApiError('INTERNAL_ERROR', 'next_doc_number journal_entry failed', 500, {
        detail: e.message,
      });
    }
    throw e;
  }
}

function buildLineInserts(
  caller: Caller,
  entryId: string,
  lines: JournalEntryLineInput[],
): Record<string, unknown>[] {
  return lines.map((l, i) => ({
    org_id: caller.orgId,
    journal_entry_id: entryId,
    account_id: l.account_id,
    debit_cents: l.debit_cents,
    credit_cents: l.credit_cents,
    memo: l.memo ?? null,
    position: l.position ?? i,
  }));
}

// =========================================================================
// GET /journal-entries
// =========================================================================
export async function listJournalEntries({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.journal_entries.read');
    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const status = url.searchParams.get('status');
    const sourceType = url.searchParams.get('source_type');
    const sourceId = url.searchParams.get('source_id');
    const fromDate = url.searchParams.get('from');
    const toDate = url.searchParams.get('to');

    let query = admin()
      .from('journal_entries')
      .select(JE_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (status) query = query.eq('status', status);
    if (sourceType) query = query.eq('source_type', sourceType);
    if (sourceId) query = query.eq('source_id', sourceId);
    if (fromDate) query = query.gte('entry_date', fromDate);
    if (toDate) query = query.lte('entry_date', toDate);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err(
        'INTERNAL_ERROR',
        'journal_entries list query failed',
        { detail: error.message },
        500,
        { req },
      );
    }
    const rows = (data ?? []) as JeRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToJe), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /journal-entries/:id
// =========================================================================
export async function getJournalEntry({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.journal_entries.read');
    const row = await fetchJeRow(caller, params.id);
    const lines = await fetchJeLines(caller, row.id);
    return ok(
      { ...rowToJe(row), lines: lines.map(rowToJel) },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /journal-entries
// =========================================================================
export async function createJournalEntry({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.journal_entries.write');
    const body = await parseBody(req, JournalEntryCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /journal-entries',
      body,
      async () => {
        // Verify every line.account_id lives in caller's org (defense
        // beyond RLS: service-role bypasses RLS so we re-enforce here).
        const accountIds = Array.from(new Set(body.lines.map((l) => l.account_id)));
        const { data: accounts, error: aErr } = await admin()
          .from('chart_of_accounts')
          .select('id, org_id, is_active')
          .in('id', accountIds)
          .eq('org_id', caller.orgId)
          .is('deleted_at', null);
        if (aErr) {
          throw new ApiError('INTERNAL_ERROR', 'chart_of_accounts lookup failed', 500, {
            detail: aErr.message,
          });
        }
        const acctRows = (accounts ?? []) as { id: string; is_active: boolean }[];
        if (acctRows.length !== accountIds.length) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'one or more account_id values not found in caller org',
            422,
          );
        }
        const inactive = acctRows.filter((r) => !r.is_active);
        if (inactive.length > 0) {
          throw new ApiError(
            'VALIDATION_ERROR',
            `cannot post to inactive accounts: ${inactive.map((r) => r.id).join(', ')}`,
            422,
          );
        }

        const entryNumber = await nextJournalEntryNumber(caller.orgId);

        const insertRow = {
          org_id: caller.orgId,
          entry_number: entryNumber,
          entry_date: body.entry_date ?? new Date().toISOString().slice(0, 10),
          description: body.description ?? null,
          status: 'draft',
          source_type: body.source_type ?? 'manual',
          source_id: body.source_id ?? null,
          currency_code: body.currency_code ?? 'USD',
          created_by: caller.userId,
          updated_by: caller.userId,
        };

        const { data, error } = await admin()
          .from('journal_entries')
          .insert(insertRow)
          .select(JE_COLS)
          .single();
        if (error || !data) {
          if (isPeriodClosedError(error)) {
            throw new ApiError(
              'PERIOD_CLOSED',
              'Cannot post a journal entry into a closed accounting period.',
              422,
              { detail: error?.message },
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'journal_entries insert failed', 500, {
            detail: error?.message,
          });
        }
        const je = data as JeRow;

        const lineInserts = buildLineInserts(caller, je.id, body.lines);
        const { error: lErr } = await admin()
          .from('journal_entry_lines')
          .insert(lineInserts);
        if (lErr) {
          // Best-effort cleanup of the header to avoid orphaned drafts.
          await admin().from('journal_entries').delete().eq('id', je.id).eq('org_id', caller.orgId);
          throw new ApiError('INTERNAL_ERROR', 'journal_entry_lines insert failed', 500, {
            detail: lErr.message,
          });
        }

        const lines = await fetchJeLines(caller, je.id);
        // Phase 17 step-8: audit_log write (Wave 11B sweep).
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: caller.orgId,
          entity_type: 'journal_entry',
          entity_id: je.id,
          action: 'create',
          after: { ...rowToJe(je), line_count: lines.length } as unknown as Record<string, unknown>,
        });
        return {
          status: 201,
          body: { data: { ...rowToJe(je), lines: lines.map(rowToJel) } },
        };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PATCH /journal-entries/:id
// =========================================================================
export async function patchJournalEntry({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.journal_entries.write');
    const body = await parseBody(req, JournalEntryPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /journal-entries/:id',
      body,
      async () => {
        const existing = await fetchJeRow(caller, id);
        if (existing.status !== 'draft') {
          throw new ApiError(
            'STATE_CONFLICT',
            `journal entry is ${existing.status}; only draft entries can be patched`,
            409,
          );
        }

        // If lines are being replaced, validate accounts are in-org + active.
        if (body.lines) {
          const accountIds = Array.from(new Set(body.lines.map((l) => l.account_id)));
          const { data: accounts, error: aErr } = await admin()
            .from('chart_of_accounts')
            .select('id, org_id, is_active')
            .in('id', accountIds)
            .eq('org_id', caller.orgId)
            .is('deleted_at', null);
          if (aErr) {
            throw new ApiError('INTERNAL_ERROR', 'chart_of_accounts lookup failed', 500, {
              detail: aErr.message,
            });
          }
          const acctRows = (accounts ?? []) as { id: string; is_active: boolean }[];
          if (acctRows.length !== accountIds.length) {
            throw new ApiError(
              'VALIDATION_ERROR',
              'one or more account_id values not found in caller org',
              422,
            );
          }
          const inactive = acctRows.filter((r) => !r.is_active);
          if (inactive.length > 0) {
            throw new ApiError(
              'VALIDATION_ERROR',
              `cannot post to inactive accounts: ${inactive.map((r) => r.id).join(', ')}`,
              422,
            );
          }
        }

        // Header patch.
        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.entry_date !== undefined) patch.entry_date = body.entry_date;
        if (body.description !== undefined) patch.description = body.description;
        if (body.source_type !== undefined) patch.source_type = body.source_type;
        if (body.source_id !== undefined) patch.source_id = body.source_id;
        if (body.currency_code !== undefined) patch.currency_code = body.currency_code;

        const { data, error } = await admin()
          .from('journal_entries')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(JE_COLS)
          .single();
        if (error || !data) {
          if (isPeriodClosedError(error)) {
            throw new ApiError(
              'PERIOD_CLOSED',
              'Cannot move a journal entry into a closed accounting period.',
              422,
              { detail: error?.message },
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'journal_entries update failed', 500, {
            detail: error?.message,
          });
        }

        // Lines: full-replace semantics. Delete then re-insert if provided.
        if (body.lines) {
          const { error: dErr } = await admin()
            .from('journal_entry_lines')
            .delete()
            .eq('journal_entry_id', id)
            .eq('org_id', caller.orgId);
          if (dErr) {
            throw new ApiError('INTERNAL_ERROR', 'journal_entry_lines delete failed', 500, {
              detail: dErr.message,
            });
          }
          const lineInserts = buildLineInserts(caller, id, body.lines);
          const { error: iErr } = await admin()
            .from('journal_entry_lines')
            .insert(lineInserts);
          if (iErr) {
            throw new ApiError('INTERNAL_ERROR', 'journal_entry_lines insert failed', 500, {
              detail: iErr.message,
            });
          }
        }

        const lines = await fetchJeLines(caller, id);
        // Phase 17 step-8: audit_log write (Wave 11B sweep — draft-edit, non-state).
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: caller.orgId,
          entity_type: 'journal_entry',
          entity_id: id,
          action: 'update',
          before: rowToJe(existing) as unknown as Record<string, unknown>,
          after: { ...rowToJe(data as JeRow), line_count: lines.length } as unknown as Record<string, unknown>,
        });
        return {
          status: 200,
          body: { data: { ...rowToJe(data as JeRow), lines: lines.map(rowToJel) } },
        };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /journal-entries/:id/post
// =========================================================================
export async function postJournalEntry({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.journal_entries.post');
    const body = await parseBody(req, JournalEntryPostSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /journal-entries/:id/post',
      body,
      async () => {
        const existing = await fetchJeRow(caller, id);
        try {
          assertTransition('journal_entry', existing.status, 'posted');
        } catch (e) {
          workflowToApiError(e);
        }

        // Compute balance ourselves so we can return diff on imbalance
        // (cleaner 422 than parsing the RAISE message).
        const lines = await fetchJeLines(caller, id);
        if (lines.length < 2) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'journal entry must have at least 2 lines before posting',
            422,
          );
        }
        let diff = 0;
        for (const l of lines) diff += Number(l.debit_cents) - Number(l.credit_cents);
        if (diff !== 0) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'journal entry is not balanced',
            422,
            { diff },
          );
        }

        // Defense-in-depth: call the RPC. If it raises, we surface 422.
        const { error: rpcErr } = await admin().rpc('check_journal_balance', {
          p_entry_id: id,
        });
        if (rpcErr) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'check_journal_balance RPC raised: ' + rpcErr.message,
            422,
          );
        }

        const nowIso = new Date().toISOString();
        const { data, error } = await admin()
          .from('journal_entries')
          .update({
            status: 'posted',
            posted_at: nowIso,
            updated_at: nowIso,
            updated_by: caller.userId,
          })
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(JE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'journal_entries post failed', 500, {
            detail: error?.message,
          });
        }
        const refreshedLines = await fetchJeLines(caller, id);
        return {
          status: 200,
          body: { data: { ...rowToJe(data as JeRow), lines: refreshedLines.map(rowToJel) } },
        };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /journal-entries/:id/reverse
// =========================================================================
/**
 * Creates a mirror entry: same lines but with debits ↔ credits flipped.
 * Stamps the original with `reversed_at` + `reversed_by_entry_id`. The
 * reversal entry has source_type='manual' + source_id=<original.id> for
 * audit traceability. Both transitions (draft→reversed and posted→
 * reversed) are legal in the matrix; draft reversal is the audit-friendly
 * way to discard an unposted entry.
 */
export async function reverseJournalEntry({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.journal_entries.reverse');
    const body = await parseBody(req, JournalEntryReverseSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /journal-entries/:id/reverse',
      body,
      async () => {
        const existing = await fetchJeRow(caller, id);
        try {
          assertTransition('journal_entry', existing.status, 'reversed');
        } catch (e) {
          workflowToApiError(e);
        }

        const originalLines = await fetchJeLines(caller, id);

        // Create the mirror entry.
        const mirrorNumber = await nextJournalEntryNumber(caller.orgId);
        const nowIso = new Date().toISOString();
        const reasonSuffix = body.reason ? ` — ${body.reason}` : '';
        const description =
          `Reversal of ${existing.entry_number}${reasonSuffix}`;
        const { data: mirror, error: mErr } = await admin()
          .from('journal_entries')
          .insert({
            org_id: caller.orgId,
            entry_number: mirrorNumber,
            entry_date: new Date().toISOString().slice(0, 10),
            description,
            // The mirror is posted immediately when the original was
            // posted; for a draft reversal we leave the mirror in draft
            // so it doesn't ledger anything (audit trail only).
            status: existing.status === 'posted' ? 'posted' : 'draft',
            source_type: 'manual',
            source_id: id,
            currency_code: existing.currency_code,
            posted_at: existing.status === 'posted' ? nowIso : null,
            created_by: caller.userId,
            updated_by: caller.userId,
          })
          .select(JE_COLS)
          .single();
        if (mErr || !mirror) {
          throw new ApiError('INTERNAL_ERROR', 'reversal journal entry insert failed', 500, {
            detail: mErr?.message,
          });
        }

        if (originalLines.length > 0) {
          const flipped = originalLines.map((l) => ({
            org_id: caller.orgId,
            journal_entry_id: (mirror as JeRow).id,
            account_id: l.account_id,
            debit_cents: Number(l.credit_cents),
            credit_cents: Number(l.debit_cents),
            memo: l.memo,
            position: l.position,
          }));
          const { error: lErr } = await admin()
            .from('journal_entry_lines')
            .insert(flipped);
          if (lErr) {
            throw new ApiError('INTERNAL_ERROR', 'reversal journal_entry_lines insert failed', 500, {
              detail: lErr.message,
            });
          }
        }

        // Stamp original.
        const { data, error } = await admin()
          .from('journal_entries')
          .update({
            status: 'reversed',
            reversed_at: nowIso,
            reversed_by_entry_id: (mirror as JeRow).id,
            updated_at: nowIso,
            updated_by: caller.userId,
          })
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(JE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'journal_entries reverse stamp failed', 500, {
            detail: error?.message,
          });
        }
        const finalLines = await fetchJeLines(caller, id);
        return {
          status: 200,
          body: {
            data: {
              ...rowToJe(data as JeRow),
              lines: finalLines.map(rowToJel),
              reversal_entry_id: (mirror as JeRow).id,
            },
          },
        };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}
