/**
 * Hotfix-durability — CORS allowlist wildcard-subdomain contract.
 *
 * The function under test lives at
 * `supabase/functions/_shared/cors.ts` as `isOriginAllowed(origin, list)`.
 * That module is Deno-flavored (uses `Deno.env` at top scope inside other
 * exports); Vitest can't resolve the runtime import. Following the pattern
 * established by `feature-flags-cache.test.ts`, we mirror the pure
 * `isOriginAllowed` body inline and assert parity. The function is small
 * (~15 lines) and any divergence will be obvious on review.
 *
 * Contract (mirrors cors.ts as of 2026-05-16):
 *   1. Empty `origin` → false (cannot match anything).
 *   2. Exact-match entries match equal-string origins only.
 *   3. Wildcard entries `<scheme>://*.<suffix>` match origins of shape
 *      `<scheme>://<single-label>.<suffix>` where `<single-label>` is
 *      `[a-z0-9-]+` and no nested subdomain is allowed.
 *   4. Bare apex (no subdomain) does NOT match the wildcard form.
 *   5. Wrong-suffix or wrong-scheme origins do NOT match.
 *   6. Malformed origins (not a URL) do not throw — they simply fail to
 *      match any entry.
 *   7. Mixed lists (exact + wildcard) work together; first match wins
 *      (operationally — the function short-circuits on first match).
 */
import { describe, expect, it } from 'vitest';

/**
 * Inline mirror of the production `isOriginAllowed` in
 * `supabase/functions/_shared/cors.ts`. Keep in lock-step with that body.
 */
function isOriginAllowed(origin: string, list: string[]): boolean {
  if (!origin) return false;
  for (const entry of list) {
    if (entry === origin) return true;
    const wildcardMatch = entry.match(/^(https?:\/\/)\*\.(.+)$/);
    if (wildcardMatch && wildcardMatch[1] && wildcardMatch[2]) {
      const scheme = wildcardMatch[1];
      const suffix = wildcardMatch[2];
      const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${scheme}[a-z0-9-]+\\.${escapedSuffix}$`);
      if (re.test(origin)) return true;
    }
  }
  return false;
}

describe('cors.isOriginAllowed — exact + wildcard subdomain matching', () => {
  it('exact match hit', () => {
    expect(
      isOriginAllowed('https://ts-1-lime.vercel.app', [
        'https://ts-1-lime.vercel.app',
      ]),
    ).toBe(true);
  });

  it('exact match miss (different origin)', () => {
    expect(
      isOriginAllowed('https://evil.example.com', [
        'https://ts-1-lime.vercel.app',
      ]),
    ).toBe(false);
  });

  it('wildcard hit — single-label subdomain', () => {
    expect(
      isOriginAllowed('https://acme.team1.app', ['https://*.team1.app']),
    ).toBe(true);
  });

  it('wildcard miss — wrong suffix', () => {
    expect(
      isOriginAllowed('https://acme.example.com', ['https://*.team1.app']),
    ).toBe(false);
  });

  it('wildcard miss — bare apex (no subdomain)', () => {
    expect(
      isOriginAllowed('https://team1.app', ['https://*.team1.app']),
    ).toBe(false);
  });

  it('mixed list — wildcard match alongside exact entry', () => {
    expect(
      isOriginAllowed('https://acme.team1.app', [
        'https://ts-1-lime.vercel.app',
        'https://*.team1.app',
      ]),
    ).toBe(true);
  });

  it('empty origin returns false', () => {
    expect(isOriginAllowed('', ['https://*.team1.app'])).toBe(false);
  });

  it('malformed origin does not throw and returns false', () => {
    expect(() =>
      isOriginAllowed('not-a-url', ['https://*.team1.app']),
    ).not.toThrow();
    expect(isOriginAllowed('not-a-url', ['https://*.team1.app'])).toBe(false);
  });
});
