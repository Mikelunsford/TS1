/**
 * CORS helpers.
 *
 * Dev: always allow http://localhost:5173 (Vite dev server).
 * Prod: read ALLOWED_ORIGINS from Deno env as a comma-separated allowlist.
 *
 * Allowlist entries may be:
 *   - Exact origins, e.g. `https://ts-1-lime.vercel.app`
 *   - Wildcard-subdomain patterns, e.g. `https://*.team1.app` which matches
 *     any single-level subdomain origin like `https://acme.team1.app`. The
 *     scheme + suffix must match exactly; a bare apex `https://team1.app`
 *     does NOT match `https://*.team1.app`, and origins with a different
 *     suffix do not match.
 *
 * See TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §4.1 / §5
 * and feedback_ts1_cors_allowed_origins.md for the 2026-05-16 incident
 * that motivated wildcard support.
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

/**
 * Pure allowlist check — exported so it can be unit-tested without a Deno
 * runtime. Returns true iff `origin` matches some entry in `list`, where an
 * entry of the form `<scheme>://*.<suffix>` matches origins of the form
 * `<scheme>://<single-label>.<suffix>` (no nested subdomains, no apex match).
 */
export function isOriginAllowed(origin: string, list: string[]): boolean {
  if (!origin) return false;
  for (const entry of list) {
    if (entry === origin) return true;
    // Wildcard subdomain pattern: scheme://*.suffix
    const wildcardMatch = entry.match(/^(https?:\/\/)\*\.(.+)$/);
    if (wildcardMatch && wildcardMatch[1] && wildcardMatch[2]) {
      const scheme = wildcardMatch[1];
      const suffix = wildcardMatch[2];
      // Escape regex meta-chars in the suffix (dots are the obvious one).
      const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${scheme}[a-z0-9-]+\\.${escapedSuffix}$`);
      if (re.test(origin)) return true;
    }
  }
  return false;
}

export function resolveOrigin(req: Request): string {
  const origin = req.headers.get('origin') ?? '';
  const list = allowedOrigins();
  return isOriginAllowed(origin, list) ? origin : DEV_ORIGIN;
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
