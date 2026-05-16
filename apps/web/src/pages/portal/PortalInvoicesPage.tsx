import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { portalKeys } from '@/lib/queryKeys/portal';
import { listPortalInvoices } from '@/lib/services/portalService';

const STATUS_OPTIONS = ['', 'pending', 'sent', 'on_hold', 'paid', 'partially_paid', 'overdue'];

export default function PortalInvoicesPage() {
  const [status, setStatus] = useState<string>('');
  const filters = useMemo(() => ({ status: status || undefined, page_size: 25 }), [status]);
  const { data, isLoading, isError } = useQuery({
    queryKey: portalKeys.invoiceList(filters),
    queryFn: () => listPortalInvoices(filters),
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-fg-muted">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s || 'all'} value={s}>
                {s ? s.replace(/_/g, ' ') : 'All'}
              </option>
            ))}
          </select>
        </label>
      </header>

      {isLoading && <p className="text-fg-muted">Loading invoices…</p>}
      {isError && <p className="text-red-600">Failed to load invoices.</p>}
      {data && data.items.length === 0 && (
        <p className="text-fg-muted">No invoices yet.</p>
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-2">Invoice #</th>
                <th className="px-3 py-2">Issued</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((rawRow) => {
                const row = rawRow as Record<string, unknown> & {
                  id: string;
                  invoice_number: string;
                  issue_date: string;
                  due_date: string | null;
                  status: string;
                  total_cents: number;
                  balance_cents: number;
                  currency_code: string;
                };
                return (
                  <tr key={row.id} className="border-t border-border hover:bg-bg-subtle">
                    <td className="px-3 py-2">
                      <Link to={`/portal/invoices/${row.id}`} className="text-[rgb(var(--brand))] hover:underline">
                        {row.invoice_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{formatDate(row.issue_date)}</td>
                    <td className="px-3 py-2">{formatDate(row.due_date)}</td>
                    <td className="px-3 py-2 capitalize">{row.status.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(row.total_cents, { currency: row.currency_code })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(row.balance_cents ?? 0, { currency: row.currency_code })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
