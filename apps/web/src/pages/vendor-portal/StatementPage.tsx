/**
 * StatementPage — vendor AP aging snapshot (Phase 22).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { vendorPortalKeys } from '@/lib/queryKeys/vendorPortal';
import { getPortalStatement } from '@/lib/services/vendorPortalService';
import { formatMoney } from '@/lib/money';

const TODAY = new Date().toISOString().slice(0, 10);

export default function StatementPage() {
  const [asOf, setAsOf] = useState<string>(TODAY);
  const q = useQuery({
    queryKey: vendorPortalKeys.statement(asOf),
    queryFn: () => getPortalStatement(asOf),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Statement</h1>
          <p className="text-sm text-fg-muted">Outstanding AP aging snapshot.</p>
        </div>
        <label className="flex flex-col text-xs uppercase tracking-wide text-fg-muted">
          As of
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="mt-1 rounded-md border border-border bg-bg px-2 py-1 text-sm normal-case text-fg"
          />
        </label>
      </header>
      {q.isLoading && <p className="text-fg-muted">Loading…</p>}
      {q.isError && <p className="text-red-600">Failed to load statement.</p>}
      {q.data && (
        <>
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Bucket label="Current" cents={q.data.buckets.current} />
            <Bucket label="1–30 days" cents={q.data.buckets.d30} />
            <Bucket label="31–60 days" cents={q.data.buckets.d60} />
            <Bucket label="61–90 days" cents={q.data.buckets.d90} />
            <Bucket label="90+ days" cents={q.data.buckets.d90plus} />
          </section>
          <section className="rounded-md border border-border bg-bg p-4 text-sm">
            <p className="font-semibold">
              Total outstanding:{' '}
              {formatMoney(q.data.total_outstanding_cents, { currency: 'USD' })}
            </p>
            <p className="text-fg-muted">
              {q.data.open_bills.length} open bill(s).
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Bucket({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold">
        {formatMoney(cents, { currency: 'USD' })}
      </div>
    </div>
  );
}
