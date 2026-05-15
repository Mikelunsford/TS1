/**
 * Tiny table-driven router for Edge Function bundles.
 *
 * Wave 0 keeps this minimal: method + path with `:param` slots. Path-prefix
 * matching is exact ('/' matches '/', '/customers/:id' matches '/customers/abc').
 * Trailing slashes are normalized away. Query strings are stripped before match.
 *
 * Waves 1+ may extend RouteDef with `capability`, `idempotent`, `bodySchema`,
 * etc. per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §3.1. The Wave 0 surface is
 * just enough to dispatch a single GET '/' health endpoint per bundle.
 *
 * Constraint: < ~50 lines of actual logic. No regex tricks beyond path-param
 * substitution.
 */

import { methodNotAllowed, notFound } from './responses.ts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  bundle: string;
}

export interface Route {
  method: HttpMethod;
  path: string; // e.g. '/' or '/customers/:id'
  handler: (ctx: Ctx) => Promise<Response> | Response;
}

function normalize(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function matchPath(pattern: string, actual: string): Record<string, string> | null {
  const p = normalize(pattern).split('/');
  const a = normalize(actual).split('/');
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg.startsWith(':')) {
      params[seg.slice(1)] = decodeURIComponent(a[i]);
    } else if (seg !== a[i]) {
      return null;
    }
  }
  return params;
}

/**
 * Extract the in-bundle path. Supabase invokes functions at
 * `/functions/v1/<bundle>/...`; locally the prefix may be `/<bundle>/...`.
 * We strip both the `/functions/v1/<bundle>` form and the bare `/<bundle>` form
 * so handlers see a path rooted at `/`.
 */
function bundlePath(url: URL, bundle: string): string {
  const full = url.pathname;
  const v1 = `/functions/v1/${bundle}`;
  if (full.startsWith(v1)) return normalize(full.slice(v1.length) || '/');
  const bare = `/${bundle}`;
  if (full === bare || full.startsWith(bare + '/')) {
    return normalize(full.slice(bare.length) || '/');
  }
  return normalize(full || '/');
}

export async function route(
  req: Request,
  table: Route[],
  init: { bundle: string },
): Promise<Response> {
  const url = new URL(req.url);
  const path = bundlePath(url, init.bundle);

  let methodMatched = false;
  for (const r of table) {
    const params = matchPath(r.path, path);
    if (params === null) continue;
    if (r.method !== req.method) {
      methodMatched = true;
      continue;
    }
    const ctx: Ctx = { req, url, params, bundle: init.bundle };
    return await r.handler(ctx);
  }
  return methodMatched ? methodNotAllowed(req) : notFound(req);
}

export {};
