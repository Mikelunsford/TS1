/**
 * imports-api — handler factory.
 *
 * Per-entity validate + commit flow with a single per-row mapper. The mapper
 * either returns a database INSERT row (validated) or an array of
 * `{ field, message }` errors. The factory accumulates errors and surfaces
 * them in a structured response; commit refuses to run if any row errored.
 *
 * Idempotency-Key is required on both routes per constitution. Body hash is
 * computed over the parsed JSON (which includes the full base64 payload),
 * so a redrive with the same key + body replays from cache.
 *
 * Service-role admin client performs the bulk insert. Capability gate at
 * the API boundary (`<entity>.create`) is the only authorization check —
 * RLS is intentionally bypassed for atomicity.
 */

import { z } from 'https://esm.sh/zod@3.23.8';

import type { Ctx } from '../../_shared/route.ts';
import { ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { parseCsv } from '../../_shared/csv.ts';
import {
  admin,
  parseBody,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../../_shared/handler-helpers.ts';
import type { Capability } from '../../_shared/capabilities.ts';
import {
  ImportCommitRequestSchema,
  ImportPreviewRequestSchema,
  type ImportRowError,
} from '../types.ts';

const BUNDLE = 'imports-api';

export interface EntityImportDef<TInsertRow> {
  slug: string;
  table: string;
  cap: Capability;
  /**
   * Map a CSV row (string -> string) into an INSERT shape. Return either
   * the row (validated, ready to insert) or an array of field errors.
   */
  mapRow: (
    raw: Record<string, string>,
    rowIndex: number,
    caller: Caller,
  ) => TInsertRow | ImportRowError[];
  /** Optional hook to set defaults (e.g. created_by) before insert. */
  finalizeRow?: (row: TInsertRow, caller: Caller) => TInsertRow;
}

function decodeBase64Csv(b64: string): string {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch (_e) {
    throw new ApiError('VALIDATION_ERROR', 'csv_b64 is not valid base64', 422);
  }
}

interface ValidatedBatch<TInsertRow> {
  total: number;
  errors: ImportRowError[];
  rows: TInsertRow[];
  preview: Array<Record<string, unknown>>;
}

function validate<TInsertRow>(
  text: string,
  def: EntityImportDef<TInsertRow>,
  caller: Caller,
): ValidatedBatch<TInsertRow> {
  let parsed: Record<string, string>[];
  try {
    parsed = parseCsv(text);
  } catch (e) {
    throw new ApiError('VALIDATION_ERROR', `csv parse failed: ${e instanceof Error ? e.message : String(e)}`, 422);
  }
  const rows: TInsertRow[] = [];
  const errors: ImportRowError[] = [];
  const preview: Array<Record<string, unknown>> = [];
  parsed.forEach((raw, idx) => {
    const result = def.mapRow(raw, idx + 1, caller);
    if (Array.isArray(result)) {
      for (const e of result) errors.push({ ...e, row: e.row || idx + 1 });
    } else {
      const finalRow = def.finalizeRow ? def.finalizeRow(result, caller) : result;
      rows.push(finalRow);
      if (preview.length < 20) {
        preview.push(finalRow as unknown as Record<string, unknown>);
      }
    }
  });
  return { total: parsed.length, errors, rows, preview };
}

export function makePreviewHandler<TInsertRow>(
  def: EntityImportDef<TInsertRow>,
): (ctx: Ctx) => Promise<Response> {
  return async (ctx: Ctx): Promise<Response> => {
    try {
      const caller = requireCaller(ctx.req);
      requireCap(caller, def.cap);
      const body = await parseBody(ctx.req, ImportPreviewRequestSchema);

      return await respondWithIdempotency(
        ctx.req,
        caller,
        BUNDLE,
        `POST /imports/${def.slug}`,
        body,
        async () => {
          const text = decodeBase64Csv(body.csv_b64);
          const result = validate(text, def, caller);
          return {
            status: 200,
            body: {
              data: {
                import_id: crypto.randomUUID(),
                errors: result.errors,
                preview: result.preview,
                stats: {
                  total_rows: result.total,
                  valid_rows: result.rows.length,
                  error_rows: result.errors.length,
                },
              },
            },
          };
        },
      );
    } catch (e) {
      if (e instanceof ApiError) return fromApiError(e, ctx.req);
      throw e;
    }
  };
}

export function makeCommitHandler<TInsertRow>(
  def: EntityImportDef<TInsertRow>,
): (ctx: Ctx) => Promise<Response> {
  return async (ctx: Ctx): Promise<Response> => {
    try {
      const caller = requireCaller(ctx.req);
      requireCap(caller, def.cap);
      const body = await parseBody(ctx.req, ImportCommitRequestSchema);

      return await respondWithIdempotency(
        ctx.req,
        caller,
        BUNDLE,
        `POST /imports/${def.slug}/commit`,
        body,
        async () => {
          const text = decodeBase64Csv(body.csv_b64);
          const result = validate(text, def, caller);
          if (result.errors.length > 0) {
            throw new ApiError(
              'VALIDATION_ERROR',
              `import has ${result.errors.length} row error(s); fix and retry preview before commit`,
              422,
              { errors: result.errors },
            );
          }
          if (result.rows.length === 0) {
            return {
              status: 200,
              body: { data: { inserted_count: 0, failed_rows: [] } },
            };
          }
          const { error } = await admin()
            .from(def.table)
            .insert(result.rows as unknown[]);
          if (error) {
            throw new ApiError(
              'INTERNAL_ERROR',
              `bulk insert failed: ${error.message}`,
              500,
              { detail: error.message },
            );
          }
          return {
            status: 200,
            body: {
              data: {
                inserted_count: result.rows.length,
                failed_rows: [],
              },
            },
          };
        },
      );
    } catch (e) {
      if (e instanceof ApiError) return fromApiError(e, ctx.req);
      throw e;
    }
  };
}

/** Small helpers reused by entity mappers. */
export const importHelpers = {
  required(raw: Record<string, string>, field: string, rowIndex: number): string | ImportRowError {
    const v = (raw[field] ?? '').trim();
    if (!v) return { row: rowIndex, field, message: `${field} is required` };
    return v;
  },
  optional(raw: Record<string, string>, field: string): string | null {
    const v = (raw[field] ?? '').trim();
    return v.length > 0 ? v : null;
  },
  optionalInt(raw: Record<string, string>, field: string, rowIndex: number): number | null | ImportRowError {
    const v = (raw[field] ?? '').trim();
    if (!v) return null;
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) {
      return { row: rowIndex, field, message: `${field} must be an integer` };
    }
    return n;
  },
  optionalNumber(raw: Record<string, string>, field: string, rowIndex: number): number | null | ImportRowError {
    const v = (raw[field] ?? '').trim();
    if (!v) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      return { row: rowIndex, field, message: `${field} must be a number` };
    }
    return n;
  },
  optionalBool(raw: Record<string, string>, field: string): boolean | null {
    const v = (raw[field] ?? '').trim().toLowerCase();
    if (!v) return null;
    if (['true', '1', 'yes', 'y'].includes(v)) return true;
    if (['false', '0', 'no', 'n'].includes(v)) return false;
    return null;
  },
};

export const importZ = z;
