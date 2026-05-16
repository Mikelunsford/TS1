/**
 * EndImpersonationBanner tests — Phase 23 (Wave 10 Session 4).
 *
 * Verifies:
 *   - banner renders when a session is passed and shows the impersonated email
 *   - visually distinct red treatment is in the className
 *   - clicking "Stop impersonating" calls endImpersonation + clears sessionStorage
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { EndImpersonationBanner } from './EndImpersonationBanner';
import type { ImpersonationSession } from './useImpersonation';

const endImpersonationMock = vi.fn(async (_id: string) => ({
  session: { id: 's1', ended_at: '2026-05-16T00:00:00Z' },
}));
vi.mock('@/lib/services/adminConsoleService', () => ({
  endImpersonation: (...args: unknown[]) =>
    endImpersonationMock(...(args as Parameters<typeof endImpersonationMock>)),
}));

const signOutMock = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: () => signOutMock() } },
}));

const clearMock = vi.fn();
vi.mock('./useImpersonation', () => ({
  useImpersonation: () => ({
    isImpersonating: true,
    session: null,
    setSession: vi.fn(),
    clear: clearMock,
  }),
}));

const SESSION: ImpersonationSession = {
  sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  impersonatedUserId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  impersonatedEmail: 'user@target.com',
  orgId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  startedAt: '2026-05-16T00:00:00Z',
};

describe('EndImpersonationBanner', () => {
  it('renders nothing when session is null', () => {
    const { container } = render(<EndImpersonationBanner session={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders banner with target email + red treatment', () => {
    render(<EndImpersonationBanner session={SESSION} />);
    const banner = screen.getByTestId('end-impersonation-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.className).toMatch(/bg-red-600/);
    expect(screen.getByText(/IMPERSONATING user@target.com/i)).toBeInTheDocument();
  });

  it('clicking stop calls endImpersonation + clear', async () => {
    // Stub window.location.href setter
    const original = window.location;
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    });

    render(<EndImpersonationBanner session={SESSION} />);
    fireEvent.click(screen.getByRole('button', { name: /Stop impersonating/i }));
    await waitFor(() => {
      expect(endImpersonationMock).toHaveBeenCalledWith(SESSION.sessionId);
    });
    expect(clearMock).toHaveBeenCalled();
    expect(signOutMock).toHaveBeenCalled();

    Object.defineProperty(window, 'location', { writable: true, value: original });
  });
});
