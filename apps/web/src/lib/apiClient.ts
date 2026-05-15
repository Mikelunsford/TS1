import { z, type ZodTypeAny } from 'zod';

import { supabase } from './supabase';

/**
 * The single HTTP wrapper for talking to Edge Functions. Responsibilities:
 *
 *  1. Inject the Supabase access token as a Bearer.
 *  2. Generate and send an Idempotency-Key on every state-changing request.
 *  3. Serialize bigints safely (replacer below).
 *  4. Parse responses with Zod and unwrap the `{ data }` envelope.
 *  5. Surface `{ error: { code, message } }` as a typed ApiError.
 *
 * See TS1/09-api/00-API-CONTRACT.md.
 */

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    request_id: z.string().optional(),
  }),
});

const DataEnvelope = z.object({
  data: z.unknown(),
  meta: z.unknown().optional(),
});

interface RequestOptions<TResponse extends ZodTypeAny> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /** Schema for the value inside `{ data: ... }`. */
  schema: TResponse;
  /** If true, send an Idempotency-Key header. Auto-true for non-GET. */
  idempotent?: boolean;
  signal?: AbortSignal;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  };
  if (session?.access_token) {
    headers.authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}

export async function apiRequest<TResponse extends ZodTypeAny>(
  opts: RequestOptions<TResponse>,
): Promise<z.infer<TResponse>> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const url = `${apiBaseUrl}${opts.path.startsWith('/') ? opts.path : `/${opts.path}`}`;
  const headers = await authHeaders();

  const needsIdempotency = opts.idempotent ?? method !== 'GET';
  if (needsIdempotency) {
    headers['idempotency-key'] = crypto.randomUUID();
  }

  const init: RequestInit = { method, headers, signal: opts.signal ?? null };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body, bigintReplacer);
  }

  const res = await fetch(url, init);
  const requestId = res.headers.get('x-request-id') ?? undefined;
  const text = await res.text();
  const json = text.length ? (JSON.parse(text) as unknown) : {};

  if (!res.ok) {
    const parsed = ErrorEnvelope.safeParse(json);
    if (parsed.success) {
      throw new ApiError(
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
        parsed.data.error.request_id ?? requestId,
      );
    }
    throw new ApiError('http_error', `HTTP ${res.status}`, json, requestId);
  }

  const envelope = DataEnvelope.parse(json);
  return opts.schema.parse(envelope.data);
}
