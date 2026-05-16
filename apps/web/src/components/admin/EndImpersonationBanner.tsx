/**
 * EndImpersonationBanner — Phase 23 (Wave 10 Session 4).
 *
 * SECURITY-UX: rendered as a sticky top banner whenever an impersonation
 * session is active. Visually distinct (red background, white text, alert
 * icon) so the admin never forgets they're not viewing as themselves.
 *
 * Clicking "Stop impersonating":
 *   1. Calls POST /admin/impersonate/end which UPDATEs the session row and
 *      clears the impersonated user's app_metadata claims.
 *   2. Clears the local sessionStorage flag.
 *   3. Signs out the impersonated session via supabase.auth.signOut so the
 *      next page load returns the admin to their normal sign-in flow.
 *
 * Token revocation note: we cannot revoke an already-issued JWT mid-flight.
 * The JWT is short-lived (default 1h) and the SPA tears down the session
 * immediately. Documented TODO: shorten impersonation JWT to 15 minutes via
 * a custom claim policy in a follow-up.
 */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { endImpersonation } from '@/lib/services/adminConsoleService';
import { useImpersonation, type ImpersonationSession } from './useImpersonation';

export function EndImpersonationBanner({ session }: { session: ImpersonationSession | null }) {
  const impersonation = useImpersonation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b-4 border-red-700 bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
      data-testid="end-impersonation-banner"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <span className="font-semibold uppercase tracking-wide">
          IMPERSONATING {session.impersonatedEmail ?? session.impersonatedUserId}
        </span>
        <span className="opacity-80">
          (org {session.orgId.slice(0, 8)}… — every action is logged)
        </span>
      </div>
      <div className="flex items-center gap-2">
        {error && <span className="text-xs">{error}</span>}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await endImpersonation(session.sessionId);
              impersonation.clear();
              await supabase.auth.signOut();
              window.location.href = '/login';
            } catch (e) {
              setError(e instanceof Error ? e.message : 'failed');
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-md bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"
        >
          {busy ? 'Ending…' : 'Stop impersonating'}
        </button>
      </div>
    </div>
  );
}
