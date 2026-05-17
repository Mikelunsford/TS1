import { useEffect, useRef } from 'react';

import { useAuth } from '@/auth/AuthContext';

import { useMe } from './useMe';
import { useSwitchOrg } from './useSwitchOrg';

/**
 * Closes the first-sign-in JWT claim gap (R-W11-AUTH-01).
 *
 * `/auth-api/me` synthesizes `active_org_id` from the caller's sole
 * membership when the JWT carries no `team1_org_id` claim, but no edge
 * function on the staff side reads from that synthesized field — they all
 * pull the claim straight off the JWT via `_shared/tenant.ts`. Result:
 * the topbar shows the org as active while every other staff request
 * 401s with "No active organization claim."
 *
 * This effect detects the mismatch on AppShell mount and calls
 * switch-org once per (user, target_org) to stamp the claim. The
 * mutation's onSuccess refreshes the session and invalidates queries,
 * which surfaces the new JWT to subsequent requests.
 *
 * Why: see feedback memory `feedback_ts1_first_signin_org_claim.md`.
 */
export function useOrgClaimSync(): void {
  const { state } = useAuth();
  const me = useMe({ enabled: state.status === 'authenticated' });
  const switchOrg = useSwitchOrg();

  const attempted = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (state.status !== 'authenticated') return;
    if (!me.data) return;
    if (me.data.active_org_id === null) return;
    if (switchOrg.isPending) return;

    const claim = (state.session.user.app_metadata as { team1_org_id?: string } | null)
      ?.team1_org_id;
    const target = me.data.active_org_id;
    if (claim === target) return;

    const key = `${state.session.user.id}:${target}`;
    if (attempted.current.has(key)) return;
    attempted.current.add(key);

    switchOrg.mutate(target);
  }, [state, me.data, switchOrg]);
}
