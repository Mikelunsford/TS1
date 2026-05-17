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
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react';

import { cn } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';

/**
 * Sidebar — primary module navigation.
 *
 * UI-AUDIT PR A (2026-05-18): tree re-organized so Dashboard is its own
 * top-level entry (no longer buried under Reports), a Sales group
 * collects Quotes/Projects/Invoices/Payments/Credit notes, Operations
 * is a collapse-only header (no `to:`), and Settings is gated on
 * `org.settings.read` so non-admin roles can reach reference-data
 * children. Below the `md:` breakpoint this renders as a slide-in
 * drawer driven by AppShell state; at `md:` and above it stays a
 * fixed `w-56` rail (unchanged desktop behavior).
 *
 * Category groups (those with `children`) collapse/expand on click. The
 * currently-active route auto-opens its parent category on mount and on
 * route change. Open state persists in localStorage so reloads remember
 * the user's preference.
 */

interface NavItem {
  /** Omit when the category is collapse-only (Operations). */
  to?: string;
  /** Stable key for open-state + active-parent tracking. */
  key: string;
  label: string;
  icon: typeof Home;
  disabled?: boolean;
  /** Wave the route lands in. Used in tooltips on disabled items. */
  wave?: number;
  /** Cap required to show this item. Omitted = always show. */
  requireCap?: string;
  children?: Array<{ to: string; label: string; icon: typeof Home; requireCap?: string }>;
}

const items: NavItem[] = [
  // Dashboard — promoted to top-level (UI-AUDIT PR A). Previously buried
  // as a child of Reports while `/` also redirected here; the old "Home"
  // entry resolved to /dashboard but highlighted a Reports child.
  { to: '/dashboard', key: '/dashboard', label: 'Dashboard', icon: Home },
  {
    key: 'crm',
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
  // Sales — new grouping (UI-AUDIT PR A). Collects the 5 previously
  // disjoint top-level commercial-doc items under one collapsible.
  {
    key: 'sales',
    label: 'Sales',
    icon: ShoppingCart,
    children: [
      { to: '/quotes', label: 'Quotes', icon: FileText, requireCap: 'quotes.read' },
      { to: '/projects', label: 'Projects', icon: ClipboardList, requireCap: 'projects.read' },
      { to: '/invoices', label: 'Invoices', icon: Receipt, requireCap: 'invoices.read' },
      { to: '/payments', label: 'Payments', icon: CreditCard, requireCap: 'payments.read' },
      {
        to: '/credit-notes',
        label: 'Credit notes',
        icon: Receipt,
        requireCap: 'credit_notes.read',
      },
    ],
  },
  // Inventory (Wave 8f / Phase 13 — FE-A owns this block)
  // Parent now collapse-only (no `to:`); previously aliased to /items
  // which duplicated the first child's route.
  {
    key: 'inventory',
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
  // Parent is a non-navigable header per UI-AUDIT PR A spec.
  // Bundle-level gate on plugins.3pl lives on the BE (ops-api). On the SPA
  // we cap-gate on receiving.read; the role policy already aligns
  // receiving/production/shipping caps with the same role surface, so
  // hiding any one of them effectively hides the section.
  {
    key: 'operations',
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
  // Parent now collapse-only (was /vendors which duplicated first child).
  {
    key: 'procurement',
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
  // Parent now collapse-only (was /expenses which duplicated first child).
  {
    key: 'expenses',
    label: 'Expenses',
    icon: Wallet,
    requireCap: 'expenses.read',
    children: [
      { to: '/expenses', label: 'All expenses', icon: Wallet },
      { to: '/expenses/my', label: 'My expenses', icon: Wallet },
    ],
  },
  // end expenses nav.
  // Accounting — renamed from "Finance" (UI-AUDIT PR A). Parent now
  // collapse-only (was /finance/accounts which duplicated first child).
  {
    key: 'accounting',
    label: 'Accounting',
    icon: BookOpen,
    requireCap: 'finance.coa.read',
    children: [
      { to: '/finance/accounts', label: 'Chart of accounts', icon: BookOpen },
      { to: '/finance/journal-entries', label: 'Journal entries', icon: Layers },
    ],
  },
  // end accounting nav.
  // Reports — Dashboard removed (now top-level). Parent collapse-only;
  // previously aliased to /reports/ar-aging which duplicated first child.
  {
    key: 'reports',
    label: 'Reports',
    icon: BarChart3,
    requireCap: 'finance.reports.read',
    children: [
      { to: '/reports/ar-aging', label: 'AR aging', icon: BarChart3 },
      { to: '/reports/sales-by-customer', label: 'Sales by customer', icon: TrendingUp },
      { to: '/reports/sales-by-item', label: 'Sales by item', icon: Boxes },
      { to: '/reports/cash-position', label: 'Cash position', icon: Wallet },
      { to: '/reports/expense-by-category', label: 'Expense by category', icon: Receipt },
    ],
  },
  // End Reports.
  // Settings (Phase 15) — UI-AUDIT PR A re-gates from `org.settings.write`
  // to `org.settings.read` so non-admin roles (sales/ops/accounting) can
  // reach reference-data children like /settings/taxes. Per-child gates
  // can filter further as they're declared.
  {
    to: '/settings',
    key: '/settings',
    label: 'Settings',
    icon: Settings,
    requireCap: 'org.settings.read',
    children: [
      { to: '/settings/company', label: 'Company', icon: Settings },
      { to: '/settings/branding', label: 'Branding', icon: Sparkles },
      { to: '/settings/invoicing', label: 'Invoicing', icon: Receipt },
      { to: '/settings/quoting', label: 'Quoting', icon: FileText },
      { to: '/settings/numbering', label: 'Numbering', icon: Layers },
      { to: '/settings/finance', label: 'Finance', icon: BookOpen },
      { to: '/settings/currencies', label: 'Currencies', icon: Wallet },
      { to: '/settings/taxes', label: 'Taxes', icon: Receipt },
      { to: '/settings/payment-methods', label: 'Payment methods', icon: CreditCard },
      { to: '/settings/exchange-rates', label: 'Exchange rates', icon: TrendingUp },
      { to: '/settings/clients', label: 'Clients', icon: Users },
    ],
  },
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
 * Return the `key` of the category whose own `to` or any child `to`
 * matches the current pathname. Null when no category contains the
 * current route (top-level routes like `/dashboard`).
 */
function findActiveParent(pathname: string): string | null {
  for (const item of items) {
    if (!item.children) continue;
    if (item.to && (pathname === item.to || pathname.startsWith(`${item.to}/`))) {
      return item.key;
    }
    for (const child of item.children) {
      if (pathname === child.to || pathname.startsWith(`${child.to}/`)) return item.key;
    }
  }
  return null;
}

export interface SidebarProps {
  /** Mobile drawer open state (controlled by AppShell). Ignored at `md:`+. */
  mobileOpen?: boolean;
  /** Called when the user clicks the drawer overlay or any nav link. */
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps = {}) {
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

  const handleNavClick = () => {
    // Close the mobile drawer when the user picks a destination. No-op
    // on desktop because AppShell never opens the drawer above `md:`.
    if (onClose) onClose();
  };

  const navContent = (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        if (item.requireCap && !can(item.requireCap)) {
          return null;
        }
        if (item.disabled) {
          return (
            <span
              key={item.key}
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
        // Filter children by their own caps; if a parent has children but
        // none survive cap-gating, hide the parent entirely.
        const visibleChildren = hasChildren
          ? item.children!.filter((c) => !c.requireCap || can(c.requireCap))
          : [];
        if (hasChildren && visibleChildren.length === 0) return null;
        const isOpen = hasChildren && openCategories.has(item.key);
        const isActiveCategory = activeParent === item.key;
        return (
          <div key={item.key} className="flex flex-col gap-0.5">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCategory(item.key)}
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
                to={item.to!}
                end={item.to === '/'}
                onClick={handleNavClick}
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
                {visibleChildren.map((child) => {
                  const ChildIcon = child.icon;
                  return (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      onClick={handleNavClick}
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
    </>
  );

  return (
    <>
      {/* Mobile overlay — only visible below `md:` when drawer is open. */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      {/* Desktop rail (md+) — fixed width, in-flow, own scrollbar so an
          expanded category (e.g. Settings with 11 children) doesn't get
          clipped by the AppShell's outer `overflow-hidden`. */}
      <nav
        className="hidden w-56 flex-col gap-1 overflow-y-auto border-r border-border bg-bg-muted px-3 py-4 md:flex"
        aria-label="Primary"
      >
        {navContent}
      </nav>

      {/* Mobile drawer (< md) — overlays content, slides in from left.
          Close button stays pinned at the top while nav content scrolls. */}
      <nav
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-bg-muted shadow-xl transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary navigation"
        aria-hidden={!mobileOpen}
      >
        <div className="flex items-center justify-end px-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-1 text-fg-muted hover:bg-bg hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4 pt-2">
          {navContent}
        </div>
      </nav>
    </>
  );
}
