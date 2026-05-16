/**
 * exports-api — handler factory.
 *
 * Phase 20 (Wave 10) ships per-entity CSV stream handlers via a small factory.
 * Each entity supplies the table name, column projection, header list, row
 * mapper, capability, and optional feature-flag. The factory wires up the
 * boilerplate: auth → cap check → optional flag check → keyset-paginated
 * page reader → streaming CSV writer.
 *
 * Filters are pulled from the URL by per-entity hooks. The base set
 * (`start`, `end` against created_at) is supported uniformly so every entity
 * can take a date range.
 *
 * Streams come back as `Content-Type: text/csv` with `Content-Disposition`
 * naming the file `<entity>-<ISO date>.csv`.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, requireCap, type Caller } from '../../_shared/handler-helpers.ts';
import { requireFlag } from '../../_shared/requireFlag.ts';
import type { Capability } from '../../_shared/capabilities.ts';
import { streamCsvResponse, type CsvCellValue } from '../../_shared/csv.ts';

export interface ExportEntityDef<TRow extends { id: string; created_at: string }> {
  /** URL slug, e.g. 'vendors'. */
  slug: string;
  /** Postgres table name. */
  table: string;
  /** Comma-separated select list (must include id, created_at). */
  cols: string;
  /** CSV header row. */
  headers: string[];
  /** Map a row to a flat array aligned with headers. */
  toRow: (
    row: TRow,
  ) => ReadonlyArray<CsvCellValue | Record<string, unknown> | unknown[] | Date>;
  /** Read capability required. */
  cap: Capability;
  /** Optional per-route feature-flag key. */
  flagKey?: string;
  /**
   * Apply per-entity URL filters to the query builder. The base filters
   * (org scoping, deleted_at IS NULL, created_at start/end, cursor) are
   * applied for you.
   */
  applyFilters?: (
    qb: ReturnType<ReturnType<typeof admin>['from']>,
    url: URL,
  ) => ReturnType<ReturnType<typeof admin>['from']>;
  /** If true, do NOT filter on `deleted_at IS NULL` (append-only tables). */
  skipSoftDeleteFilter?: boolean;
}

const PAGE_SIZE = 500;

export function makeExportHandler<TRow extends { id: string; created_at: string }>(
  def: ExportEntityDef<TRow>,
): (ctx: Ctx) => Promise<Response> {
  return async ({ req, url }: Ctx): Promise<Response> => {
    try {
      const caller = requireCaller(req);
      requireCap(caller, def.cap);
      if (def.flagKey) {
        await requireFlag(admin(), caller.orgId, def.flagKey);
      }

      const start = url.searchParams.get('start');
      const end = url.searchParams.get('end');
      const today = new Date().toISOString().slice(0, 10);
      const filename = `${def.slug}-${today}.csv`;

      const fetchPage = async (
        cursor: { created_at: string; id: string } | null,
      ): Promise<{
        rows: TRow[];
        nextCursor: { created_at: string; id: string } | null;
      }> => {
        let qb = admin()
          .from(def.table)
          .select(def.cols)
          .eq('org_id', caller.orgId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(PAGE_SIZE + 1);

        if (!def.skipSoftDeleteFilter) {
          qb = qb.is('deleted_at', null);
        }
        if (start) qb = qb.gte('created_at', start);
        if (end) qb = qb.lte('created_at', end);
        if (def.applyFilters) qb = def.applyFilters(qb, url);
        if (cursor) {
          qb = qb.or(
            `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
          );
        }
        const { data, error } = await qb;
        if (error) {
          throw new ApiError(
            'INTERNAL_ERROR',
            `export ${def.slug} page query failed`,
            500,
            { detail: error.message },
          );
        }
        const rows = (data ?? []) as unknown as TRow[];
        if (rows.length <= PAGE_SIZE) {
          return { rows, nextCursor: null };
        }
        const page = rows.slice(0, PAGE_SIZE);
        const overflow = rows[PAGE_SIZE];
        return {
          rows: page,
          nextCursor: { created_at: overflow.created_at, id: overflow.id },
        };
      };

      return streamCsvResponse<TRow>(
        {
          headers: def.headers,
          toRow: def.toRow,
          fetchPage,
        },
        filename,
        {
          'x-org-id': caller.orgId,
          'x-request-id': req.headers.get('x-request-id') ?? crypto.randomUUID(),
        },
      );
    } catch (e) {
      if (e instanceof ApiError) return fromApiError(e, req);
      throw e;
    }
  };
}

export type { Caller };
