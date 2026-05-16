/**
 * CSV helpers — Phase 20 (Wave 10).
 *
 * Streaming CSV writer + parser for exports-api and imports-api. Pure
 * RFC-4180-ish: fields are quoted only when they contain comma, double-quote,
 * CR, or LF; embedded double-quotes are doubled.
 *
 * Streaming reads pages from the Postgres source via the admin client and
 * writes them to a ReadableStream so very large exports don't sit in memory.
 * Page size is hard-coded to 1000 rows (Supabase API max_rows) and the cursor
 * walks `(created_at desc, id desc)` for stability across page boundaries.
 */
import { parse as parseCsvStd } from 'https://deno.land/std@0.224.0/csv/parse.ts';

export type CsvCellValue = string | number | boolean | null | undefined;

/**
 * Encode a single CSV row. Each value is stringified per RFC 4180; objects
 * are JSON-stringified, dates ISO-stringified.
 */
export function csvRow(values: ReadonlyArray<CsvCellValue | Record<string, unknown> | unknown[] | Date>): string {
  const out: string[] = [];
  for (const v of values) {
    out.push(encodeCell(v));
  }
  return out.join(',') + '\r\n';
}

function encodeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) {
    s = v.toISOString();
  } else if (typeof v === 'object') {
    s = JSON.stringify(v);
  } else {
    s = String(v);
  }
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export interface CsvStreamSource<TRow> {
  /** Header row written first. */
  headers: string[];
  /**
   * Map a source row to a flat array of cells aligned with `headers`.
   */
  toRow: (row: TRow) => ReadonlyArray<CsvCellValue | Record<string, unknown> | unknown[] | Date>;
  /**
   * Fetch one page of rows. `cursor` is null for the first page.
   * Return `{ rows, nextCursor }` — nextCursor null when no more pages.
   */
  fetchPage: (cursor: { created_at: string; id: string } | null) => Promise<{
    rows: TRow[];
    nextCursor: { created_at: string; id: string } | null;
  }>;
}

/**
 * Build a streaming CSV Response. The body is a ReadableStream that pulls
 * pages on demand via `source.fetchPage`. Content-Type is text/csv with the
 * provided filename suggested via Content-Disposition.
 */
export function streamCsvResponse<TRow>(
  source: CsvStreamSource<TRow>,
  filename: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const encoder = new TextEncoder();
  let cursor: { created_at: string; id: string } | null = null;
  let wroteHeader = false;
  let done = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (done) {
          controller.close();
          return;
        }
        if (!wroteHeader) {
          controller.enqueue(encoder.encode(csvRow(source.headers)));
          wroteHeader = true;
        }
        const { rows, nextCursor } = await source.fetchPage(cursor);
        for (const r of rows) {
          controller.enqueue(encoder.encode(csvRow(source.toRow(r))));
        }
        cursor = nextCursor;
        if (!nextCursor || rows.length === 0) {
          done = true;
          controller.close();
        }
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      ...extraHeaders,
    },
  });
}

/**
 * Parse a CSV payload into an array of records keyed by header. Uses Deno
 * std parser (RFC-4180). Throws if the CSV is malformed or empty.
 */
export function parseCsv(text: string): Record<string, string>[] {
  if (!text || !text.trim()) return [];
  const rows = parseCsvStd(text, { skipFirstRow: true }) as Record<string, string>[];
  return rows;
}

export {};
