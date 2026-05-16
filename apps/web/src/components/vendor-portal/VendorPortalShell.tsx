/**
 * VendorPortalShell — minimal portal chrome for vendor_user.
 *
 * Phase 22 (Wave 10 Session 4) — C2 owns this component.
 *
 * Composition:
 *   - top bar: logo + app name (from useBranding) + sign-out
 *   - nav rail: home / POs / bills / payments / statement
 *   - main: route content
 *
 * Deliberately omits the staff Topbar's workspace switcher,
 * NotificationBell, and GlobalSearchBar — vendor_user is single-tenant
 * by design.
 */

import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { CreditCard, FileSpreadsheet, FileText, Home, LogOut, Receipt } from 'lucide-react';

import { useAuth } from '@/auth/AuthContext';
import { useBranding } from '@/lib/hooks/useBranding';
import { cn } from '@/lib/format';

const NAV_ITEMS = [
  { to: '/vendor-portal', label: 'Home', icon: Home, exact: true },
  { to: '/vendor-portal/purchase-orders', label: 'Purchase Orders', icon: FileText, exact: false },
  { to: '/vendor-portal/vendor-bills', label: 'Bills', icon: Receipt, exact: false },
  { to: '/vendor-portal/payments', label: 'Payments', icon: CreditCard, exact: false },
  { to: '/vendor-portal/statement', label: 'Statement', icon: FileSpreadsheet, exact: false },
];

export function VendorPortalShell({ children }: { children: ReactNode }) {
  const { state, signOut } = useAuth();
  const branding = useBranding({ enabled: state.status === 'authenticated' });
  const appName = branding.data?.app_name_override ?? 'Vendor Portal';

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <header className="flex h-14 items-center justify-between border-b border-border bg-bg px-4">
        <div className="flex items-center gap-2 font-semibold">
          <span
            className="inline-block h-6 w-6 rounded"
            style={{ backgroundColor: 'rgb(var(--brand))' }}
            aria-hidden
          />
          <span>{appName}</span>
          <span className="ml-2 rounded bg-bg-subtle px-2 py-0.5 text-xs uppercase tracking-wide text-fg-muted">
            Vendor Portal
          </span>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex items-center gap-2 rounded-md p-1 px-2 text-sm hover:bg-bg-subtle"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <nav
          className="flex w-56 flex-col gap-1 border-r border-border bg-bg p-2"
          aria-label="Vendor portal navigation"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                    isActive ? 'bg-bg-subtle font-medium text-fg' : 'text-fg-muted hover:bg-bg-subtle',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
