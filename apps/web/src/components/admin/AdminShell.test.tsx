/**
 * AdminShell tests — Phase 23 (Wave 10 Session 4).
 *
 * Verifies:
 *   - shows a "Verifying platform admin…" loading state
 *   - renders the chrome + nav when caller IS a platform admin
 *   - redirects (returns null content) when caller is NOT
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

import { AdminShell } from './AdminShell';

const useIsPlatformAdminMock = vi.fn();
vi.mock('@/lib/hooks/useIsPlatformAdmin', () => ({
  useIsPlatformAdmin: () => useIsPlatformAdminMock(),
}));

const useImpersonationMock = vi.fn(() => ({
  isImpersonating: false,
  session: null,
  setSession: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('./useImpersonation', () => ({
  useImpersonation: () => useImpersonationMock(),
}));

function withProviders(child: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={child} />
          <Route path="/" element={<div data-testid="redirected-home">home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AdminShell', () => {
  it('shows loading state', () => {
    useIsPlatformAdminMock.mockReturnValue({ data: undefined, isLoading: true });
    render(withProviders(<AdminShell><div>child</div></AdminShell>));
    expect(screen.getByText(/Verifying platform admin/i)).toBeInTheDocument();
  });

  it('renders admin chrome for platform admin', () => {
    useIsPlatformAdminMock.mockReturnValue({
      data: { isPlatformAdmin: true, me: { user_id: 'u1' } },
      isLoading: false,
    });
    render(withProviders(<AdminShell><div data-testid="kid">kid</div></AdminShell>));
    expect(screen.getByText(/Platform Admin Console/i)).toBeInTheDocument();
    expect(screen.getByText(/Super User/i)).toBeInTheDocument();
    expect(screen.getByTestId('kid')).toBeInTheDocument();
  });

  it('redirects non-platform-admin to /', () => {
    useIsPlatformAdminMock.mockReturnValue({
      data: { isPlatformAdmin: false, me: null },
      isLoading: false,
    });
    render(withProviders(<AdminShell><div>kid</div></AdminShell>));
    expect(screen.getByTestId('redirected-home')).toBeInTheDocument();
  });
});
