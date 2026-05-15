import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MoneyDisplay } from './MoneyDisplay';

describe('MoneyDisplay', () => {
  it('formats USD cents with the dollar sign and two decimals', () => {
    render(<MoneyDisplay cents={123456} currency="USD" locale="en-US" />);
    // Intl renders "$1,234.56" — match on the digits to be NBSP-robust.
    expect(screen.getByText(/1,234\.56/)).toBeInTheDocument();
    expect(screen.getByText(/\$/)).toBeInTheDocument();
  });

  it('formats EUR cents with two decimals in the German locale', () => {
    render(<MoneyDisplay cents={500} currency="EUR" locale="de-DE" />);
    // de-DE renders "5,00 €"; we just check for the comma-decimal and the symbol.
    expect(screen.getByText(/5,00/)).toBeInTheDocument();
    expect(screen.getByText(/€/)).toBeInTheDocument();
  });

  it('renders an em-dash for null cents', () => {
    render(<MoneyDisplay cents={null} currency="USD" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
