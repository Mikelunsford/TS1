import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from './auth/ProtectedRoute';

const PlaceholderHome = lazy(() => import('./pages/PlaceholderHome'));
const SignIn = lazy(() => import('./pages/SignIn'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const NotFound = lazy(() => import('./pages/NotFound'));

// CRM (Wave 2) — FE-A owns customers/contacts/activities; FE-B owns
// leads/opportunities (merged via PR #21).
const CrmIndexRedirect = lazy(() => import('./pages/crm/CrmIndexRedirect'));
const CustomersListPage = lazy(() => import('./pages/crm/CustomersListPage'));
const CustomerDetailPage = lazy(() => import('./pages/crm/CustomerDetailPage'));
const ContactsListPage = lazy(() => import('./pages/crm/ContactsListPage'));
const ActivitiesFeedPage = lazy(() => import('./pages/crm/ActivitiesFeedPage'));
const LeadsPage = lazy(() => import('./pages/crm/LeadsPage'));
const OpportunitiesPage = lazy(() => import('./pages/crm/OpportunitiesPage'));

// Items (Wave 3) — FE-A owns this block.
const ItemsListPage = lazy(() => import('./pages/items/ItemsListPage'));
const ItemDetailPage = lazy(() => import('./pages/items/ItemDetailPage'));
const ItemCategoriesPage = lazy(() => import('./pages/items/ItemCategoriesPage'));
// end items lazy.

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
        <Route
          path="/crm"
          element={
            <ProtectedRoute>
              <CrmIndexRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm/customers"
          element={
            <ProtectedRoute>
              <CustomersListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm/customers/:id"
          element={
            <ProtectedRoute>
              <CustomerDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm/contacts"
          element={
            <ProtectedRoute>
              <ContactsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm/leads"
          element={
            <ProtectedRoute>
              <LeadsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm/opportunities"
          element={
            <ProtectedRoute>
              <OpportunitiesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm/activities"
          element={
            <ProtectedRoute>
              <ActivitiesFeedPage />
            </ProtectedRoute>
          }
        />
        {/* Items (Wave 3) — FE-A owns this block. */}
        <Route
          path="/items"
          element={
            <ProtectedRoute>
              <ItemsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/items/categories"
          element={
            <ProtectedRoute>
              <ItemCategoriesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/items/:id"
          element={
            <ProtectedRoute>
              <ItemDetailPage />
            </ProtectedRoute>
          }
        />
        {/* end items routes. */}
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </Suspense>
  );
}
