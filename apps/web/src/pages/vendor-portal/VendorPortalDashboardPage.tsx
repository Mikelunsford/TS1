/**
 * VendorPortalDashboardPage — landing page for vendor_user.
 *
 * Phase 22 (Wave 10 Session 4) — C2 owns this page.
 *
 * Shows: vendor name, a 4-tile summary of POs/bills/payments/statement,
 * and quick links into each section.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CreditCard, FileSpreadsheet, FileText, Receipt } from 'lucide-react';

import { vendorPortalKeys } from '@/lib/queryKeys/vendorPortal';
import {
  getPortalStatement,
  getVendorPortalMe,
  listPortalPurchaseOrders,
  listPortalVendorBills,
} from '@/lib/services/vendorPortalService';
import { formatMoney } from '@/lib/money';

export default function VendorPortalDashboardPage() {
  const me = useQuery({
    queryKey: vendorPortalKeys.me(),
    queryFn: getVendorPortalMe,
    staleTime: 60_000,
  });
  const posQ = useQuery({
    queryKey: vendorPortalKeys.poList({ limit: 5 }),
    queryFn: () => listPortalPurchaseOrders({ limit: 5 }),
  });
  const billsQ = useQuery({
    queryKey: vendorPortalKeys.billsList({ limit: 5 }),
    queryFn: () => listPortalVendorBills({ limit: 5 }),
  });
  const statementQ = useQuery({
    queryKey: vendorPortalKeys.statement(),
    queryFn: () => getPortalStatement(),
  });

  const vendorName = me.data?.vendor.name ?? '—';
  const poCount = posQ.data?.items.length ?? 0;
  const billCount = billsQ.data?.items.length ?? 0;
  const outstanding = statementQ.data?.total_outstanding_cents ?? 0;
  const currency = (billsQ.data?.items[0]?.currency_code as string | undefined) ?? 'USD';

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Welcome, {vendorName}</h1>
        <p className="text-sm text-fg-muted">Your vendor portal overview.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashTile
          to="/vendor-portal/purchase-orders"
          label="Purchase Orders"
          value={String(poCount)}
          icon={FileText}
        />
        <DashTile
          to="/vendor-portal/vendor-bills"
          label="Bills"
          value={String(billCount)}
          icon={Receipt}
        />
        <DashTile
          to="/vendor-portal/payments"
          label="Payments received"
          value="View"
          icon={CreditCard}
        />
        <DashTile
          to="/vendor-portal/statement"
          label="Outstanding"
          value={formatMoney(outstanding, { currency })}
          icon={FileSpreadsheet}
        />
      </div>
    </div>
  );
}

function DashTile({
  to,
  label,
  value,
  icon: Icon,
}: {
  to: string;
  label: string;
  value: string;
  icon: typeof FileText;
}) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-2 rounded-md border border-border bg-bg p-4 hover:bg-bg-subtle"
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-muted">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="text-xl font-semibold">{value}</div>
    </Link>
  );
}
