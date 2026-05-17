import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/**
 * Three-state auth model. See TS1/07-architecture/04-AUTH-RBAC.md.
 *
 *  - loading: initial mount, session token is being recovered from storage
 *  - authenticated: we have a Session AND a User
 *  - unauthenticated: no Session
 *
 * Wave 0 stops here. Wave 1 adds: org_id from app_metadata, role from
 * org_memberships, capability gating via `useRoleGate`, and impersonation.
 */

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User; session: Session }
  | { status: 'unauthenticated' };

interface AuthContextValue {
  state: AuthState;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session && data.session.user) {
        setState({ status: 'authenticated', user: data.session.user, session: data.session });
      } else {
        setState({ status: 'unauthenticated' });
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session && session.user) {
        setState({ status: 'authenticated', user: session.user, session });
      } else {
        setState({ status: 'unauthenticated' });
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

/**
 * Variant of useAuth that returns undefined when no <AuthProvider> is in the
 * tree, instead of throwing. Use this in low-level hooks like
 * `useCapabilities` that may be rendered by component-level unit tests
 * which don't set up the auth provider (those tests pass capability data
 * via mocks, not via real auth).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuthOptional(): AuthContextValue | undefined {
  return useContext(AuthContext);
}
