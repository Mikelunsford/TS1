import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from './AuthContext';

/**
 * Route guard. Wave 0 supports two terminal states: authenticated -> render,
 * unauthenticated -> redirect to /login. Wave 1 adds wrong-org and wrong-role
 * states with corresponding redirects.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-fg-muted">
        Checking session…
      </div>
    );
  }

  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
