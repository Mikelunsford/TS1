import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InvoiceTotalsCard } from '../InvoiceTotalsCard';

describe('InvoiceTotalsCard', () => {
  it('renders all six labelled totals via formatMoney', () => {
    render(
      <InvoiceTotalsCard
        currency="USD"
        subtotal_cents={100000}
        discount_cents={500}
        tax_cents={8750}
        total_cents={108250}
        paid_cents={5000}
        balance_cents={103250}
      />,
    );

    expect(screen.getByTestId('totals-subtotal')).toHaveTextContent('$1,000.00');
    expect(screen.getByTestId('totals-discount')).toHaveTextContent('$5.00');
    expect(screen.getByTestId('totals-tax')).toHaveTextContent('$87.50');
    expect(screen.getByTestId('totals-total')).toHaveTextContent('$1,082.50');
    expect(screen.getByTestId('totals-paid')).toHaveTextContent('$50.00');
    expect(screen.getByTestId('totals-balance')).toHaveTextContent('$1,032.50');
  });

  it('renders an em-dash for a null balance', () => {
    render(
      <InvoiceTotalsCard
        currency="USD"
        subtotal_cents={0}
        discount_cents={0}
        tax_cents={0}
        total_cents={0}
        paid_cents={0}
        balance_cents={null}
      />,
    );

    expect(screen.getByTestId('totals-balance')).toHaveTextContent('—');
  });

  it('respects currency-specific fraction digits (JPY = 0)', () => {
    render(
      <InvoiceTotalsCard
        currency="JPY"
        subtotal_cents={12345}
        discount_cents={0}
        tax_cents={0}
        total_cents={12345}
        paid_cents={0}
        balance_cents={12345}
      />,
    );

    // JPY is zero-decimal — formatMoney prints "¥12,345" (no decimals).
    const total = screen.getByTestId('totals-total').textContent ?? '';
    expect(total.includes('.')).toBe(false);
    expect(total).toMatch(/12,345/);
  });
});
