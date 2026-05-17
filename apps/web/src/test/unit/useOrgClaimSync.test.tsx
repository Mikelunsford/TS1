/**
 * R-W11-AUTH-01 — useOrgClaimSync.
 *
 * Asserts the AppShell-mount boot effect that auto-stamps team1_org_id
 * when /auth-api/me reports an active_org_id that does not match the
 * JWT app_metadata claim. Tests pin the exact import surface
 * (useAuth, useMe, useSwitchOrg) per the R-W11-MFA-TEST-01 lesson: a
 * shape-mocking helper-builder test would have masked the import-shape
 * regression that bit Wave 11D.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('@/auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: vi.fn(),
}));
vi.mock('@/lib/hooks/useSwitchOrg', () => ({
  useSwitchOrg: vi.fn(),
}));

import { useAuth } from '@/auth/AuthContext';
import { useMe } from '@/lib/hooks/useMe';
import { useSwitchOrg } from '@/lib/hooks/useSwitchOrg';
import { useOrgClaimSync } from '@/lib/hooks/useOrgClaimSync';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function authedState(claim: string | undefined) {
  return {
    state: {
      status: 'authenticated',
      user: { id: USER_ID, email: 'mike@kitstak.com' },
      session: {
        user: {
          id: USER_ID,
          email: 'mike@kitstak.com',
          app_metadata: claim ? { team1_org_id: claim } : {},
        },
      },
    },
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>;
}

function meResp(activeOrgId: string | null) {
  return {
    data: {
      user_id: USER_ID,
      email: 'mike@kitstak.com',
      display_name: null,
      active_org_id: activeOrgId,
      active_role: 'org_owner',
      memberships: [],
    },
    isLoading: false,
  } as unknown as ReturnType<typeof useMe>;
}

function switchOrgStub(isPending = false) {
  return {
    mutate: vi.fn(),
    isPending,
  } as unknown as ReturnType<typeof useSwitchOrg>;
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useOrgClaimSync', () => {
  it('fires switchOrg when JWT claim is missing but me.active_org_id is set', () => {
    const stub = switchOrgStub();
    vi.mocked(useAuth).mockReturnValue(authedState(undefined));
    vi.mocked(useMe).mockReturnValue(meResp(ORG_A));
    vi.mocked(useSwitchOrg).mockReturnValue(stub);

    renderHook(() => useOrgClaimSync(), { wrapper });

    expect(stub.mutate).toHaveBeenCalledTimes(1);
    expect(stub.mutate).toHaveBeenCalledWith(ORG_A);
  });

  it('fires switchOrg when JWT claim disagrees with me.active_org_id', () => {
    const stub = switchOrgStub();
    vi.mocked(useAuth).mockReturnValue(authedState(ORG_B));
    vi.mocked(useMe).mockReturnValue(meResp(ORG_A));
    vi.mocked(useSwitchOrg).mockReturnValue(stub);

    renderHook(() => useOrgClaimSync(), { wrapper });

    expect(stub.mutate).toHaveBeenCalledWith(ORG_A);
  });

  it('does NOT fire when JWT claim matches me.active_org_id', () => {
    const stub = switchOrgStub();
    vi.mocked(useAuth).mockReturnValue(authedState(ORG_A));
    vi.mocked(useMe).mockReturnValue(meResp(ORG_A));
    vi.mocked(useSwitchOrg).mockReturnValue(stub);

    renderHook(() => useOrgClaimSync(), { wrapper });

    expect(stub.mutate).not.toHaveBeenCalled();
  });

  it('does NOT fire when me.active_org_id is null (no memberships)', () => {
    const stub = switchOrgStub();
    vi.mocked(useAuth).mockReturnValue(authedState(undefined));
    vi.mocked(useMe).mockReturnValue(meResp(null));
    vi.mocked(useSwitchOrg).mockReturnValue(stub);

    renderHook(() => useOrgClaimSync(), { wrapper });

    expect(stub.mutate).not.toHaveBeenCalled();
  });

  it('does NOT fire while a switchOrg mutation is already pending', () => {
    const stub = switchOrgStub(true);
    vi.mocked(useAuth).mockReturnValue(authedState(undefined));
    vi.mocked(useMe).mockReturnValue(meResp(ORG_A));
    vi.mocked(useSwitchOrg).mockReturnValue(stub);

    renderHook(() => useOrgClaimSync(), { wrapper });

    expect(stub.mutate).not.toHaveBeenCalled();
  });

  it('only attempts once per (user, org) even when the effect re-runs', () => {
    const stub = switchOrgStub();
    vi.mocked(useAuth).mockReturnValue(authedState(undefined));
    vi.mocked(useMe).mockReturnValue(meResp(ORG_A));
    vi.mocked(useSwitchOrg).mockReturnValue(stub);

    const { rerender } = renderHook(() => useOrgClaimSync(), { wrapper });
    rerender();
    rerender();

    expect(stub.mutate).toHaveBeenCalledTimes(1);
  });

  it('is a no-op while auth state is loading', () => {
    const stub = switchOrgStub();
    vi.mocked(useAuth).mockReturnValue({
      state: { status: 'loading' },
      signOut: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useMe).mockReturnValue(meResp(ORG_A));
    vi.mocked(useSwitchOrg).mockReturnValue(stub);

    renderHook(() => useOrgClaimSync(), { wrapper });

    expect(stub.mutate).not.toHaveBeenCalled();
  });
});
