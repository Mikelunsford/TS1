/**
 * SettingsLayout — Phase 15 hub. Left rail with the 6 settings groups + the
 * Wave 3 reference-data pages. Right pane renders the active sub-page via
 * <Outlet />.
 */
import { NavLink, Outlet } from 'react-router-dom';

import { cn } from '@/lib/format';

interface RailItem {
  to: string;
  label: string;
}

const PHASE15_GROUPS: RailItem[] = [
  { to: '/settings/company', label: 'Company' },
  { to: '/settings/invoicing', label: 'Invoicing' },
  { to: '/settings/quoting', label: 'Quoting' },
  { to: '/settings/finance', label: 'Finance' },
  { to: '/settings/branding', label: 'Branding' },
  { to: '/settings/clients', label: 'Clients' },
  { to: '/settings/numbering', label: 'Numbering' },
];

const REFERENCE_DATA: RailItem[] = [
  { to: '/settings/currencies', label: 'Currencies' },
  { to: '/settings/taxes', label: 'Taxes' },
  { to: '/settings/payment-methods', label: 'Payment methods' },
  { to: '/settings/exchange-rates', label: 'Exchange rates' },
];

export default function SettingsLayout() {
  return (
    <div className="mx-auto flex max-w-6xl gap-6 px-6 py-8">
      <aside className="w-56 shrink-0">
        <h2 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Workspace
        </h2>
        <nav aria-label="Settings groups" className="flex flex-col gap-0.5">
          {PHASE15_GROUPS.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 text-sm',
                  isActive
                    ? 'bg-bg-muted text-fg ring-1 ring-border-strong'
                    : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
                )
              }
            >
              {it.label}
            </NavLink>
          ))}
        </nav>
        <h2 className="px-2 pb-2 pt-6 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Reference data
        </h2>
        <nav aria-label="Reference data" className="flex flex-col gap-0.5">
          {REFERENCE_DATA.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 text-sm',
                  isActive
                    ? 'bg-bg-muted text-fg ring-1 ring-border-strong'
                    : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
                )
              }
            >
              {it.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
