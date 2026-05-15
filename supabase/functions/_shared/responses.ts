/**
 * Wire envelope helpers.
 *
 * Every Edge Function response goes through these. The envelope is the
 * constitutional contract from TS1/03-workspace/00-SHARED-CONTEXT.md
 * "Wire Contract Envelope" and TS1/09-api/00-API-CONTRACT.md §0.
 *
 *   success: { data: <T>, meta?: <object> }
 *   error  : { error: { code, message, details?, request_id? } }
 *
 * Every response carries an `x-request-id` header (a UUID v4 generated here
 * when the caller does not pass one). Handlers should pass the inbound
 * request to `ok()` / `err()` so the helper can echo headers correctly.
 */

import { corsHeaders } from './cors.ts';

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'NO_ACTIVE_ORG'
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'STATE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RLS_DENIED'
  | 'RATE_LIMITED'
  | 'METHOD_NOT_ALLOWED'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR'
  // Domain codes appended as Waves 1+ ship. Kept as `string` in the wire
  // schema so we do not have to update the SPA on every new code.
  | (string & {});

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ApiErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function requestId(req?: Request): string {
  const existing = req?.headers.get('x-request-id');
  if (existing && existing.length > 0) return existing;
  return crypto.randomUUID();
}

function baseHeaders(req?: Request, rid?: string): Record<string, string> {
  const cors = req ? corsHeaders(req) : {};
  return {
    ...cors,
    'content-type': 'application/json; charset=utf-8',
    'x-request-id': rid ?? crypto.randomUUID(),
  };
}

export function ok<T>(
  data: T,
  meta?: Record<string, unknown>,
  init?: { req?: Request; status?: number; extraHeaders?: Record<string, string> },
): Response {
  const rid = requestId(init?.req);
  const body = meta === undefined ? { data } : { data, meta };
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      ...baseHeaders(init?.req, rid),
      ...(init?.extraHeaders ?? {}),
    },
  });
}

export function err(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  status = 400,
  init?: { req?: Request; extraHeaders?: Record<string, string> },
): Response {
  const rid = requestId(init?.req);
  const body = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      request_id: rid,
    },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...baseHeaders(init?.req, rid),
      ...(init?.extraHeaders ?? {}),
    },
  });
}

export function methodNotAllowed(req?: Request): Response {
  return err('METHOD_NOT_ALLOWED', 'Method not allowed.', undefined, 405, { req });
}

export function unauthorized(req?: Request, message = 'Authentication required.'): Response {
  return err('UNAUTHORIZED', message, undefined, 401, { req });
}

export function forbidden(req?: Request, message = 'Forbidden.'): Response {
  return err('FORBIDDEN', message, undefined, 403, { req });
}

export function notFound(req?: Request, message = 'Not found.'): Response {
  return err('NOT_FOUND', message, undefined, 404, { req });
}

export function badRequest(message: string, details?: unknown, req?: Request): Response {
  return err('BAD_REQUEST', message, details, 400, { req });
}

export function fromApiError(e: ApiError, req?: Request): Response {
  return err(e.code, e.message, e.details, e.status, { req });
}

export {};
