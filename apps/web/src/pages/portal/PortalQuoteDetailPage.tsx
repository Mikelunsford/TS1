import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';

import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { portalKeys } from '@/lib/queryKeys/portal';
import { getPortalQuote } from '@/lib/services/portalService';

export default function PortalQuoteDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: portalKeys.quote(id),
    queryFn: () => getPortalQuote(id),
    enabled: Boolean(id),
  });

  if (isLoading) return <p className="p-6 text-fg-muted">Loading quote…</p>;
  if (isError || !data) return <p className="p-6 text-red-600">Failed to load quote.</p>;

  const q = data.quote as Record<string, unknown> & {
    quote_number: string;
    status: string;
    created_at: string;
    valid_until: string | null;
    currency_code: string;
    customer_name: string;
    subtotal_cents: number;
    discount_cents: number;
    tax_cents: number;
    total_cents: number;
    notes: string | null;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <Link to="/portal/quotes" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:underline">
        <ArrowLeft className="h-4 w-4" />
        Back to quotes
      </Link>

      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Quote {q.quote_number}</h1>
          <p className="text-fg-muted capitalize">{q.status.replace(/_/g, ' ')}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {data.pdf_url && (
            <a
              href={data.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg-subtle"
            >
              <Download className="h-4 w-4" /> Download PDF
            </a>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled
              title="Accept is coming soon."
              className="cursor-not-allowed rounded-md bg-bg-subtle px-3 py-1.5 text-sm text-fg-muted"
            >
              Accept (coming soon)
            </button>
            <button
              type="button"
              disabled
              title="Reject is coming soon."
              className="cursor-not-allowed rounded-md bg-bg-subtle px-3 py-1.5 text-sm text-fg-muted"
            >
              Reject (coming soon)
            </button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Field label="Created" value={formatDate(q.created_at)} />
        <Field label="Valid until" value={formatDate(q.valid_until)} />
        <Field label="Customer" value={q.customer_name} />
        <Field label="Currency" value={q.currency_code} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-fg-subtle">Line items</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit price</th>
                <th className="px-3 py-2 text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-fg-muted">
                    No line items.
                  </td>
                </tr>
              )}
              {data.lines.map((rawLine) => {
                const line = rawLine as Record<string, unknown> & {
                  id: string;
                  description: string;
                  quantity: number | string;
                  unit_price_cents: number;
                  line_total_cents: number;
                };
                return (
                  <tr key={line.id} className="border-t border-border">
                    <td className="px-3 py-2">{line.description}</td>
                    <td className="px-3 py-2 text-right">{String(line.quantity)}</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(line.unit_price_cents, { currency: q.currency_code })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(line.line_total_cents, { currency: q.currency_code })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <Summary label="Subtotal" value={formatMoney(q.subtotal_cents, { currency: q.currency_code })} />
        {q.discount_cents > 0 && (
          <Summary label="Discount" value={`- ${formatMoney(q.discount_cents, { currency: q.currency_code })}`} />
        )}
        <Summary label="Tax" value={formatMoney(q.tax_cents, { currency: q.currency_code })} />
        <Summary label="Total" value={formatMoney(q.total_cents, { currency: q.currency_code })} bold />
      </section>

      {q.notes && (
        <section className="rounded-md bg-bg-subtle p-4">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">Notes</h3>
          <p className="whitespace-pre-wrap text-sm">{q.notes}</p>
        </section>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="font-medium">{value || '—'}</p>
    </div>
  );
}

function Summary({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
