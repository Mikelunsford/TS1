import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { portalKeys } from '@/lib/queryKeys/portal';
import { getPortalStatement } from '@/lib/services/portalService';

export default function PortalStatementPage() {
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const { data, isLoading, isError } = useQuery({
    queryKey: portalKeys.statement(asOf, null),
    queryFn: () => getPortalStatement({ as_of: asOf }),
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Statement</h1>
          <p className="text-fg-muted">Open AR aging snapshot.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-fg-muted">As of</span>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
          />
        </label>
      </header>

      {isLoading && <p className="text-fg-muted">Loading statement…</p>}
      {isError && <p className="text-red-600">Failed to load statement.</p>}

      {data && (
        <section>
          <p className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">
            As of {formatDate(data.as_of)} · {data.currency_code}
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-3 py-2">Bucket</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <Row label="Current" cents={data.aging.current_cents} currency={data.currency_code} />
                <Row label="1 – 30 days" cents={data.aging.days_1_30_cents} currency={data.currency_code} />
                <Row label="31 – 60 days" cents={data.aging.days_31_60_cents} currency={data.currency_code} />
                <Row label="61 – 90 days" cents={data.aging.days_61_90_cents} currency={data.currency_code} />
                <Row label="Over 90 days" cents={data.aging.days_over_90_cents} currency={data.currency_code} />
                <tr className="border-t border-border bg-bg-subtle font-semibold">
                  <td className="px-3 py-2">Total outstanding</td>
                  <td className="px-3 py-2 text-right">
                    {formatMoney(data.aging.total_cents, { currency: data.currency_code })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, cents, currency }: { label: string; cents: number; currency: string }) {
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2">{label}</td>
      <td className="px-3 py-2 text-right">{formatMoney(cents, { currency })}</td>
    </tr>
  );
}
