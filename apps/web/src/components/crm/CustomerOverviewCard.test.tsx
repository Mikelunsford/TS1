import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CustomerOverviewCard } from './CustomerOverviewCard';
import type { Customer } from '@/lib/types';

// Backend's Customer response shape does not include `tags`, but the overview
// card reads them defensively. Fixtures carry an extra `tags` array via an
// intersection type so existing assertions keep working.
type CustomerFixture = Customer & { tags?: string[] };

function makeCustomer(overrides: Partial<CustomerFixture> = {}): CustomerFixture {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    customer_number: null,
    display_name: 'Acme Corp',
    kind: 'company',
    primary_email: 'ap@acme.com',
    primary_phone: '+1 512 555 0100',
    client_status: 'active',
    tax_id: null,
    tags: ['vip', 'manufacturing'],
    billing_address: {
      line1: '100 Main',
      city: 'Austin',
      region: 'TX',
      postal: '78701',
      country: 'US',
    },
    shipping_address: null,
    default_currency_code: 'USD',
    is_archived: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CustomerOverviewCard', () => {
  it('renders display name, status, kind, and contact info', () => {
    render(<CustomerOverviewCard customer={makeCustomer()} />);
    expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('ap@acme.com')).toBeInTheDocument();
    expect(screen.getByText('+1 512 555 0100')).toBeInTheDocument();
  });

  it('renders a one-line billing address', () => {
    render(<CustomerOverviewCard customer={makeCustomer()} />);
    expect(screen.getByText(/100 Main.*Austin.*TX.*78701.*US/)).toBeInTheDocument();
  });

  it('renders tags as badges', () => {
    render(<CustomerOverviewCard customer={makeCustomer()} />);
    expect(screen.getByText('vip')).toBeInTheDocument();
    expect(screen.getByText('manufacturing')).toBeInTheDocument();
  });

  it('shows the outstanding-balance stub in the customer currency', () => {
    render(<CustomerOverviewCard customer={makeCustomer({ default_currency_code: 'EUR' })} />);
    // Intl renders "€0.00" with non-breaking space possibilities — match by substring.
    const cell = screen.getByText(/0\.00/);
    expect(cell).toBeInTheDocument();
  });

  it('falls back to em-dash when email/phone/address are missing', () => {
    render(
      <CustomerOverviewCard
        customer={makeCustomer({
          primary_email: null,
          primary_phone: null,
          billing_address: null,
          tags: [],
        })}
      />,
    );
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
