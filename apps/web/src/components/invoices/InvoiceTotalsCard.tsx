/**
 * Six-number totals card for an invoice header:
 * subtotal / discount / tax / total / paid / balance. Every number renders
 * via `MoneyDisplay` (formatMoney under the hood) — the constitution
 * forbids `n.toFixed(2)` in components.
 */
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';

export interface InvoiceTotalsCardProps {
  currency: string;
  subtotal_cents: number | string | bigint;
  discount_cents: number | string | bigint;
  tax_cents: number | string | bigint;
  total_cents: number | string | bigint;
  paid_cents: number | string | bigint;
  balance_cents: number | string | bigint | null;
}

export function InvoiceTotalsCard(props: InvoiceTotalsCardProps) {
  const { currency } = props;
  return (
    <dl
      className="grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-6"
      data-testid="invoice-totals-card"
    >
      <Total label="Subtotal" cents={props.subtotal_cents} currency={currency} />
      <Total label="Discount" cents={props.discount_cents} currency={currency} />
      <Total label="Tax" cents={props.tax_cents} currency={currency} />
      <Total label="Total" cents={props.total_cents} currency={currency} emphasized />
      <Total label="Paid" cents={props.paid_cents} currency={currency} />
      <Total label="Balance" cents={props.balance_cents} currency={currency} emphasized />
    </dl>
  );
}

function Total({
  label,
  cents,
  currency,
  emphasized,
}: {
  label: string;
  cents: number | string | bigint | null;
  currency: string;
  emphasized?: boolean;
}) {
  return (
    <div data-testid={`totals-${label.toLowerCase()}`}>
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd
        className={
          emphasized
            ? 'text-lg font-semibold font-mono text-fg'
            : 'text-sm font-mono text-fg'
        }
      >
        <MoneyDisplay cents={cents} currency={currency} />
      </dd>
    </div>
  );
}
