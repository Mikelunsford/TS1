/**
 * /admin/organizations — list, get, provision, suspend, unsuspend.
 *
 * SECURITY: every handler gates on `requirePlatformAdmin()`. Writes call
 * `writeAudit()` with entity_type='organization' + actor=platform admin.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { admin, parseBody, respondWithIdempotency } from '../_helpers.ts';
import { requirePlatformAdmin } from '../platform-admin.ts';
import { writeAudit } from '../../_shared/audit.ts';
import { DEFAULT_FEATURE_FLAGS } from '../../_shared/feature-defaults.ts';
import { ProvisionOrgSchema, SuspendOrgSchema } from '../schemas.ts';

interface OrgRow {
  id: string;
  slug: string;
  display_name: string;
  status: string;
  suspended_at: string | null;
  suspended_by: string | null;
  created_at: string;
}

function clampPage(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 10_000);
}
function clampPageSize(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 25;
  if (!Number.isFinite(n) || n < 1) return 25;
  return Math.min(n, 200);
}

export async function listOrganizations({ req, url }: Ctx): Promise<Response> {
  await requirePlatformAdmin(req);
  const sb = admin();
  const search = url.searchParams.get('search')?.trim() ?? '';
  const page = clampPage(url.searchParams.get('page'));
  const pageSize = clampPageSize(url.searchParams.get('page_size'));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = sb
    .from('organizations')
    .select('id, slug, display_name, status, suspended_at, suspended_by, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) {
    // PG-safe ilike on display_name or slug.
    q = q.or(`display_name.ilike.%${search}%,slug.ilike.%${search}%`);
  }

  const { data, error, count } = await q;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'organizations list failed', 500, {
      detail: error.message,
    });
  }

  const orgs = (data ?? []) as OrgRow[];
  const orgIds = orgs.map((o) => o.id);

  // Member counts via a second query (one round trip per page).
  const memberCountByOrg = new Map<string, number>();
  if (orgIds.length > 0) {
    const { data: mems, error: memErr } = await sb
      .from('org_memberships')
      .select('org_id')
      .in('org_id', orgIds)
      .eq('is_active', true);
    if (memErr) {
      throw new ApiError('INTERNAL_ERROR', 'membership count failed', 500, {
        detail: memErr.message,
      });
    }
    for (const m of (mems ?? []) as Array<{ org_id: string }>) {
      memberCountByOrg.set(m.org_id, (memberCountByOrg.get(m.org_id) ?? 0) + 1);
    }
  }

  const items = orgs.map((o) => ({
    ...o,
    member_count: memberCountByOrg.get(o.id) ?? 0,
  }));

  return ok(
    { items, total: count ?? items.length, page, page_size: pageSize },
    undefined,
    { req },
  );
}

export async function getOrganization({ req, params }: Ctx): Promise<Response> {
  await requirePlatformAdmin(req);
  const id = params.id;
  if (!id) throw new ApiError('VALIDATION_ERROR', 'id is required', 422);
  const sb = admin();

  const { data: org, error: orgErr } = await sb
    .from('organizations')
    .select('id, slug, display_name, status, suspended_at, suspended_by, created_at')
    .eq('id', id)
    .maybeSingle();
  if (orgErr) {
    throw new ApiError('INTERNAL_ERROR', 'organization lookup failed', 500, {
      detail: orgErr.message,
    });
  }
  if (!org) throw new ApiError('NOT_FOUND', 'organization not found', 404);

  const [membersRes, flagsRes, domainsRes, memberCountRes] = await Promise.all([
    sb
      .from('org_memberships')
      .select('user_id, is_active, created_at, roles:role_id ( code )')
      .eq('org_id', id)
      .order('created_at', { ascending: false })
      .limit(500),
    // Wire shape is { flag_key, enabled } per the SPA + BE Zod schema.
    // DB column is `is_enabled` (Wave 0 / 0029 + Wave 6 feedback memo).
    // PostgREST `column:alias` syntax renames in the response.
    sb.from('org_feature_flags').select('flag_key, enabled:is_enabled').eq('org_id', id),
    sb
      .from('org_domains')
      .select('id, hostname, is_primary, verified_at, ssl_status')
      .eq('org_id', id),
    sb
      .from('org_memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', id)
      .eq('is_active', true),
  ]);

  if (membersRes.error) {
    throw new ApiError('INTERNAL_ERROR', 'memberships lookup failed', 500, {
      detail: membersRes.error.message,
    });
  }
  if (flagsRes.error) {
    throw new ApiError('INTERNAL_ERROR', 'feature flags lookup failed', 500, {
      detail: flagsRes.error.message,
    });
  }
  if (domainsRes.error) {
    throw new ApiError('INTERNAL_ERROR', 'domains lookup failed', 500, {
      detail: domainsRes.error.message,
    });
  }

  type MembershipRow = {
    user_id: string;
    is_active: boolean;
    created_at: string;
    roles: { code: string } | null;
  };
  const memberRows = (membersRes.data ?? []) as unknown as MembershipRow[];
  const userIds = memberRows.map((m) => m.user_id);

  // Hydrate emails via profiles.
  const profileByUser = new Map<string, { email: string | null; display_name: string | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await sb
      .from('profiles')
      .select('user_id, email, display_name')
      .in('user_id', userIds);
    for (const p of (profs ?? []) as Array<{
      user_id: string;
      email: string | null;
      display_name: string | null;
    }>) {
      profileByUser.set(p.user_id, { email: p.email, display_name: p.display_name });
    }
  }

  const memberships = memberRows.map((m) => ({
    user_id: m.user_id,
    email: profileByUser.get(m.user_id)?.email ?? null,
    display_name: profileByUser.get(m.user_id)?.display_name ?? null,
    role: m.roles?.code ?? 'unknown',
    is_active: m.is_active,
    created_at: m.created_at,
  }));

  return ok(
    {
      org: { ...org, member_count: memberCountRes.count ?? 0 },
      memberships,
      feature_flags: flagsRes.data ?? [],
      domains: domainsRes.data ?? [],
    },
    undefined,
    { req },
  );
}

export async function provisionOrganization({ req }: Ctx): Promise<Response> {
  const caller = await requirePlatformAdmin(req);
  const body = await parseBody(req, ProvisionOrgSchema);

  return respondWithIdempotency(
    req,
    { userId: caller.userId, orgId: caller.homeOrgId ?? '00000000-0000-0000-0000-000000000000', role: 'org_owner' },
    'POST /admin/organizations',
    body,
    async () => {
      const sb = admin();

      // 1. Create org row.
      const { data: org, error: orgErr } = await sb
        .from('organizations')
        .insert({ slug: body.slug, display_name: body.name })
        .select('id, slug, display_name, status, created_at, suspended_at, suspended_by')
        .single();
      if (orgErr) {
        if (orgErr.message?.includes('unique')) {
          throw new ApiError('STATE_CONFLICT', 'slug already in use', 409, {
            slug: body.slug,
          });
        }
        throw new ApiError('INTERNAL_ERROR', 'organization insert failed', 500, {
          detail: orgErr.message,
        });
      }

      // 2. Resolve / create owner user via Supabase auth admin API.
      // Try existing user first by listing — if not present, create one via
      // invite-by-email so the user can complete signup.
      const { data: listed } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      let ownerUserId: string | null = null;
      for (const u of listed?.users ?? []) {
        if (u.email?.toLowerCase() === body.owner_email.toLowerCase()) {
          ownerUserId = u.id;
          break;
        }
      }
      if (!ownerUserId) {
        const { data: invite, error: inviteErr } =
          await sb.auth.admin.inviteUserByEmail(body.owner_email, {
            data: { full_name: body.owner_full_name },
          });
        if (inviteErr || !invite.user) {
          throw new ApiError('INTERNAL_ERROR', 'owner invite failed', 500, {
            detail: inviteErr?.message ?? 'no user returned',
          });
        }
        ownerUserId = invite.user.id;
      }

      // 3. Upsert profile row.
      await sb
        .from('profiles')
        .upsert(
          { user_id: ownerUserId, email: body.owner_email, display_name: body.owner_full_name },
          { onConflict: 'user_id' },
        );

      // 4. Look up org_owner role id.
      const { data: ownerRole, error: ownerRoleErr } = await sb
        .from('roles')
        .select('id')
        .eq('code', 'org_owner')
        .maybeSingle();
      if (ownerRoleErr || !ownerRole) {
        throw new ApiError('INTERNAL_ERROR', 'org_owner role not seeded', 500);
      }

      // 5. Insert org_membership.
      const { error: memErr } = await sb
        .from('org_memberships')
        .insert({
          org_id: org.id,
          user_id: ownerUserId,
          role_id: ownerRole.id,
          is_active: true,
        });
      if (memErr) {
        // Best-effort compensating delete on the org row. PostgREST doesn't
        // give us a real txn so we DELETE the freshly-created org to avoid
        // orphans. RLS-clean because admin() is service-role.
        await sb.from('organizations').delete().eq('id', org.id);
        throw new ApiError('INTERNAL_ERROR', 'membership insert failed', 500, {
          detail: memErr.message,
        });
      }

      // 6. Seed per-org defaults (Wave 11C R-W11-PROVISION-01).
      //    seed_org_defaults is idempotent per migration 0074 — re-runs
      //    safe via per-org NOT EXISTS guards.
      const { error: seedErr } = await sb.rpc('seed_org_defaults', {
        p_org_id: org.id,
      });
      if (seedErr) {
        // Compensating rollback: delete membership + org. Best-effort —
        // PostgREST has no cross-statement txn.
        await sb.from('org_memberships').delete().eq('org_id', org.id);
        await sb.from('organizations').delete().eq('id', org.id);
        throw new ApiError('INTERNAL_ERROR', 'org defaults seed failed', 500, {
          detail: seedErr.message,
        });
      }

      // 7. Seed default feature flags. Use upsert so re-running on partial
      //    failure is harmless.
      const flagRows = Object.entries(DEFAULT_FEATURE_FLAGS).map(([flag_key, is_enabled]) => ({
        org_id: org.id,
        flag_key,
        is_enabled,
        config: {},
        created_by: caller.userId,
        updated_by: caller.userId,
      }));
      const { error: flagErr } = await sb
        .from('org_feature_flags')
        .upsert(flagRows, { onConflict: 'org_id,flag_key' });
      if (flagErr) {
        // Non-fatal: log via audit but don't roll back the whole org. An
        // org without flags is recoverable (admin can re-run via console).
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: org.id,
          entity_type: 'organization',
          entity_id: org.id,
          action: 'platform_admin.provision.feature_flags_warn',
          after: { error: flagErr.message },
          notes: 'feature flag seed partially failed; org left in default-false state',
        });
      }

      // 8. Hydrate seeded counts so the SPA can show "13 accounts, 1 warehouse".
      const [{ count: coaCount }, { count: warehouseCount }] = await Promise.all([
        sb
          .from('chart_of_accounts')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', org.id),
        sb
          .from('warehouses')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', org.id),
      ]);

      await writeAudit({
        actor_user_id: caller.userId,
        org_id: org.id,
        entity_type: 'organization',
        entity_id: org.id,
        action: 'platform_admin.provision',
        after: {
          slug: org.slug,
          display_name: org.display_name,
          owner_email: body.owner_email,
          coa_count: coaCount ?? 0,
          warehouse_count: warehouseCount ?? 0,
        },
        notes: `platform admin ${caller.userId} provisioned new org`,
      });

      return {
        status: 201,
        body: {
          data: {
            org,
            owner_user_id: ownerUserId,
            coa_count: coaCount ?? 0,
            warehouse_count: warehouseCount ?? 0,
          },
        },
      };
    },
  );
}

export async function suspendOrganization({ req, params }: Ctx): Promise<Response> {
  const caller = await requirePlatformAdmin(req);
  const id = params.id;
  if (!id) throw new ApiError('VALIDATION_ERROR', 'id is required', 422);
  const body = await parseBody(req, SuspendOrgSchema);

  return respondWithIdempotency(
    req,
    { userId: caller.userId, orgId: id, role: 'org_owner' },
    'POST /admin/organizations/:id/suspend',
    body,
    async () => {
      const sb = admin();

      const { data: before, error: beforeErr } = await sb
        .from('organizations')
        .select('id, status, suspended_at, suspended_by')
        .eq('id', id)
        .maybeSingle();
      if (beforeErr) {
        throw new ApiError('INTERNAL_ERROR', 'org lookup failed', 500, {
          detail: beforeErr.message,
        });
      }
      if (!before) throw new ApiError('NOT_FOUND', 'organization not found', 404);

      const { data: after, error: updErr } = await sb
        .from('organizations')
        .update({
          status: 'suspended',
          suspended_at: new Date().toISOString(),
          suspended_by: caller.userId,
        })
        .eq('id', id)
        .select('id, status, suspended_at, suspended_by')
        .single();
      if (updErr) {
        throw new ApiError('INTERNAL_ERROR', 'org suspend failed', 500, {
          detail: updErr.message,
        });
      }

      await writeAudit({
        actor_user_id: caller.userId,
        org_id: id,
        entity_type: 'organization',
        entity_id: id,
        action: 'platform_admin.suspend',
        before,
        after,
        notes: body.reason ?? null,
      });

      return { status: 200, body: { data: { org: after } } };
    },
  );
}

export async function unsuspendOrganization({ req, params }: Ctx): Promise<Response> {
  const caller = await requirePlatformAdmin(req);
  const id = params.id;
  if (!id) throw new ApiError('VALIDATION_ERROR', 'id is required', 422);

  return respondWithIdempotency(
    req,
    { userId: caller.userId, orgId: id, role: 'org_owner' },
    'POST /admin/organizations/:id/unsuspend',
    {},
    async () => {
      const sb = admin();

      const { data: before, error: beforeErr } = await sb
        .from('organizations')
        .select('id, status, suspended_at, suspended_by')
        .eq('id', id)
        .maybeSingle();
      if (beforeErr) {
        throw new ApiError('INTERNAL_ERROR', 'org lookup failed', 500, {
          detail: beforeErr.message,
        });
      }
      if (!before) throw new ApiError('NOT_FOUND', 'organization not found', 404);

      const { data: after, error: updErr } = await sb
        .from('organizations')
        .update({
          status: 'active',
          suspended_at: null,
          suspended_by: null,
        })
        .eq('id', id)
        .select('id, status, suspended_at, suspended_by')
        .single();
      if (updErr) {
        throw new ApiError('INTERNAL_ERROR', 'org unsuspend failed', 500, {
          detail: updErr.message,
        });
      }

      await writeAudit({
        actor_user_id: caller.userId,
        org_id: id,
        entity_type: 'organization',
        entity_id: id,
        action: 'platform_admin.unsuspend',
        before,
        after,
      });

      return { status: 200, body: { data: { org: after } } };
    },
  );
}
