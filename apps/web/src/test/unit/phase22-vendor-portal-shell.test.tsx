/**
 * Phase 22 — <VendorPortalShell> + <VendorPortalRoute> unit tests
 * (Wave 10 Session 4 / C2).
 *
 * Asserts:
 *   - Shell renders the 5 nav items and a sign-out button
 *   - Workspace switcher / NotificationBell / GlobalSearchBar are NOT
 *     in the portal shell (staff-only chrome)
 *   - VendorPortalRoute redirects non-vendor_user users to '/'
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({
    state: {
      status: 'authenticated',
      user: { id: 'u1', email: 'v@example.com' },
      session: {},
    },
    signOut: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/useBranding', () => ({
  useBranding: () => ({
    data: { app_name_override: 'Acme Portal' },
    isLoading: false,
  }),
}));

vi.mock('@/lib/hooks/useMe', () => ({
  useMe: vi.fn(),
}));

import { useMe } from '@/lib/hooks/useMe';
import { VendorPortalShell } from '@/components/vendor-portal/VendorPortalShell';
import { VendorPortalRoute } from '@/auth/VendorPortalRoute';

function withRouter(initialPath: string, children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/vendor-portal" element={children} />
          <Route path="/" element={<div>staff-home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('<VendorPortalShell>', () => {
  beforeEach(() => {
    vi.mocked(useMe).mockReturnValue({
      data: {
        active_role: 'vendor_user',
        active_org_id: 'o1',
        memberships: [],
        user_id: 'u1',
        email: 'v@example.com',
        display_name: null,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);
  });

  it('renders nav items + sign-out', () => {
    render(
      withRouter(
        '/vendor-portal',
        <VendorPortalShell>
          <p>child</p>
        </VendorPortalShell>,
      ),
    );
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Purchase Orders')).toBeInTheDocument();
    expect(screen.getByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('Payments')).toBeInTheDocument();
    expect(screen.getByText('Statement')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('does NOT render staff workspace switcher / search', () => {
    render(
      withRouter(
        '/vendor-portal',
        <VendorPortalShell>
          <p>child</p>
        </VendorPortalShell>,
      ),
    );
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    // No org switcher button (search/workspace icons rely on different aria labels)
    expect(screen.queryByText(/switch workspace/i)).not.toBeInTheDocument();
  });
});

describe('<VendorPortalRoute>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders portal shell + content for vendor_user', () => {
    vi.mocked(useMe).mockReturnValue({
      data: {
        active_role: 'vendor_user',
        active_org_id: 'o1',
        memberships: [],
        user_id: 'u1',
        email: 'v@example.com',
        display_name: null,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);
    render(
      withRouter(
        '/vendor-portal',
        <VendorPortalRoute>
          <p>portal-content</p>
        </VendorPortalRoute>,
      ),
    );
    expect(screen.getByText('portal-content')).toBeInTheDocument();
  });

  it('redirects non-vendor_user users away to /', () => {
    vi.mocked(useMe).mockReturnValue({
      data: {
        active_role: 'org_admin',
        active_org_id: 'o1',
        memberships: [],
        user_id: 'u1',
        email: 'a@example.com',
        display_name: null,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);
    render(
      withRouter(
        '/vendor-portal',
        <VendorPortalRoute>
          <p>portal-content</p>
        </VendorPortalRoute>,
      ),
    );
    expect(screen.queryByText('portal-content')).not.toBeInTheDocument();
    expect(screen.getByText('staff-home')).toBeInTheDocument();
  });
});
