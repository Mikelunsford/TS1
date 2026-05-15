import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

import { ActivityFeed } from './ActivityFeed';
import type { Activity } from '@/lib/types';

vi.mock('@/lib/services/activitiesService', () => ({
  listActivities: vi.fn(),
}));

import { listActivities } from '@/lib/services/activitiesService';

function makeActivity(overrides: Partial<Activity>): Activity {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    entity_type: 'customer',
    entity_id: '00000000-0000-0000-0000-0000000000bb',
    kind: 'note',
    subject: 'Test subject',
    body: null,
    status: 'open',
    due_at: null,
    completed_at: null,
    created_at: '2026-05-15T10:00:00.000Z',
    updated_at: '2026-05-15T10:00:00.000Z',
    ...overrides,
  };
}

function withClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe('ActivityFeed', () => {
  beforeEach(() => {
    vi.mocked(listActivities).mockReset();
  });

  it('renders activities of multiple kinds with their subjects', async () => {
    vi.mocked(listActivities).mockResolvedValueOnce({
      items: [
        makeActivity({ id: 'a-1', kind: 'call', subject: 'Discovery call', body: 'Talked Q2' }),
        makeActivity({ id: 'a-2', kind: 'meeting', subject: 'Quarterly review' }),
        makeActivity({ id: 'a-3', kind: 'email', subject: 'Sent quote v2' }),
      ],
      next_cursor: null,
    });

    render(withClient(<ActivityFeed />));

    await waitFor(() => {
      expect(screen.getByText('Discovery call')).toBeInTheDocument();
    });
    expect(screen.getByText('Quarterly review')).toBeInTheDocument();
    expect(screen.getByText('Sent quote v2')).toBeInTheDocument();
    expect(screen.getByText('Call')).toBeInTheDocument();
    expect(screen.getByText('Meeting')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Talked Q2')).toBeInTheDocument();
  });

  it('renders the empty state when there are no items', async () => {
    vi.mocked(listActivities).mockResolvedValueOnce({ items: [], next_cursor: null });

    render(withClient(<ActivityFeed entity_type="customer" entity_id="abc" />));

    await waitFor(() => {
      expect(screen.getByText('No activities yet')).toBeInTheDocument();
    });
    expect(screen.getByText(/customer/i)).toBeInTheDocument();
  });

  it('renders the error state when the service throws', async () => {
    vi.mocked(listActivities).mockRejectedValueOnce(new Error('boom'));

    render(withClient(<ActivityFeed />));

    await waitFor(() => {
      expect(screen.getByText('Could not load activities')).toBeInTheDocument();
    });
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
