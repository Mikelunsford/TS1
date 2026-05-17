/**
 * ImpersonateButton — Phase 23 (Wave 10 Session 4).
 *
 * Rendered on member rows in AdminOrganizationDetailPage. Click:
 *   1. Prompt for a reason (required for audit trail; CHECK constraint on
 *      impersonation_sessions enforces).
 *   2. POST /admin/impersonate { user_id, org_id, reason }.
 *   3. Record session_id + impersonated user in sessionStorage.
 *   4. Exchange the returned magic-link token for a real session via
 *      supabase.auth.verifyOtp.
 *   5. Redirect to /.
 *
 * NOTE: the impersonated session has an `impersonated_by` claim on
 * app_metadata so the SPA can render <EndImpersonationBanner> on every
 * subsequent page. The banner is the source of truth for the user that
 * "we're not viewing as ourselves right now".
 */
import { useState } from 'react';

import { supabase } from '@/lib/supabase';
import { impersonate } from '@/lib/services/adminConsoleService';
import { useImpersonation } from './useImpersonation';

export interface ImpersonateButtonProps {
  orgId: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
}

export function ImpersonateButton({
  orgId,
  userId,
  userEmail,
  userDisplayName,
}: ImpersonateButtonProps) {
  const impersonation = useImpersonation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = userDisplayName ?? userEmail ?? userId.slice(0, 8);

  async function onClick() {
    const reason = window.prompt(`Reason for impersonating ${label}? (required, audited)`);
    if (!reason || !reason.trim()) {
      setError('reason is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await impersonate({ user_id: userId, org_id: orgId, reason: reason.trim() });
      // Exchange the magic-link token_hash for a real session.
      if (res.impersonated_email) {
        const { error: vErr } = await supabase.auth.verifyOtp({
          type: 'magiclink',
          token_hash: res.access_token,
          email: res.impersonated_email,
        });
        if (vErr) {
          setError(vErr.message);
          setBusy(false);
          return;
        }
      }
      // Wave 11 (R-W10-P23-OBS-01): persist expiresAt so the banner can
      // auto-end the impersonation at TTL. Fall back to startedAt + expires_in
      // for backward compat with workers still returning the pre-Wave-11
      // response shape (no `expires_at`).
      const startedAtIso = new Date().toISOString();
      const expiresAtIso =
        res.expires_at ||
        new Date(Date.now() + res.expires_in * 1000).toISOString();
      impersonation.setSession({
        sessionId: res.session_id,
        impersonatedUserId: res.impersonated_user_id,
        impersonatedEmail: res.impersonated_email ?? userEmail,
        orgId: res.org_id,
        startedAt: startedAtIso,
        expiresAt: expiresAtIso,
      });
      window.location.href = '/';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'impersonation failed');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-md border border-amber-600 bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/40 disabled:opacity-60"
        data-testid={`impersonate-${userId}`}
      >
        {busy ? 'Starting…' : 'Impersonate'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
