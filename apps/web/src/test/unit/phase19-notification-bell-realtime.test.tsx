/**
 * Phase 19 (Wave 10 Session 3) — R-W10-S2-B1-OBS-04 close-out.
 *
 * Asserts that <NotificationBell> subscribes to a Supabase realtime
 * channel on mount and that an INSERT event invalidates the
 * notifications query.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/collaborationService', () => ({
  listNotifications: vi.fn().mockResolvedValue({ items: [], unread_count: 0 }),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock('@/lib/hooks/useOrgFlags', () => ({
  useOrgFlags: vi.fn(),
}));

// vi.mock is hoisted ABOVE imports — declare mocks via vi.hoisted so the
// factory can see them at hoist time.
const mocks = vi.hoisted(() => {
  const subscribeMock = vi.fn();
  const onMock = vi.fn();
  const channelMock = vi.fn();
  const removeChannelMock = vi.fn();
  const getUserMock = vi.fn();
  return { subscribeMock, onMock, channelMock, removeChannelMock, getUserMock };
});
const { subscribeMock, onMock, channelMock, getUserMock } = mocks;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: mocks.getUserMock,
    },
    channel: mocks.channelMock,
    removeChannel: mocks.removeChannelMock,
  },
}));

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { NotificationBell } from '@/components/collaboration/NotificationBell';

function withProviders(ui: ReactNode): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('<NotificationBell> realtime upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-uuid-123' } } });
    onMock.mockImplementation(() => ({ on: onMock, subscribe: subscribeMock }));
    channelMock.mockImplementation(() => ({ on: onMock, subscribe: subscribeMock }));
    subscribeMock.mockImplementation((cb?: (status: string) => void) => {
      if (cb) cb('SUBSCRIBED');
      return { unsubscribe: vi.fn() };
    });
  });

  it('opens a Supabase channel scoped to recipient_user_id', async () => {
    vi.mocked(useOrgFlags).mockReturnValue({ data: { 'collaboration.enabled': true } } as unknown as ReturnType<typeof useOrgFlags>);

    render(withProviders(<NotificationBell />));
    await waitFor(() => expect(channelMock).toHaveBeenCalledWith('notifications:user-user-uuid-123'));
    // INSERT + UPDATE handlers wired.
    expect(onMock).toHaveBeenCalled();
    const insertCall = onMock.mock.calls.find((c) => {
      const opts = c[1] as { event?: string };
      return opts?.event === 'INSERT';
    });
    expect(insertCall).toBeDefined();
    const insertOpts = insertCall![1] as { filter?: string };
    expect(insertOpts.filter).toBe('recipient_user_id=eq.user-uuid-123');
  });

  it('does not subscribe when the collaboration flag is off', () => {
    vi.mocked(useOrgFlags).mockReturnValue({ data: { 'collaboration.enabled': false } } as unknown as ReturnType<typeof useOrgFlags>);
    render(withProviders(<NotificationBell />));
    expect(channelMock).not.toHaveBeenCalled();
  });
});
