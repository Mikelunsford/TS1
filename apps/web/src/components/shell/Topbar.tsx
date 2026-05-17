import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LogOut, Menu, RefreshCw, ShieldAlert, UserCircle2 } from 'lucide-react';

import { useAuth } from '@/auth/AuthContext';
import { useBranding } from '@/lib/hooks/useBranding';
import { useMe } from '@/lib/hooks/useMe';
import { useSwitchOrg } from '@/lib/hooks/useSwitchOrg';
// Phase 16 (Wave 10 Session 2) — B1 owns this block.
import { NotificationBell } from '@/components/collaboration/NotificationBell';
// End Phase 16 (Wave 10 Session 2).
// Phase 17 GlobalSearchBar (Wave 10 Session 2) — B2 owns this block.
import { GlobalSearchBar } from './GlobalSearchBar';
// End Phase 17 GlobalSearchBar
// Phase 23 platform-admin nav rail (Wave 10 Session 4) — C3 owns this block.
import { useIsPlatformAdmin } from '@/lib/hooks/useIsPlatformAdmin';
// End Phase 23 platform-admin nav rail (Wave 10 Session 4).

/**
 * Topbar — the app's persistent top chrome.
 *
 *   [ app name ]                       [ workspace switcher ] [ profile ▾ ]
 *
 * Workspace switcher: lists the caller's active memberships. The currently
 * active org (from the JWT claim) is marked. Selecting another org fires
 * `useSwitchOrg`, refreshes the session, and invalidates all queries.
 *
 * Profile menu: email + sign-out.
 *
 * Per TS1/03-workspace/03-COMMUNICATION-PROTOCOL.md sidebar / topbar
 * placement and TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §2.2 for the
 * switch-org flow.
 */
export interface TopbarProps {
  /** Called when the mobile hamburger is tapped (< md breakpoint).
   *  AppShell uses this to open the Sidebar drawer. Omitted on desktop. */
  onMenuClick?: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps = {}) {
  const { state, signOut } = useAuth();
  const me = useMe({ enabled: state.status === 'authenticated' });
  const branding = useBranding({ enabled: state.status === 'authenticated' });
  const switchOrg = useSwitchOrg();
  // Phase 23 platform-admin nav rail (Wave 10 Session 4) — C3 owns this block.
  const platformAdmin = useIsPlatformAdmin({ enabled: state.status === 'authenticated' });
  // End Phase 23 platform-admin nav rail (Wave 10 Session 4).

  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const memberships = me.data?.memberships ?? [];
  const activeOrgId = me.data?.active_org_id;
  const activeOrg =
    memberships.find((m) => m.org_id === activeOrgId) ?? memberships[0];
  // R-W11-BRANDING-01: fall through branding → active org's display_name →
  // neutral product label. Never default to "Team1" — KitStak (and any
  // newly-provisioned org) was showing Team1's name in its own topbar
  // because the only fallback was hardcoded.
  const appName =
    branding.data?.app_name_override ?? activeOrg?.display_name ?? 'TS1';
  // Phase 22 (Wave 10 Session 4) — C2 owns this hide-for-vendor flag.
  // Note: vendor_user sessions are redirected to /vendor-portal by
  // ProtectedRoute, so this <Topbar> usually doesn't render for them.
  // This guard is belt-and-suspenders in case a vendor_user briefly
  // sees the staff shell during a role-flip window.
  const isVendorUser = me.data?.active_role === 'vendor_user';
  // End Phase 22 (Wave 10 Session 4).

  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b border-border bg-bg px-4">
      <div className="flex items-center gap-2 font-semibold">
        {/* UI-AUDIT PR A: hamburger appears below `md:` to open the
            Sidebar drawer. AppShell wires `onMenuClick`; if unset (e.g.
            an isolated render) the button is hidden so nothing breaks. */}
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="rounded-md p-1 text-fg-muted hover:bg-bg-subtle hover:text-fg md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <span
          className="inline-block h-6 w-6 rounded"
          style={{ backgroundColor: 'rgb(var(--brand))' }}
          aria-hidden
        />
        <span className="truncate">{appName}</span>
      </div>

      {/* Phase 17 GlobalSearchBar (Wave 10 Session 2) — B2 owns this block. */}
      {/* Phase 22 (Wave 10 Session 4) — C2 hides search for vendor_user. */}
      {/* UI-AUDIT PR A: shrink gracefully when topbar is tight on mobile
          (flex-1 + min-w-0 so flexbox lets the search bar collapse). */}
      {!isVendorUser && (
        <div className="mx-2 flex-1 min-w-0 max-w-md md:mx-4">
          <GlobalSearchBar />
        </div>
      )}
      {/* End Phase 17 GlobalSearchBar */}

      <div className="flex items-center gap-3">
        {/* Workspace switcher — Phase 22 hides for vendor_user. */}
        {!isVendorUser && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOrgMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm hover:bg-bg-subtle"
            aria-haspopup="menu"
            aria-expanded={orgMenuOpen}
            disabled={me.isLoading || memberships.length === 0}
          >
            <span className="font-medium">
              {activeOrg?.display_name ?? (me.isLoading ? 'Loading…' : 'No workspace')}
            </span>
            <ChevronDown className="h-4 w-4 text-fg-muted" />
          </button>
          {orgMenuOpen && memberships.length > 0 && (
            <ul
              role="menu"
              className="absolute right-0 mt-1 w-56 rounded-md border border-border bg-bg shadow-lg"
            >
              {memberships.map((m) => {
                const active = m.org_id === activeOrgId;
                return (
                  <li key={m.org_id}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        setOrgMenuOpen(false);
                        if (!active) {
                          switchOrg.mutate(m.org_id);
                        }
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-bg-subtle"
                    >
                      <span className="flex flex-col">
                        <span className="font-medium">{m.display_name}</span>
                        <span className="text-xs text-fg-subtle">{m.role}</span>
                      </span>
                      {active && (
                        <span className="text-xs uppercase tracking-wide text-fg-muted">
                          Active
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {switchOrg.isPending && (
            <span
              className="absolute -bottom-5 right-0 flex items-center gap-1 text-xs text-fg-muted"
              aria-live="polite"
            >
              <RefreshCw className="h-3 w-3 animate-spin" />
              Switching workspace…
            </span>
          )}
        </div>
        )}
        {/* End workspace switcher (Phase 22 vendor_user hide). */}

        {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
        {/* Phase 22 (Wave 10 Session 4) — C2 hides NotificationBell for vendor_user. */}
        {state.status === 'authenticated' && !isVendorUser && <NotificationBell />}
        {/* End Phase 16 (Wave 10 Session 2). */}

        {/* Phase 23 platform-admin nav rail (Wave 10 Session 4) — C3 owns this block. */}
        {platformAdmin.data?.isPlatformAdmin && (
          <Link
            to="/admin"
            className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700 hover:bg-amber-500/20"
            title="Platform Admin Console"
            data-testid="topbar-admin-link"
          >
            <ShieldAlert className="h-4 w-4" />
            Admin
          </Link>
        )}
        {/* End Phase 23 platform-admin nav rail (Wave 10 Session 4). */}

        {/* Profile menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setProfileMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md p-1 hover:bg-bg-subtle"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
          >
            <UserCircle2 className="h-7 w-7 text-fg-muted" />
          </button>
          {profileMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-1 w-56 rounded-md border border-border bg-bg p-2 shadow-lg"
            >
              <div className="px-2 py-1">
                <p className="text-xs uppercase tracking-wide text-fg-subtle">
                  Signed in as
                </p>
                <p className="truncate text-sm font-medium">
                  {state.status === 'authenticated' ? state.user.email : '—'}
                </p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  void signOut();
                }}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-subtle"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
