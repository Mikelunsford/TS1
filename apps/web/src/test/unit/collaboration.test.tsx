/**
 * Unit tests for Phase 16 (Wave 10 Session 2) collaboration components.
 *
 * Mocks the collaborationService surface so each component test exercises
 * its UI behavior without touching the network. Asserts:
 *   - <CommentsTab> renders the empty state and lists comments.
 *   - <FilesTab> renders the upload dropzone and the file list.
 *   - <NotificationBell> hides when flag off; shows unread badge when on.
 *   - <MentionAutocomplete> closed by default; shows results when open.
 *   - <CollaborationSection> hides when flag off; switches tabs when on.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CollaborationServiceModule from '@/lib/services/collaborationService';

vi.mock('@/lib/services/collaborationService', async () => {
  const actual = await vi.importActual<typeof CollaborationServiceModule>(
    '@/lib/services/collaborationService',
  );
  return {
    ...actual,
    listComments: vi.fn(),
    listAttachments: vi.fn(),
    listNotifications: vi.fn(),
    autocompleteMentions: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  };
});

vi.mock('@/lib/hooks/useOrgFlags', () => ({
  useOrgFlags: vi.fn(),
}));

import {
  autocompleteMentions,
  listAttachments,
  listComments,
  listNotifications,
} from '@/lib/services/collaborationService';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
import { CommentsTab } from '@/components/collaboration/CommentsTab';
import { FilesTab } from '@/components/collaboration/FilesTab';
import { MentionAutocomplete } from '@/components/collaboration/MentionAutocomplete';
import { NotificationBell } from '@/components/collaboration/NotificationBell';

function withProviders(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const fakeFlags = (val: Record<string, boolean>) =>
  vi.mocked(useOrgFlags).mockReturnValue({
    data: val,
    isLoading: false,
  } as unknown as ReturnType<typeof useOrgFlags>);

describe('<CommentsTab>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty state when there are no comments', async () => {
    vi.mocked(listComments).mockResolvedValue({ items: [] });
    render(withProviders(<CommentsTab entityType="customer" entityId="11111111-1111-1111-1111-111111111111" />));
    expect(await screen.findByText(/no comments yet/i)).toBeInTheDocument();
  });

  it('renders a comment row when the list is non-empty', async () => {
    vi.mocked(listComments).mockResolvedValue({
      items: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          entity_type: 'customer',
          entity_id: '11111111-1111-1111-1111-111111111111',
          author_user_id: '22222222-2222-2222-2222-222222222222',
          body: 'Hello world',
          mentions: [],
          created_at: new Date().toISOString(),
          author: { display_name: 'Alice', email: null },
        },
      ],
    });
    render(withProviders(<CommentsTab entityType="customer" entityId="11111111-1111-1111-1111-111111111111" />));
    expect(await screen.findByText('Hello world')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});

describe('<FilesTab>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the drop zone and empty state', async () => {
    vi.mocked(listAttachments).mockResolvedValue({ items: [] });
    render(withProviders(<FilesTab entityType="invoice" entityId="11111111-1111-1111-1111-111111111111" />));
    expect(await screen.findByText(/Drag and drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/no files yet/i)).toBeInTheDocument();
  });

  it('lists existing files', async () => {
    vi.mocked(listAttachments).mockResolvedValue({
      items: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          org_id: '99999999-9999-9999-9999-999999999999',
          entity_type: 'invoice',
          entity_id: '11111111-1111-1111-1111-111111111111',
          file_name: 'contract.pdf',
          file_path: '99/invoice/11/contract.pdf',
          mime_type: 'application/pdf',
          size_bytes: 2048,
          created_at: new Date().toISOString(),
        },
      ],
    });
    render(withProviders(<FilesTab entityType="invoice" entityId="11111111-1111-1111-1111-111111111111" />));
    expect(await screen.findByText('contract.pdf')).toBeInTheDocument();
  });
});

describe('<NotificationBell>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides when the flag is off', () => {
    fakeFlags({ 'collaboration.enabled': false });
    vi.mocked(listNotifications).mockResolvedValue({ items: [], unread_count: 0 });
    const { container } = render(withProviders(<NotificationBell />));
    expect(container.textContent).toBe('');
  });

  it('shows the unread badge when there are unread items', async () => {
    fakeFlags({ 'collaboration.enabled': true });
    vi.mocked(listNotifications).mockResolvedValue({
      items: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          event_type: 'comment.mention',
          recipient_user_id: '22222222-2222-2222-2222-222222222222',
          channel: 'in_app',
          entity_type: 'invoice',
          entity_id: '11111111-1111-1111-1111-111111111111',
          payload: { body_excerpt: 'hi' },
          created_at: new Date().toISOString(),
          read_at: null,
        },
      ],
      unread_count: 3,
    });
    render(withProviders(<NotificationBell />));
    expect(await screen.findByLabelText(/3 unread/i)).toBeInTheDocument();
  });
});

describe('<MentionAutocomplete>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      withProviders(<MentionAutocomplete query="" open={false} onPick={() => undefined} />),
    );
    expect(container.querySelector('ul')).toBeNull();
  });

  it('shows the suggestions list when open and items return', async () => {
    vi.mocked(autocompleteMentions).mockResolvedValue({
      items: [
        { user_id: '22222222-2222-2222-2222-222222222222', display_name: 'Alice', email: 'alice@example.com' },
      ],
    });
    render(withProviders(<MentionAutocomplete query="al" open onPick={() => undefined} />));
    expect(await screen.findByText('Alice')).toBeInTheDocument();
  });
});

describe('<CollaborationSection>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when collaboration is off', () => {
    fakeFlags({ 'collaboration.enabled': false });
    const { container } = render(
      withProviders(<CollaborationSection entityType="quote" entityId="abc" />),
    );
    expect(container.textContent).toBe('');
  });

  it('renders the Comments + Files tabs when on', async () => {
    fakeFlags({ 'collaboration.enabled': true });
    vi.mocked(listComments).mockResolvedValue({ items: [] });
    render(
      withProviders(
        <CollaborationSection
          entityType="quote"
          entityId="11111111-1111-1111-1111-111111111111"
        />,
      ),
    );
    expect(screen.getByRole('tab', { name: /comments/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /files/i })).toBeInTheDocument();
    expect(await screen.findByText(/no comments yet/i)).toBeInTheDocument();
  });
});
