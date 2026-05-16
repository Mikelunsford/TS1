import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { portalKeys } from '@/lib/queryKeys/portal';
import { listPortalQuotes } from '@/lib/services/portalService';

const STATUS_OPTIONS = ['', 'sent', 'viewed', 'accepted', 'converted', 'expired'];

export default function PortalQuotesPage() {
  const [status, setStatus] = useState<string>('');
  const filters = useMemo(() => ({ status: status || undefined, page_size: 25 }), [status]);
  const { data, isLoading, isError } = useQuery({
    queryKey: portalKeys.quoteList(filters),
    queryFn: () => listPortalQuotes(filters),
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Quotes</h1>
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

      {isLoading && <p className="text-fg-muted">Loading quotes…</p>}
      {isError && <p className="text-red-600">Failed to load quotes.</p>}
      {data && data.items.length === 0 && <p className="text-fg-muted">No quotes yet.</p>}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-2">Quote #</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Valid until</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((rawRow) => {
                const row = rawRow as Record<string, unknown> & {
                  id: string;
                  quote_number: string;
                  created_at: string;
                  valid_until: string | null;
                  status: string;
                  total_cents: number;
                  currency_code: string;
                };
                return (
                  <tr key={row.id} className="border-t border-border hover:bg-bg-subtle">
                    <td className="px-3 py-2">
                      <Link to={`/portal/quotes/${row.id}`} className="text-[rgb(var(--brand))] hover:underline">
                        {row.quote_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{formatDate(row.created_at)}</td>
                    <td className="px-3 py-2">{formatDate(row.valid_until)}</td>
                    <td className="px-3 py-2 capitalize">{row.status.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(row.total_cents, { currency: row.currency_code })}
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
