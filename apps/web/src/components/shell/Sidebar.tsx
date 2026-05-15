import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  ClipboardList,
  FileText,
  Home,
  Receipt,
  Settings,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';

/**
 * Sidebar — primary module navigation.
 *
 * Modules per /03-workspace/04-GLOSSARY.md and /11-modules/00-MODULE-CATALOG.md.
 * Wave 1 only ships the home route; the rest are placeholders that route
 * to /404 until their respective waves land. This is intentional: the nav
 * surface needs to be visible from Wave 1 so the empty-state design and
 * RBAC gating can be reviewed early.
 */

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  disabled?: boolean;
  /** Wave the route lands in. Used in tooltips on disabled items. */
  wave?: number;
}

const items: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/crm', label: 'CRM', icon: Users, disabled: true, wave: 2 },
  { to: '/quotes', label: 'Quotes', icon: FileText, disabled: true, wave: 3 },
  { to: '/projects', label: 'Projects', icon: ClipboardList, disabled: true, wave: 3 },
  { to: '/invoices', label: 'Invoices', icon: Receipt, disabled: true, wave: 3 },
  { to: '/inventory', label: 'Inventory', icon: Boxes, disabled: true, wave: 4 },
  { to: '/procurement', label: 'Procurement', icon: Truck, disabled: true, wave: 4 },
  { to: '/finance', label: 'Finance', icon: Wallet, disabled: true, wave: 6 },
  { to: '/reports', label: 'Reports', icon: BarChart3, disabled: true, wave: 6 },
  { to: '/settings', label: 'Settings', icon: Settings, disabled: true, wave: 1 },
];

export function Sidebar() {
  return (
    <nav
      className="flex w-56 flex-col gap-1 border-r border-border bg-bg-muted px-3 py-4"
      aria-label="Primary"
    >
      {items.map((item) => {
        const Icon = item.icon;
        if (item.disabled) {
          return (
            <span
              key={item.to}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-fg-subtle"
              title={item.wave ? `Wave ${item.wave}` : 'Coming soon'}
              aria-disabled
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </span>
          );
        }
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              [
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm',
                isActive
                  ? 'bg-bg text-fg ring-1 ring-border-strong'
                  : 'text-fg-muted hover:bg-bg hover:text-fg',
              ].join(' ')
            }
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
