/**
 * GET /tenants/resolve-host?host=<host>
 *
 * PUBLIC (verify_jwt=false). Vercel middleware calls this before the SPA
 * boots so it can stamp the org_id cookie and bake the brand into the HTML
 * shell. See TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §7.
 *
 * Resolution rule: look up `org_domains.hostname` (citext) → join
 * `organizations` → join `org_branding`. The hostname is unique platform-
 * wide; ssl_status and verified_at are ignored on read so a partially
 * provisioned domain still resolves the org once seeded.
 *
 * Suspended orgs return NOT_FOUND rather than leaking their existence.
 * An unmapped host returns NOT_FOUND (filtering, not throwing — same shape
 * as RLS denial per the constitution).
 *
 * No idempotency: this is a GET.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err } from '../../_shared/responses.ts';
import { createAdminClient } from '../../_shared/supabase-admin.ts';
import { HostResolveSchema } from '../../_shared/types.ts';

const HOST_MAX_LEN = 253; // RFC 1035 cap.

export async function resolveHost({ req, url }: Ctx): Promise<Response> {
  const host = url.searchParams.get('host');
  if (!host) {
    return err('BAD_REQUEST', 'host query parameter is required.', undefined, 400, { req });
  }
  if (host.length > HOST_MAX_LEN) {
    return err('BAD_REQUEST', 'host is too long.', undefined, 400, { req });
  }
  // Strip port if present (Vercel may pass `localhost:5173`).
  const cleanHost = host.split(':')[0].toLowerCase();

  const admin = createAdminClient();

  // PostgREST nested-select needs a direct FK between the embedding tables.
  // `org_domains.org_id → organizations.id` is direct; `org_branding.org_id`
  // also goes to `organizations.id` but PostgREST can't infer the org_domains
  // → org_branding path because there's no direct FK between them. Two
  // queries; the in-isolate cache (architecture §4.5) absorbs the cost.
  const { data: domainRow, error: domainErr } = await admin
    .from('org_domains')
    .select(
      `
      org_id,
      organizations:org_id (
        id, slug, display_name, default_locale, default_timezone,
        default_currency_code, status
      )
      `,
    )
    .eq('hostname', cleanHost)
    .maybeSingle();

  if (domainErr) {
    return err('INTERNAL_ERROR', 'host lookup failed', { detail: domainErr.message }, 500, { req });
  }

  type DomainRow = {
    org_id: string;
    organizations:
      | {
          id: string;
          slug: string;
          display_name: string;
          default_locale: string;
          default_timezone: string;
          default_currency_code: string;
          status: string;
        }
      | null;
  };
  const row = domainRow as unknown as DomainRow | null;

  if (!row?.organizations || row.organizations.status !== 'active') {
    return err('NOT_FOUND', 'no organization for that host', undefined, 404, { req });
  }

  const o = row.organizations;

  const { data: brandRow, error: brandErr } = await admin
    .from('org_branding')
    .select('primary_color, accent_color')
    .eq('org_id', row.org_id)
    .maybeSingle();

  if (brandErr) {
    return err('INTERNAL_ERROR', 'brand lookup failed', { detail: brandErr.message }, 500, { req });
  }

  const b = brandRow ?? { primary_color: '#0F172A', accent_color: '#3B82F6' };

  const payload = HostResolveSchema.parse({
    org_id: o.id,
    slug: o.slug,
    display_name: o.display_name,
    default_locale: o.default_locale,
    default_timezone: o.default_timezone,
    default_currency_code: o.default_currency_code,
    primary_color: b.primary_color,
    accent_color: b.accent_color,
  });
  return ok(payload, undefined, { req });
}
