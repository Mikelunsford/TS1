import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ClipboardList,
  CreditCard,
  FileText,
  Home,
  LogOut,
  Receipt,
  Wallet,
} from 'lucide-react';

import { useAuth } from '@/auth/AuthContext';
import { useBranding } from '@/lib/hooks/useBranding';
import { cn } from '@/lib/format';

/**
 * Portal shell — dedicated layout for `customer_user` role.
 *
 * Deliberately minimal: logo + 6-item nav rail + sign-out. The staff
 * Topbar (workspace switcher, notification bell, global search) and
 * Sidebar (modules) are NOT mounted here — portal users see only
 * portal surface.
 *
 * Phase 21 (Wave 10 Session 4) — C1 owns this component.
 */

interface PortalNavItem {
  to: string;
  label: string;
  icon: typeof Home;
}

const PORTAL_NAV: PortalNavItem[] = [
  { to: '/portal', label: 'Dashboard', icon: Home },
  { to: '/portal/invoices', label: 'Invoices', icon: Receipt },
  { to: '/portal/quotes', label: 'Quotes', icon: FileText },
  { to: '/portal/projects', label: 'Projects', icon: ClipboardList },
  { to: '/portal/payments', label: 'Payments', icon: CreditCard },
  { to: '/portal/statement', label: 'Statement', icon: Wallet },
];

export function PortalShell({ children }: { children: ReactNode }) {
  const { state, signOut } = useAuth();
  const branding = useBranding({ enabled: state.status === 'authenticated' });
  const appName = branding.data?.app_name_override ?? 'Customer Portal';
  const userEmail = state.status === 'authenticated' ? state.user.email ?? '' : '';

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
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-fg-muted truncate max-w-xs" title={userEmail}>
            {userEmail}
          </span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm hover:bg-bg-subtle"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <nav
          aria-label="Portal navigation"
          className="w-56 shrink-0 border-r border-border bg-bg-subtle"
        >
          <ul className="flex flex-col py-2">
            {PORTAL_NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/portal'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg',
                      isActive && 'border-l-2 border-l-[rgb(var(--brand))] bg-bg font-medium',
                    )
                  }
                >
                  <item.icon className="h-4 w-4 text-fg-muted" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
