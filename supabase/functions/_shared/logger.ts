/**
 * Structured JSON logger for Edge Functions.
 *
 * Emits one JSON line to stdout per call. Supabase's log pipeline ingests
 * stdout, so this is all we need; no transport, no buffering.
 *
 * Schema (per TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §4.4):
 *   { ts, level, msg, request_id?, user_id?, org_id?, bundle?, route?, ...fields }
 *
 * Never log PII or tokens — see "Forbidden Patterns" in
 * TS1/03-workspace/00-SHARED-CONTEXT.md.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  request_id?: string;
  user_id?: string | null;
  org_id?: string | null;
  bundle?: string;
  route?: string;
  status?: number;
  duration_ms?: number;
  [k: string]: unknown;
}

export function log(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  // Use the matching console method so Supabase log levels map cleanly.
  const line = JSON.stringify(entry);
  switch (level) {
    case 'debug':
      console.debug(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
    case 'info':
    default:
      console.log(line);
  }
}

export const debug = (msg: string, fields?: LogFields) => log('debug', msg, fields);
export const info = (msg: string, fields?: LogFields) => log('info', msg, fields);
export const warn = (msg: string, fields?: LogFields) => log('warn', msg, fields);
export const error = (msg: string, fields?: LogFields) => log('error', msg, fields);

export {};
