/**
 * AdminShell — Phase 23 (Wave 10 Session 4).
 *
 * Minimal layout for the platform-admin console. Distinct visual treatment
 * (slate header, "PLATFORM ADMIN" badge) so admins always know they're in the
 * super-user surface, not the normal staff app.
 *
 * Gated client-side by useIsPlatformAdmin — if the caller is not a platform
 * admin we redirect to /. Server-side every admin endpoint re-checks
 * platform_admins, so this is purely a UX guard.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Building2, CheckCircle2, Clock, Plus, ShieldAlert } from 'lucide-react';

import { useIsPlatformAdmin } from '@/lib/hooks/useIsPlatformAdmin';
import { useImpersonation } from './useImpersonation';
import { EndImpersonationBanner } from './EndImpersonationBanner';

const NAV_ITEMS: ReadonlyArray<{ to: string; label: string; icon: typeof Building2 }> = [
  { to: '/admin', label: 'Dashboard', icon: ShieldAlert },
  { to: '/admin/organizations', label: 'Organizations', icon: Building2 },
  { to: '/admin/organizations/new', label: 'Provision Org', icon: Plus },
  { to: '/admin/impersonation-history', label: 'Impersonation History', icon: Clock },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, isLoading } = useIsPlatformAdmin();
  const impersonation = useImpersonation();
  // Wave 11: one-time MFA-verified banner. Reads the ?mfa=verified flag the
  // enrollment page sets and auto-dismisses after 8 seconds.
  const [searchParams, setSearchParams] = useSearchParams();
  const mfaJustVerified = searchParams.get('mfa') === 'verified';
  const [showMfaBanner, setShowMfaBanner] = useState(mfaJustVerified);
  useEffect(() => {
    if (!mfaJustVerified) return;
    const id = window.setTimeout(() => {
      setShowMfaBanner(false);
      const next = new URLSearchParams(searchParams);
      next.delete('mfa');
      setSearchParams(next, { replace: true });
    }, 8000);
    return () => window.clearTimeout(id);
  }, [mfaJustVerified, searchParams, setSearchParams]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        Verifying platform admin…
      </div>
    );
  }
  if (!data?.isPlatformAdmin) {
    return <Navigate to="/" replace />;
  }
  // ─── Wave 11 MFA gate — Sub-agent A owns this block. ───
  // Closes R-W10-P23-OBS-02. A platform admin without a verified TOTP factor
  // gets bounced to the enrollment page on any /admin/* route (except the
  // enrollment page itself, to avoid a loop). Server still enforces MFA on
  // every handler — this redirect is purely UX so admins don't hit
  // MFA_REQUIRED errors as their first sign-in experience.
  const mfaVerified = data.me?.mfa_verified === true;
  if (!mfaVerified && location.pathname !== '/admin/enroll-mfa') {
    return <Navigate to="/admin/enroll-mfa" replace />;
  }
  // ─── End Wave 11 MFA gate. ───

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {impersonation.isImpersonating && (
        <EndImpersonationBanner session={impersonation.session} />
      )}
      {showMfaBanner && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-emerald-800 bg-emerald-900/40 px-4 py-2 text-sm text-emerald-200"
          data-testid="mfa-verified-banner"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          MFA verified — you can now access platform admin tools.
        </div>
      )}
      <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900 px-4">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-400" />
          <span className="font-semibold tracking-wide">Platform Admin Console</span>
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold uppercase text-amber-300">
            Super User
          </span>
        </div>
        <Link
          to="/"
          className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
        >
          Exit to staff app
        </Link>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-56 flex-col gap-1 border-r border-slate-800 bg-slate-900 p-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <main className="flex-1 overflow-y-auto bg-slate-950 p-6">{children}</main>
      </div>
    </div>
  );
}
