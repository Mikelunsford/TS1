import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  BookOpen,
  Boxes,
  Briefcase,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Contact,
  CreditCard,
  Factory,
  FileText,
  FolderTree,
  Home,
  Layers,
  PackageOpen,
  Receipt,
  Send,
  Settings,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';

import { cn } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';

/**
 * Sidebar — primary module navigation.
 *
 * Modules per /03-workspace/04-GLOSSARY.md and /11-modules/00-MODULE-CATALOG.md.
 * Wave 2 lights up the CRM module with five sub-routes.
 *
 * Category groups (those with `children`) collapse/expand on click. The
 * currently-active route auto-opens its parent category on mount and on
 * route change. Open state persists in localStorage so reloads remember
 * the user's preference.
 */

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  disabled?: boolean;
  /** Wave the route lands in. Used in tooltips on disabled items. */
  wave?: number;
  /** Cap required to show this item. Omitted = always show (for the rest of
   *  the modules; they will be cap-gated as their pages land). */
  requireCap?: string;
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
  { to: '/quotes', label: 'Quotes', icon: FileText, requireCap: 'quotes.read' },
  { to: '/projects', label: 'Projects', icon: ClipboardList, requireCap: 'projects.read' },
  { to: '/invoices', label: 'Invoices', icon: Receipt, requireCap: 'invoices.read' },
  // Payments + Credit Notes (Wave 5 / 5.3b) — FE-B owns this block.
  { to: '/payments', label: 'Payments', icon: CreditCard, requireCap: 'payments.read' },
  { to: '/credit-notes', label: 'Credit Notes', icon: Receipt, requireCap: 'credit_notes.read' },
  // end payments + credit notes nav.
  // Inventory (Wave 8f / Phase 13 — FE-A owns this block)
  {
    to: '/items',
    label: 'Inventory',
    icon: Boxes,
    requireCap: 'inventory.warehouses.read',
    children: [
      { to: '/items', label: 'Items', icon: Boxes },
      { to: '/items/categories', label: 'Categories', icon: FolderTree },
      { to: '/warehouses', label: 'Warehouses', icon: Warehouse },
      { to: '/stock', label: 'Stock', icon: Layers },
    ],
  },
  // end inventory nav.
  // Operations / 3PL (Wave 8f / Phase 13 — FE-A owns this block)
  // Bundle-level gate on plugins.3pl lives on the BE (ops-api). On the SPA
  // we cap-gate on receiving.read; the role policy already aligns
  // receiving/production/shipping caps with the same role surface, so
  // hiding any one of them effectively hides the section.
  {
    to: '/receiving',
    label: 'Operations',
    icon: Factory,
    requireCap: 'receiving.read',
    children: [
      { to: '/receiving', label: 'Receiving', icon: PackageOpen },
      { to: '/production', label: 'Production', icon: Factory },
      { to: '/shipments', label: 'Shipments', icon: Send },
    ],
  },
  // end operations nav.
  // Procurement (Wave 7 / Phase 10 — FE-A owns this block)
  {
    to: '/vendors',
    label: 'Procurement',
    icon: Truck,
    requireCap: 'vendors.read',
    children: [
      { to: '/vendors', label: 'Vendors', icon: Truck },
      { to: '/purchase-orders', label: 'Purchase orders', icon: ClipboardList },
      { to: '/vendor-bills', label: 'Vendor bills', icon: Receipt },
    ],
  },
  // end procurement nav.
  // Expenses (Wave 7 / Phase 11 — FE-A owns this block)
  {
    to: '/expenses',
    label: 'Expenses',
    icon: Wallet,
    requireCap: 'expenses.read',
    children: [
      { to: '/expenses', label: 'All expenses', icon: Wallet },
      { to: '/expenses/my', label: 'My expenses', icon: Wallet },
    ],
  },
  // end expenses nav.
  // Finance / GL (Wave 8c / Phase 12 — FE-A owns this block)
  {
    to: '/finance/accounts',
    label: 'Finance',
    icon: BookOpen,
    requireCap: 'finance.coa.read',
    children: [
      { to: '/finance/accounts', label: 'Chart of accounts', icon: BookOpen },
      { to: '/finance/journal-entries', label: 'Journal entries', icon: Layers },
    ],
  },
  // end finance / GL nav.
  // Reports polish (Wave 10) — A1 owns this block.
  {
    to: '/reports/ar-aging',
    label: 'Reports',
    icon: BarChart3,
    requireCap: 'finance.reports.read',
    children: [
      { to: '/dashboard', label: 'Dashboard', icon: Home },
      { to: '/reports/ar-aging', label: 'AR aging', icon: BarChart3 },
      { to: '/reports/sales-by-customer', label: 'Sales by customer', icon: TrendingUp },
      { to: '/reports/sales-by-item', label: 'Sales by item', icon: Boxes },
      { to: '/reports/cash-position', label: 'Cash position', icon: Wallet },
      { to: '/reports/expense-by-category', label: 'Expense by category', icon: Receipt },
    ],
  },
  // End Reports polish (Wave 10).
  // Settings (Phase 15) — cap-gated to org_admin+. Phase15-FE block start.
  {
    to: '/settings',
    label: 'Settings',
    icon: Settings,
    requireCap: 'org.settings.write',
    children: [
      { to: '/settings/company', label: 'Company', icon: Settings },
      { to: '/settings/invoicing', label: 'Invoicing', icon: Receipt },
      { to: '/settings/quoting', label: 'Quoting', icon: FileText },
      { to: '/settings/finance', label: 'Finance', icon: BookOpen },
      { to: '/settings/branding', label: 'Branding', icon: Sparkles },
      { to: '/settings/clients', label: 'Clients', icon: Users },
      { to: '/settings/numbering', label: 'Numbering', icon: Layers },
      { to: '/settings/currencies', label: 'Currencies', icon: Wallet },
      { to: '/settings/taxes', label: 'Taxes', icon: Receipt },
      { to: '/settings/payment-methods', label: 'Payment methods', icon: CreditCard },
      { to: '/settings/exchange-rates', label: 'Exchange rates', icon: TrendingUp },
    ],
  },
  // /Phase15-FE block.
];

const STORAGE_KEY = 'ts1.sidebar.openCategories.v1';

function readPersistedOpen(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function writePersistedOpen(open: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...open]));
  } catch {
    // localStorage may be unavailable (private mode / quota); fail silent.
  }
}

/**
 * Return the parent `to` of the category whose own `to` or any child `to`
 * matches the current pathname. Null when no category contains the current
 * route (top-level routes like `/quotes`).
 */
function findActiveParent(pathname: string): string | null {
  for (const item of items) {
    if (!item.children) continue;
    if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return item.to;
    for (const child of item.children) {
      if (pathname === child.to || pathname.startsWith(`${child.to}/`)) return item.to;
    }
  }
  return null;
}

export function Sidebar() {
  const { can } = useCapabilities();
  const { pathname } = useLocation();
  const activeParent = useMemo(() => findActiveParent(pathname), [pathname]);

  const [openCategories, setOpenCategories] = useState<Set<string>>(() => {
    const persisted = readPersistedOpen();
    const initial =
      typeof window !== 'undefined' ? findActiveParent(window.location.pathname) : null;
    if (initial) persisted.add(initial);
    return persisted;
  });

  // Auto-open the active parent on route change without collapsing others.
  useEffect(() => {
    if (!activeParent) return;
    setOpenCategories((prev) => {
      if (prev.has(activeParent)) return prev;
      const next = new Set(prev);
      next.add(activeParent);
      writePersistedOpen(next);
      return next;
    });
  }, [activeParent]);

  const toggleCategory = (key: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      writePersistedOpen(next);
      return next;
    });
  };

  return (
    <nav
      className="flex w-56 flex-col gap-1 border-r border-border bg-bg-muted px-3 py-4"
      aria-label="Primary"
    >
      {items.map((item) => {
        const Icon = item.icon;
        if (item.requireCap && !can(item.requireCap)) {
          return null;
        }
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
        const hasChildren = !!item.children?.length;
        const isOpen = hasChildren && openCategories.has(item.to);
        const isActiveCategory = activeParent === item.to;
        return (
          <div key={item.to} className="flex flex-col gap-0.5">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCategory(item.to)}
                aria-expanded={isOpen}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm',
                  isActiveCategory
                    ? 'bg-bg text-fg ring-1 ring-border-strong'
                    : 'text-fg-muted hover:bg-bg hover:text-fg',
                )}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
              </button>
            ) : (
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
            )}
            {hasChildren && isOpen && (
              <div className="ml-6 flex flex-col gap-0.5 border-l border-border pl-2">
                {item.children!.map((child) => {
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
