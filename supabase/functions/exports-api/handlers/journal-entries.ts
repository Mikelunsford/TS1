/**
 * exports-api — /exports/journal_entries CSV stream.
 *
 * Two shapes:
 *   default                         — one row per JE header
 *   ?expand=lines                   — one row per journal_entry_lines row,
 *                                      with JE header fields denormalized
 *
 * Filters: ?status, ?source_type, ?start/?end (entry_date if expanding lines? no,
 * uniformly created_at to match the base factory).
 *
 * Gated on finance.journal_entries.read. No feature-flag gate — JEs are
 * always-on (auto-emit prereq).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, requireCap } from '../../_shared/handler-helpers.ts';
import { makeExportHandler } from './_factory.ts';
import { streamCsvResponse } from '../../_shared/csv.ts';

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
  debit_cents: number | string;
  credit_cents: number | string;
  memo: string | null;
  position: number;
  created_at: string;
}

const headerExport = makeExportHandler<JeRow>({
  slug: 'journal_entries',
  table: 'journal_entries',
  cols:
    'id, org_id, entry_number, entry_date, description, status, source_type, ' +
    'source_id, currency_code, posted_at, reversed_at, reversed_by_entry_id, ' +
    'created_at, updated_at',
  headers: [
    'id',
    'entry_number',
    'entry_date',
    'description',
    'status',
    'source_type',
    'source_id',
    'currency_code',
    'posted_at',
    'reversed_at',
    'reversed_by_entry_id',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.entry_number,
    r.entry_date,
    r.description,
    r.status,
    r.source_type,
    r.source_id,
    r.currency_code,
    r.posted_at,
    r.reversed_at,
    r.reversed_by_entry_id,
    r.created_at,
    r.updated_at,
  ],
  cap: 'finance.journal_entries.read',
  // journal_entries has no deleted_at column in the schema; skip the soft-delete filter.
  skipSoftDeleteFilter: true,
  applyFilters: (qb, url) => {
    const status = url.searchParams.get('status');
    const sourceType = url.searchParams.get('source_type');
    if (status) qb = qb.eq('status', status);
    if (sourceType) qb = qb.eq('source_type', sourceType);
    return qb;
  },
});

const PAGE_SIZE = 500;

async function exportJournalEntriesLines(ctx: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(ctx.req);
    requireCap(caller, 'finance.journal_entries.read');

    const start = ctx.url.searchParams.get('start');
    const end = ctx.url.searchParams.get('end');
    const today = new Date().toISOString().slice(0, 10);

    const headers = [
      'entry_id',
      'entry_number',
      'entry_date',
      'entry_status',
      'entry_currency_code',
      'line_id',
      'line_position',
      'account_id',
      'debit_cents',
      'credit_cents',
      'memo',
      'line_created_at',
    ];

    const fetchPage = async (
      cursor: { created_at: string; id: string } | null,
    ): Promise<{
      rows: Array<JelRow & { journal_entries: JeRow | null }>;
      nextCursor: { created_at: string; id: string } | null;
    }> => {
      let qb = admin()
        .from('journal_entry_lines')
        .select(
          'id, org_id, journal_entry_id, account_id, debit_cents, credit_cents, memo, ' +
            'position, created_at, journal_entries!inner(id, org_id, entry_number, entry_date, ' +
            'description, status, source_type, source_id, currency_code, posted_at, reversed_at, ' +
            'reversed_by_entry_id, created_at, updated_at)',
        )
        .eq('org_id', caller.orgId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE + 1);

      if (start) qb = qb.gte('created_at', start);
      if (end) qb = qb.lte('created_at', end);
      if (cursor) {
        qb = qb.or(
          `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
        );
      }
      const { data, error } = await qb;
      if (error) {
        throw new ApiError(
          'INTERNAL_ERROR',
          'journal_entries lines export query failed',
          500,
          { detail: error.message },
        );
      }
      const rows = (data ?? []) as unknown as Array<
        JelRow & { journal_entries: JeRow | null }
      >;
      if (rows.length <= PAGE_SIZE) return { rows, nextCursor: null };
      const page = rows.slice(0, PAGE_SIZE);
      const overflow = rows[PAGE_SIZE];
      return {
        rows: page,
        nextCursor: { created_at: overflow.created_at, id: overflow.id },
      };
    };

    return streamCsvResponse(
      {
        headers,
        toRow: (r) => {
          const je = r.journal_entries;
          return [
            je?.id ?? r.journal_entry_id,
            je?.entry_number ?? '',
            je?.entry_date ?? '',
            je?.status ?? '',
            je?.currency_code ?? '',
            r.id,
            r.position,
            r.account_id,
            r.debit_cents,
            r.credit_cents,
            r.memo,
            r.created_at,
          ];
        },
        fetchPage,
      },
      `journal_entries-lines-${today}.csv`,
      {
        'x-org-id': caller.orgId,
        'x-request-id': ctx.req.headers.get('x-request-id') ?? crypto.randomUUID(),
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, ctx.req);
    throw e;
  }
}

export function exportJournalEntries(ctx: Ctx): Promise<Response> {
  const expand = ctx.url.searchParams.get('expand');
  if (expand === 'lines') return exportJournalEntriesLines(ctx);
  return headerExport(ctx) as Promise<Response>;
}
