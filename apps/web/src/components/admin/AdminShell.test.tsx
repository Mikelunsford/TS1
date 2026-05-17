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

function withProviders(child: React.ReactNode, initialPath = '/admin') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          {/* For /admin route the test renders AdminShell directly. For
              /admin/enroll-mfa we route to a sentinel so the MFA-missing
              redirect test can detect that the Navigate fired. */}
          <Route path="/admin" element={child} />
          <Route
            path="/admin/enroll-mfa"
            element={<div data-testid="redirected-enroll">enroll</div>}
          />
          <Route path="/" element={<div data-testid="redirected-home">home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function withProvidersOnEnroll(child: React.ReactNode) {
  // Variant used for the "renders on /admin/enroll-mfa" test, where the
  // enrollment route IS the AdminShell-wrapped one so we can assert chrome.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/enroll-mfa']}>
        <Routes>
          <Route path="/admin/enroll-mfa" element={child} />
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

  it('renders admin chrome for platform admin with verified MFA', () => {
    useIsPlatformAdminMock.mockReturnValue({
      data: { isPlatformAdmin: true, me: { user_id: 'u1', mfa_verified: true } },
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

  // Wave 11 (R-W10-P23-OBS-02) — platform admin without MFA gets bounced to
  // the enrollment page on any non-enrollment admin route.
  it('redirects platform admin without MFA to /admin/enroll-mfa', () => {
    useIsPlatformAdminMock.mockReturnValue({
      data: { isPlatformAdmin: true, me: { user_id: 'u1', mfa_verified: false } },
      isLoading: false,
    });
    render(withProviders(<AdminShell><div data-testid="kid">kid</div></AdminShell>));
    // Shell should not render its chrome — Navigate redirects to the
    // enrollment sentinel.
    expect(screen.getByTestId('redirected-enroll')).toBeInTheDocument();
    expect(screen.queryByText(/Platform Admin Console/i)).not.toBeInTheDocument();
  });

  // The shell DOES render on the enrollment route itself so the page can be
  // wrapped in admin chrome without looping.
  it('renders on /admin/enroll-mfa even without verified MFA', () => {
    useIsPlatformAdminMock.mockReturnValue({
      data: { isPlatformAdmin: true, me: { user_id: 'u1', mfa_verified: false } },
      isLoading: false,
    });
    render(
      withProvidersOnEnroll(<AdminShell><div data-testid="kid">kid</div></AdminShell>),
    );
    expect(screen.getByText(/Platform Admin Console/i)).toBeInTheDocument();
    expect(screen.getByTestId('kid')).toBeInTheDocument();
  });
});
