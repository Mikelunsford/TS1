/**
 * Unit test for <RequireFlag>. Mocks useOrgFlags and asserts:
 *   - flag-on → children render
 *   - flag-off → Navigate redirect
 *   - loading → no children
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/hooks/useOrgFlags', () => ({
  useOrgFlags: vi.fn(),
}));

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { RequireFlag } from '@/components/shell/RequireFlag';

function withRouter(initialPath: string, children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={children}>
            <Route path="/gated" element={<div>protected-content</div>} />
          </Route>
          <Route path="/feature-unavailable" element={<div>feature-unavailable</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('<RequireFlag>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when the flag is on', () => {
    vi.mocked(useOrgFlags).mockReturnValue({
      data: { 'inventory.enabled': true },
      isLoading: false,
    } as unknown as ReturnType<typeof useOrgFlags>);
    render(withRouter('/gated', <RequireFlag flag="inventory.enabled" />));
    expect(screen.getByText('protected-content')).toBeInTheDocument();
  });

  it('redirects to /feature-unavailable when the flag is explicitly off', () => {
    vi.mocked(useOrgFlags).mockReturnValue({
      data: { 'inventory.enabled': false },
      isLoading: false,
    } as unknown as ReturnType<typeof useOrgFlags>);
    render(withRouter('/gated', <RequireFlag flag="inventory.enabled" />));
    expect(screen.queryByText('protected-content')).not.toBeInTheDocument();
    expect(screen.getByText('feature-unavailable')).toBeInTheDocument();
  });

  it('fails open (renders children) when the flag is absent in the map', () => {
    // SPA fail-open; BE requireFlag is source of truth for hard-deny.
    vi.mocked(useOrgFlags).mockReturnValue({
      data: { 'other.flag': true },
      isLoading: false,
    } as unknown as ReturnType<typeof useOrgFlags>);
    render(withRouter('/gated', <RequireFlag flag="inventory.enabled" />));
    expect(screen.getByText('protected-content')).toBeInTheDocument();
  });

  it('renders nothing while flags are loading', () => {
    vi.mocked(useOrgFlags).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useOrgFlags>);
    render(withRouter('/gated', <RequireFlag flag="inventory.enabled" />));
    expect(screen.queryByText('protected-content')).not.toBeInTheDocument();
    expect(screen.queryByText('feature-unavailable')).not.toBeInTheDocument();
  });
});
