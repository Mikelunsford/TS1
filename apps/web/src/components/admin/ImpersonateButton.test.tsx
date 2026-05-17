/**
 * ImpersonateButton tests — Phase 23 (Wave 10 Session 4).
 *
 * Verifies:
 *   - clicking with no reason → error, no API call
 *   - clicking with reason → POSTs to /admin/impersonate with the reason
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ImpersonateButton } from './ImpersonateButton';

// Wave 11 (R-W10-P23-OBS-01): impersonation TTL is 900s (15 min) and the
// handler returns expires_at so the SPA banner can render a live countdown.
const impersonateMock = vi.fn(async () => ({
  session_id: '11111111-1111-1111-1111-111111111111',
  access_token: 'token',
  refresh_token: null,
  expires_in: 900,
  expires_at: new Date(Date.now() + 900_000).toISOString(),
  impersonated_user_id: '22222222-2222-2222-2222-222222222222',
  impersonated_email: 'target@org.com',
  org_id: '33333333-3333-3333-3333-333333333333',
  action_link: null,
}));
vi.mock('@/lib/services/adminConsoleService', () => ({
  impersonate: (...args: unknown[]) => impersonateMock(...(args as Parameters<typeof impersonateMock>)),
}));

const verifyOtpMock = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { verifyOtp: () => verifyOtpMock() } },
}));

const setSessionMock = vi.fn();
vi.mock('./useImpersonation', () => ({
  useImpersonation: () => ({
    isImpersonating: false,
    session: null,
    setSession: setSessionMock,
    clear: vi.fn(),
  }),
}));

beforeEach(() => {
  impersonateMock.mockClear();
  verifyOtpMock.mockClear();
  setSessionMock.mockClear();
});

describe('ImpersonateButton', () => {
  it('requires reason — cancelled prompt = no API call', () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null);
    render(
      <ImpersonateButton
        orgId="33333333-3333-3333-3333-333333333333"
        userId="22222222-2222-2222-2222-222222222222"
        userEmail="target@org.com"
        userDisplayName="Target User"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Impersonate/i }));
    expect(impersonateMock).not.toHaveBeenCalled();
  });

  it('calls impersonate with reason then setSession', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('reviewing #1234');
    // Stub location so redirect doesn't fail
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    });

    render(
      <ImpersonateButton
        orgId="33333333-3333-3333-3333-333333333333"
        userId="22222222-2222-2222-2222-222222222222"
        userEmail="target@org.com"
        userDisplayName="Target User"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Impersonate/i }));
    await waitFor(() => {
      expect(impersonateMock).toHaveBeenCalledWith({
        user_id: '22222222-2222-2222-2222-222222222222',
        org_id: '33333333-3333-3333-3333-333333333333',
        reason: 'reviewing #1234',
      });
    });
    await waitFor(() => expect(setSessionMock).toHaveBeenCalled());
  });
});
