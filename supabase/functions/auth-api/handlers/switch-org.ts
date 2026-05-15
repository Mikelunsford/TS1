/**
 * POST /sessions/switch-org
 *
 * Authenticated. Body: { org_id }. Validates the caller has an active
 * membership in the target org, then updates auth.users.app_metadata
 * `team1_org_id` and `team1_org_role`. The SPA follows up with
 * supabase.auth.refreshSession() to pick up the new JWT.
 *
 * Idempotent: `Idempotency-Key` required. Replaying the same key with the
 * same body returns the cached response with `Idempotent-Replay: true`.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError } from '../../_shared/responses.ts';
import { requireOrgContext } from '../../_shared/tenant.ts';
import { createAdminClient } from '../../_shared/supabase-admin.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { SwitchOrgRequestSchema, SwitchOrgResponseSchema, RoleSchema } from '../../_shared/types.ts';

export async function switchOrg({ req }: Ctx): Promise<Response> {
  const ctx = requireOrgContext(req);
  if (!ctx.userId) {
    return err('UNAUTHORIZED', 'Authentication required.', undefined, 401, { req });
  }

  let parsed;
  try {
    const raw = await req.json();
    parsed = SwitchOrgRequestSchema.parse(raw);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return err('VALIDATION_ERROR', 'invalid request body', { detail }, 422, { req });
  }

  try {
    const { response, replayed } = await withIdempotency(
      {
        req,
        org: { orgId: parsed.org_id, userId: ctx.userId, role: null },
        bundle: 'auth-api',
        route: 'POST /sessions/switch-org',
      },
      parsed,
      async () => {
        const admin = createAdminClient();

        const { data: m, error: mErr } = await admin
          .from('org_memberships')
          .select('org_id, is_active, roles:role_id ( code )')
          .eq('user_id', ctx.userId!)
          .eq('org_id', parsed.org_id)
          .eq('is_active', true)
          .maybeSingle();

        if (mErr) {
          throw new ApiError('INTERNAL_ERROR', 'membership lookup failed', 500, { detail: mErr.message });
        }
        type MRow = { org_id: string; is_active: boolean; roles: { code: string } | null };
        const row = m as unknown as MRow | null;
        if (!row || !row.roles?.code) {
          throw new ApiError('NOT_FOUND', 'no active membership for the requested org', 404);
        }
        const role = RoleSchema.parse(row.roles.code);

        // Stamp app_metadata so future JWTs carry the new claim. The SPA
        // calls supabase.auth.refreshSession() after this to pick it up.
        const { error: updErr } = await admin.auth.admin.updateUserById(ctx.userId!, {
          app_metadata: { team1_org_id: parsed.org_id, team1_org_role: role },
        });
        if (updErr) {
          throw new ApiError('INTERNAL_ERROR', 'claim update failed', 500, { detail: updErr.message });
        }

        // Touch profiles.last_org_id for analytics + reload defaults.
        await admin
          .from('profiles')
          .update({ last_org_id: parsed.org_id })
          .eq('user_id', ctx.userId!);

        const body = SwitchOrgResponseSchema.parse({
          active_org_id: parsed.org_id,
          active_role: role,
        });
        return { status: 200, body: { data: body } };
      },
    );

    const extraHeaders: Record<string, string> = {};
    if (replayed) extraHeaders['idempotent-replay'] = 'true';
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-request-id': req.headers.get('x-request-id') ?? crypto.randomUUID(),
        ...extraHeaders,
      },
    });
  } catch (e) {
    if (e instanceof ApiError) {
      return err(e.code, e.message, e.details, e.status, { req });
    }
    throw e;
  }
}
