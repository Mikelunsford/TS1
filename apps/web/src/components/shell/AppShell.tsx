import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { useOrgClaimSync } from '@/lib/hooks/useOrgClaimSync';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * Authenticated app chrome. Lays out Topbar across the top, Sidebar on the
 * left, and the route content in the main area. Public routes (/login,
 * /auth/callback) wrap their content directly in <main> and do not use
 * AppShell.
 *
 * UI-AUDIT PR A (2026-05-18): below the `md:` breakpoint Sidebar collapses
 * into a slide-in drawer controlled here. Topbar exposes a hamburger that
 * sets `mobileNavOpen=true`; the Sidebar's overlay + close button + any
 * NavLink click clear it again. A pathname-change effect also closes the
 * drawer defensively, covering programmatic navigation and browser
 * back/forward where NavLink onClick wouldn't fire.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // R-W11-AUTH-01: auto-stamp team1_org_id claim on first sign-in when
  // active_org_id is synthesized from sole-membership but the JWT carries
  // no claim. One-shot per (user, org) per session mount.
  useOrgClaimSync();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname } = useLocation();

  // Defensive close on any pathname change (covers redirects + back/forward
  // where NavLink's onClick doesn't fire).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <Topbar onMenuClick={() => setMobileNavOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
