/**
 * CORS helpers.
 *
 * Dev: always allow http://localhost:5173 (Vite dev server).
 * Prod: read ALLOWED_ORIGINS from Deno env as a comma-separated allowlist.
 *
 * See TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §4.1 / §5.
 */

const DEV_ORIGIN = 'http://localhost:5173';

function allowedOrigins(): string[] {
  const fromEnv = Deno.env.get('ALLOWED_ORIGINS') ?? '';
  const list = fromEnv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (!list.includes(DEV_ORIGIN)) list.push(DEV_ORIGIN);
  return list;
}

export function resolveOrigin(req: Request): string {
  const origin = req.headers.get('origin') ?? '';
  const list = allowedOrigins();
  return list.includes(origin) ? origin : DEV_ORIGIN;
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    'access-control-allow-origin': resolveOrigin(req),
    'access-control-allow-headers':
      'authorization, x-client-info, apikey, content-type, idempotency-key, x-request-id',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'access-control-expose-headers':
      'x-request-id, idempotent-replay, retry-after, x-org-id',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

/** Returns a 204 preflight response if the request is OPTIONS, else null. */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req),
  });
}

export {};
