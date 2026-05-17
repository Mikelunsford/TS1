/**
 * /admin/impersonate, /admin/impersonate/end, /admin/impersonation-history
 *
 * SECURITY — read carefully:
 *
 * Supabase auth's admin API does not expose a direct "mint a JWT for arbitrary
 * user" endpoint that returns a ready-to-use access_token. The supported flow
 * is `auth.admin.generateLink({ type: 'magiclink', email })`, which returns a
 * hashed token + verify URL the client exchanges via `verifyOtp` to obtain a
 * real session. We use that pattern here:
 *
 *   1. Look up the impersonated user's email by user_id (auth.admin.getUserById).
 *   2. Verify they are a member of the target org (else FORBIDDEN).
 *   3. Stamp `app_metadata.team1_org_id` / `team1_org_role` /
 *      `impersonated_by` on the user via auth.admin.updateUserById, so the
 *      next session emitted carries the correct claims and a clear "this is
 *      an impersonation" marker the SPA can render.
 *   4. Generate a magic-link hashed token via auth.admin.generateLink.
 *   5. Insert an `impersonation_sessions` row + an audit_log row.
 *
 * The SPA's <ImpersonateButton> calls this endpoint, then does
 * `supabase.auth.verifyOtp({ type:'magiclink', token_hash, email })` which
 * swaps the active session for the impersonated user's session. The
 * `impersonated_by` claim drives the persistent red <EndImpersonationBanner>.
 *
 * Token revocation on "end": we cannot revoke an already-issued JWT; we set
 * `ended_at` on the session row + clear the `impersonated_by` claim. The
 * client banner is the source of truth for "currently impersonating".
 *
 * Wave 11 (R-W10-P23-OBS-01): impersonation TTL is now 15 minutes (was 1h).
 * The Supabase JS SDK 2.45.0 does NOT expose an `expires_in` option on
 * `auth.admin.generateLink`, so we tighten the window two ways instead:
 *   1. Stamp `app_metadata.impersonation_expires_at` (ISO timestamp 15 min
 *      ahead). The SPA's <EndImpersonationBanner> reads this claim from the
 *      session and forcibly ends the impersonation when it elapses.
 *   2. Return `expires_in: 900` in the response so the banner can render a
 *      live countdown.
 * The magic-link token itself still inherits the Supabase project's default
 * link TTL — we cap the IMPERSONATION SESSION, not the auth link.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { admin, parseBody, respondWithIdempotency, parseLimit } from '../_helpers.ts';
import { requirePlatformAdmin } from '../platform-admin.ts';
import { writeAudit } from '../../_shared/audit.ts';
import { ImpersonateSchema, EndImpersonationSchema } from '../schemas.ts';

export async function impersonate({ req }: Ctx): Promise<Response> {
  const caller = await requirePlatformAdmin(req);
  const body = await parseBody(req, ImpersonateSchema);

  return respondWithIdempotency(
    req,
    { userId: caller.userId, orgId: body.org_id, role: 'org_owner' },
    'POST /admin/impersonate',
    body,
    async () => {
      const sb = admin();

      // 1. Resolve impersonated user.
      const { data: targetData, error: targetErr } = await sb.auth.admin.getUserById(body.user_id);
      if (targetErr || !targetData.user) {
        throw new ApiError('NOT_FOUND', 'impersonated user not found', 404, {
          detail: targetErr?.message,
        });
      }
      const target = targetData.user;
      if (!target.email) {
        throw new ApiError(
          'STATE_CONFLICT',
          'impersonated user has no email — cannot mint magic link',
          409,
        );
      }

      // 2. Verify membership in target org.
      const { data: memData, error: memErr } = await sb
        .from('org_memberships')
        .select('user_id, role_id, is_active, roles:role_id ( code )')
        .eq('org_id', body.org_id)
        .eq('user_id', body.user_id)
        .eq('is_active', true)
        .maybeSingle();
      if (memErr) {
        throw new ApiError('INTERNAL_ERROR', 'membership check failed', 500, {
          detail: memErr.message,
        });
      }
      if (!memData) {
        throw new ApiError(
          'FORBIDDEN',
          'impersonated user is not an active member of the target org',
          403,
        );
      }
      const targetRole =
        (memData as { roles: { code: string } | null }).roles?.code ?? 'viewer';

      // 3. Stamp claims on the user so the next session carries correct context.
      // Wave 11 (R-W10-P23-OBS-01): impersonation_expires_at is the hard TTL
      // the SPA banner enforces. 15 min ahead of NOW.
      const IMPERSONATION_TTL_SECONDS = 900; // 15 min
      const expiresAtIso = new Date(
        Date.now() + IMPERSONATION_TTL_SECONDS * 1000,
      ).toISOString();
      const existingAppMeta = (target.app_metadata ?? {}) as Record<string, unknown>;
      const { error: updErr } = await sb.auth.admin.updateUserById(body.user_id, {
        app_metadata: {
          ...existingAppMeta,
          team1_org_id: body.org_id,
          team1_org_role: targetRole,
          impersonated_by: caller.userId,
          impersonation_reason: body.reason,
          impersonation_expires_at: expiresAtIso,
        },
      });
      if (updErr) {
        throw new ApiError('INTERNAL_ERROR', 'claim stamp failed', 500, {
          detail: updErr.message,
        });
      }

      // 4. Insert impersonation_sessions row first so we have its id.
      const { data: sessRow, error: sessErr } = await sb
        .from('impersonation_sessions')
        .insert({
          admin_user_id: caller.userId,
          impersonated_user_id: body.user_id,
          org_id: body.org_id,
          reason: body.reason,
        })
        .select('id')
        .single();
      if (sessErr || !sessRow) {
        throw new ApiError('INTERNAL_ERROR', 'impersonation_sessions insert failed', 500, {
          detail: sessErr?.message,
        });
      }

      // 5. Write audit_log row.
      await writeAudit({
        actor_user_id: caller.userId,
        org_id: body.org_id,
        entity_type: 'impersonation',
        entity_id: sessRow.id,
        action: 'platform_admin.impersonate.start',
        after: {
          impersonated_user_id: body.user_id,
          impersonated_email: target.email,
          reason: body.reason,
        },
        notes: body.reason,
      });

      // 6. Mint a magic-link token for the impersonated user. The SPA
      //    exchanges it via verifyOtp to obtain the live session.
      const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
        type: 'magiclink',
        email: target.email,
      });
      if (linkErr || !linkData) {
        throw new ApiError('INTERNAL_ERROR', 'magic link generation failed', 500, {
          detail: linkErr?.message,
        });
      }

      // Supabase returns `properties.hashed_token` + `action_link`.
      const props = (linkData as { properties?: Record<string, unknown> }).properties ?? {};
      const hashedToken = typeof props.hashed_token === 'string' ? props.hashed_token : null;
      const actionLink = typeof props.action_link === 'string' ? props.action_link : null;
      if (!hashedToken) {
        throw new ApiError('INTERNAL_ERROR', 'hashed_token missing from generateLink', 500);
      }

      // Wave 11 (R-W10-P23-OBS-01): impersonation window is 15 min, enforced
      // by the SPA banner against impersonation_expires_at in app_metadata.
      return {
        status: 201,
        body: {
          data: {
            session_id: sessRow.id,
            access_token: hashedToken, // SPA uses verifyOtp(token_hash) to redeem
            refresh_token: null,
            expires_in: IMPERSONATION_TTL_SECONDS,
            expires_at: expiresAtIso,
            impersonated_user_id: body.user_id,
            impersonated_email: target.email,
            org_id: body.org_id,
            action_link: actionLink,
          },
        },
      };
    },
  );
}

export async function endImpersonation({ req }: Ctx): Promise<Response> {
  const caller = await requirePlatformAdmin(req);
  const body = await parseBody(req, EndImpersonationSchema);

  return respondWithIdempotency(
    req,
    { userId: caller.userId, orgId: '00000000-0000-0000-0000-000000000000', role: 'org_owner' },
    'POST /admin/impersonate/end',
    body,
    async () => {
      const sb = admin();

      // Look up session — must belong to the calling admin.
      const { data: sess, error: sessErr } = await sb
        .from('impersonation_sessions')
        .select('id, admin_user_id, impersonated_user_id, org_id, ended_at')
        .eq('id', body.session_id)
        .maybeSingle();
      if (sessErr) {
        throw new ApiError('INTERNAL_ERROR', 'session lookup failed', 500, {
          detail: sessErr.message,
        });
      }
      if (!sess) throw new ApiError('NOT_FOUND', 'session not found', 404);
      if (sess.admin_user_id !== caller.userId) {
        throw new ApiError('FORBIDDEN', 'session belongs to another admin', 403);
      }

      // Clear the impersonation claims on the impersonated user.
      const { data: target } = await sb.auth.admin.getUserById(sess.impersonated_user_id);
      if (target?.user) {
        const meta = { ...(target.user.app_metadata ?? {}) } as Record<string, unknown>;
        delete meta.impersonated_by;
        delete meta.impersonation_reason;
        // Wave 11 (R-W10-P23-OBS-01): clear TTL claim alongside the others.
        delete meta.impersonation_expires_at;
        await sb.auth.admin.updateUserById(sess.impersonated_user_id, { app_metadata: meta });
      }

      // Mark session ended (idempotent — re-running just resets ended_at).
      const { data: updated, error: updErr } = await sb
        .from('impersonation_sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', body.session_id)
        .select('id, ended_at')
        .single();
      if (updErr) {
        throw new ApiError('INTERNAL_ERROR', 'session end update failed', 500, {
          detail: updErr.message,
        });
      }

      await writeAudit({
        actor_user_id: caller.userId,
        org_id: sess.org_id,
        entity_type: 'impersonation',
        entity_id: sess.id,
        action: 'platform_admin.impersonate.end',
        before: { ended_at: sess.ended_at },
        after: { ended_at: updated.ended_at },
      });

      return { status: 200, body: { data: { session: updated } } };
    },
  );
}

export async function impersonationHistory({ req, url }: Ctx): Promise<Response> {
  await requirePlatformAdmin(req);
  const sb = admin();

  const filterAdminUserId = url.searchParams.get('admin_user_id');
  const pageRaw = url.searchParams.get('page');
  const page = pageRaw ? Math.max(1, Number.parseInt(pageRaw, 10)) : 1;
  const pageSize = parseLimit(url);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = sb
    .from('impersonation_sessions')
    .select(
      'id, admin_user_id, impersonated_user_id, org_id, reason, started_at, ended_at',
      { count: 'exact' },
    )
    .order('started_at', { ascending: false })
    .range(from, to);

  if (filterAdminUserId) {
    q = q.eq('admin_user_id', filterAdminUserId);
  }

  const { data, error, count } = await q;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'impersonation history failed', 500, {
      detail: error.message,
    });
  }

  return ok(
    {
      items: data ?? [],
      total: count ?? data?.length ?? 0,
      page,
      page_size: pageSize,
    },
    undefined,
    { req },
  );
}
