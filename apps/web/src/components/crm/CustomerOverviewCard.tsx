import { Badge } from '@/components/ui/Badge';
import { ClientStatusBadge } from '@/components/ui/ClientStatusBadge';
import type { Customer } from '@/lib/types';
import { formatMoney } from '@/lib/money';

/**
 * Customer overview card — header for the detail page. Renders display_name,
 * status, kind, primary contact info, single-line address, tags, and the
 * outstanding-balance stub (Wave 3 invoicing fills this in).
 */
export function CustomerOverviewCard({ customer }: { customer: Customer }) {
  const addr = customer.billing_address;
  const addressLine = addr
    ? [addr.line1, addr.city, addr.region, addr.postal, addr.country].filter(Boolean).join(', ')
    : null;

  // STUB: outstanding balance is unknown until Phase 3 invoicing ships. We
  // render zero in the customer's default currency so the field is visible
  // and the formatter is exercised. Replace with a real lookup when invoicing
  // lands.
  const outstandingCents = 0;
  const currency = customer.default_currency_code ?? 'USD';
  // Backend's response Customer omits `tags`; defensively access via cast.
  const tags = (customer as { tags?: string[] }).tags ?? [];

  return (
    <section
      aria-labelledby="customer-overview-heading"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 id="customer-overview-heading" className="text-xl font-semibold">
          {customer.display_name}
        </h2>
        <ClientStatusBadge status={customer.client_status} />
        <Badge tone="neutral">{customer.kind === 'company' ? 'Company' : 'Individual'}</Badge>
      </header>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">Email</dt>
          <dd className="text-fg">
            {customer.primary_email ? (
              <a className="text-brand hover:underline" href={`mailto:${customer.primary_email}`}>
                {customer.primary_email}
              </a>
            ) : (
              <span className="text-fg-muted">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">Phone</dt>
          <dd className="text-fg">
            {customer.primary_phone ?? <span className="text-fg-muted">—</span>}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">Billing address</dt>
          <dd className="text-fg">
            {addressLine ? addressLine : <span className="text-fg-muted">—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">Outstanding balance</dt>
          <dd className="font-mono text-fg" title="Filled in Wave 3 when invoicing ships">
            {formatMoney(outstandingCents, { currency })}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-fg-subtle">Currency</dt>
          <dd className="font-mono text-fg">{currency}</dd>
        </div>
      </dl>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      )}
    </section>
  );
}
