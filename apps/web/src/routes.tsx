import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from './auth/ProtectedRoute';

const PlaceholderHome = lazy(() => import('./pages/PlaceholderHome'));
const SignIn = lazy(() => import('./pages/SignIn'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const NotFound = lazy(() => import('./pages/NotFound'));

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center text-fg-muted">Loading…</div>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<SignIn />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <PlaceholderHome />
            </ProtectedRoute>
          }
        />
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </Suspense>
  );
}
