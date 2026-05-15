import { NavLink } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Boxes,
  Briefcase,
  ClipboardList,
  Contact,
  FileText,
  FolderTree,
  Home,
  Receipt,
  Settings,
  Sparkles,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';

import { cn } from '@/lib/format';

/**
 * Sidebar — primary module navigation.
 *
 * Modules per /03-workspace/04-GLOSSARY.md and /11-modules/00-MODULE-CATALOG.md.
 * Wave 2 lights up the CRM module with five sub-routes.
 */

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  disabled?: boolean;
  /** Wave the route lands in. Used in tooltips on disabled items. */
  wave?: number;
  children?: Array<{ to: string; label: string; icon: typeof Home }>;
}

const items: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  {
    to: '/crm',
    label: 'CRM',
    icon: Users,
    children: [
      { to: '/crm/customers', label: 'Customers', icon: Users },
      { to: '/crm/contacts', label: 'Contacts', icon: Contact },
      { to: '/crm/leads', label: 'Leads', icon: Sparkles },
      { to: '/crm/opportunities', label: 'Opportunities', icon: Briefcase },
      { to: '/crm/activities', label: 'Activities', icon: Activity },
    ],
  },
  { to: '/quotes', label: 'Quotes', icon: FileText, disabled: true, wave: 3 },
  { to: '/projects', label: 'Projects', icon: ClipboardList, disabled: true, wave: 3 },
  { to: '/invoices', label: 'Invoices', icon: Receipt, disabled: true, wave: 3 },
  {
    to: '/items',
    label: 'Inventory',
    icon: Boxes,
    children: [
      { to: '/items', label: 'Items', icon: Boxes },
      { to: '/items/categories', label: 'Categories', icon: FolderTree },
    ],
  },
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
          <div key={item.to} className="flex flex-col gap-0.5">
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm',
                  isActive
                    ? 'bg-bg text-fg ring-1 ring-border-strong'
                    : 'text-fg-muted hover:bg-bg hover:text-fg',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </NavLink>
            {item.children && (
              <div className="ml-6 flex flex-col gap-0.5 border-l border-border pl-2">
                {item.children.map((child) => {
                  const ChildIcon = child.icon;
                  return (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2 rounded-md px-2 py-1 text-xs',
                          isActive
                            ? 'bg-bg text-fg ring-1 ring-border-strong'
                            : 'text-fg-muted hover:bg-bg hover:text-fg',
                        )
                      }
                    >
                      <ChildIcon className="h-3.5 w-3.5" />
                      {child.label}
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
