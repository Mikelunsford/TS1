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

// Quotes (Wave 4 / 4.3a) — FE-A owns this block.
const QuotesListPage = lazy(() => import('./pages/quotes/QuotesListPage'));
const QuoteCreatePage = lazy(() => import('./pages/quotes/QuoteCreatePage'));
const QuoteDetailPage = lazy(() => import('./pages/quotes/QuoteDetailPage'));
// end quotes lazy.

// Projects (Wave 4 / 4.3b) — FE-B owns this block.
const ProjectsListPage = lazy(() => import('./pages/projects/ProjectsListPage'));
const ProjectCreatePage = lazy(() => import('./pages/projects/ProjectCreatePage'));
const ProjectDetailPage = lazy(() => import('./pages/projects/ProjectDetailPage'));
// end projects lazy.

// Invoices (Wave 5 / 5.3a) — FE-A owns this block.
const InvoicesListPage = lazy(() => import('./pages/invoices/InvoicesListPage'));
const InvoiceCreatePage = lazy(() => import('./pages/invoices/InvoiceCreatePage'));
const InvoiceDetailPage = lazy(() => import('./pages/invoices/InvoiceDetailPage'));
// end invoices lazy.

// Payments+CreditNotes (Wave 5 / 5.3b) — FE-B owns this block.
const PaymentsListPage = lazy(() => import('./pages/payments/PaymentsListPage'));
const PaymentCreatePage = lazy(() => import('./pages/payments/PaymentCreatePage'));
const PaymentDetailPage = lazy(() => import('./pages/payments/PaymentDetailPage'));
const CreditNotesListPage = lazy(() => import('./pages/credit-notes/CreditNotesListPage'));
const CreditNoteCreatePage = lazy(() => import('./pages/credit-notes/CreditNoteCreatePage'));
const CreditNoteDetailPage = lazy(() => import('./pages/credit-notes/CreditNoteDetailPage'));
// end payments + credit notes lazy.

// Procurement (Wave 7 / Phase 10 — FE-A owns this block)
const VendorListPage = lazy(() => import('./pages/vendors/VendorListPage'));
const VendorDetailPage = lazy(() => import('./pages/vendors/VendorDetailPage'));
const VendorFormPage = lazy(() => import('./pages/vendors/VendorFormPage'));
const PurchaseOrderListPage = lazy(() => import('./pages/purchase-orders/PurchaseOrderListPage'));
const PurchaseOrderDetailPage = lazy(() => import('./pages/purchase-orders/PurchaseOrderDetailPage'));
const PurchaseOrderFormPage = lazy(() => import('./pages/purchase-orders/PurchaseOrderFormPage'));
const VendorBillListPage = lazy(() => import('./pages/vendor-bills/VendorBillListPage'));
const VendorBillDetailPage = lazy(() => import('./pages/vendor-bills/VendorBillDetailPage'));
const VendorBillFormPage = lazy(() => import('./pages/vendor-bills/VendorBillFormPage'));
// end procurement lazy.

// Expenses (Wave 7 / Phase 11 — FE-A owns this block)
const ExpenseListPage = lazy(() => import('./pages/expenses/ExpenseListPage'));
const ExpenseDetailPage = lazy(() => import('./pages/expenses/ExpenseDetailPage'));
const ExpenseFormPage = lazy(() => import('./pages/expenses/ExpenseFormPage'));
const MyExpensesPage = lazy(() => import('./pages/expenses/MyExpensesPage'));
// end expenses lazy.

// Finance / GL (Wave 8c / Phase 12 — FE-A owns this block)
const AccountListPage = lazy(() => import('./pages/finance/AccountListPage'));
const AccountFormPage = lazy(() => import('./pages/finance/AccountFormPage'));
const JournalEntryListPage = lazy(() => import('./pages/finance/JournalEntryListPage'));
const JournalEntryFormPage = lazy(() => import('./pages/finance/JournalEntryFormPage'));
const JournalEntryDetailPage = lazy(() => import('./pages/finance/JournalEntryDetailPage'));
// end finance / GL lazy.

// Inventory (Wave 8f / Phase 13 — FE-A owns this block)
const WarehouseListPage = lazy(() => import('./pages/warehouses/WarehouseListPage'));
const WarehouseFormPage = lazy(() => import('./pages/warehouses/WarehouseFormPage'));
const StockOverviewPage = lazy(() => import('./pages/stock/StockOverviewPage'));
const StockAdjustPage = lazy(() => import('./pages/stock/StockAdjustPage'));
// end inventory lazy.

// Operations (Wave 8f / Phase 13 — FE-A owns this block)
const ReceivingOrderListPage = lazy(() => import('./pages/receiving/ReceivingOrderListPage'));
const ReceivingOrderFormPage = lazy(() => import('./pages/receiving/ReceivingOrderFormPage'));
const ReceivingOrderDetailPage = lazy(() => import('./pages/receiving/ReceivingOrderDetailPage'));
const ProductionRunListPage = lazy(() => import('./pages/production/ProductionRunListPage'));
const ProductionRunFormPage = lazy(() => import('./pages/production/ProductionRunFormPage'));
const ProductionRunDetailPage = lazy(() => import('./pages/production/ProductionRunDetailPage'));
const ShipmentListPage = lazy(() => import('./pages/shipments/ShipmentListPage'));
const ShipmentFormPage = lazy(() => import('./pages/shipments/ShipmentFormPage'));
const ShipmentDetailPage = lazy(() => import('./pages/shipments/ShipmentDetailPage'));
// end operations lazy.

// Settings (Wave 3) — FE-B owns this block.
const SettingsIndexRedirect = lazy(() => import('./pages/settings/SettingsIndexRedirect'));
const CurrenciesPage = lazy(() => import('./pages/settings/CurrenciesPage'));
const TaxesPage = lazy(() => import('./pages/settings/TaxesPage'));
const PaymentMethodsPage = lazy(() => import('./pages/settings/PaymentMethodsPage'));
const ExchangeRatesPage = lazy(() => import('./pages/settings/ExchangeRatesPage'));
// end settings lazy.

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
        {/* Quotes (Wave 4 / 4.3a) — FE-A owns this block. */}
        <Route
          path="/quotes"
          element={
            <ProtectedRoute>
              <QuotesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/quotes/new"
          element={
            <ProtectedRoute>
              <QuoteCreatePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/quotes/:id"
          element={
            <ProtectedRoute>
              <QuoteDetailPage />
            </ProtectedRoute>
          }
        />
        {/* end quotes routes. */}
        {/* Projects (Wave 4 / 4.3b) — FE-B owns this block. */}
        <Route
          path="/projects"
          element={
            <ProtectedRoute>
              <ProjectsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/new"
          element={
            <ProtectedRoute>
              <ProjectCreatePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <ProtectedRoute>
              <ProjectDetailPage />
            </ProtectedRoute>
          }
        />
        {/* end projects routes. */}
        {/* Invoices (Wave 5 / 5.3a) — FE-A owns this block. */}
        <Route
          path="/invoices"
          element={
            <ProtectedRoute>
              <InvoicesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoices/new"
          element={
            <ProtectedRoute>
              <InvoiceCreatePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoices/:id"
          element={
            <ProtectedRoute>
              <InvoiceDetailPage />
            </ProtectedRoute>
          }
        />
        {/* end invoices routes. */}
        {/* Payments+CreditNotes (Wave 5 / 5.3b) — FE-B owns this block. */}
        <Route
          path="/payments"
          element={
            <ProtectedRoute>
              <PaymentsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/payments/new"
          element={
            <ProtectedRoute>
              <PaymentCreatePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/payments/:id"
          element={
            <ProtectedRoute>
              <PaymentDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/credit-notes"
          element={
            <ProtectedRoute>
              <CreditNotesListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/credit-notes/new"
          element={
            <ProtectedRoute>
              <CreditNoteCreatePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/credit-notes/:id"
          element={
            <ProtectedRoute>
              <CreditNoteDetailPage />
            </ProtectedRoute>
          }
        />
        {/* end payments + credit notes routes. */}
        {/* Procurement (Wave 7 / Phase 10 — FE-A owns this block) */}
        <Route
          path="/vendors"
          element={
            <ProtectedRoute>
              <VendorListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendors/new"
          element={
            <ProtectedRoute>
              <VendorFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendors/:id"
          element={
            <ProtectedRoute>
              <VendorDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendors/:id/edit"
          element={
            <ProtectedRoute>
              <VendorFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders"
          element={
            <ProtectedRoute>
              <PurchaseOrderListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders/new"
          element={
            <ProtectedRoute>
              <PurchaseOrderFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders/:id"
          element={
            <ProtectedRoute>
              <PurchaseOrderDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders/:id/edit"
          element={
            <ProtectedRoute>
              <PurchaseOrderFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendor-bills"
          element={
            <ProtectedRoute>
              <VendorBillListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendor-bills/new"
          element={
            <ProtectedRoute>
              <VendorBillFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendor-bills/:id"
          element={
            <ProtectedRoute>
              <VendorBillDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendor-bills/:id/edit"
          element={
            <ProtectedRoute>
              <VendorBillFormPage />
            </ProtectedRoute>
          }
        />
        {/* end procurement routes. */}
        {/* Expenses (Wave 7 / Phase 11 — FE-A owns this block) */}
        <Route
          path="/expenses"
          element={
            <ProtectedRoute>
              <ExpenseListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses/new"
          element={
            <ProtectedRoute>
              <ExpenseFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses/my"
          element={
            <ProtectedRoute>
              <MyExpensesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses/:id"
          element={
            <ProtectedRoute>
              <ExpenseDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses/:id/edit"
          element={
            <ProtectedRoute>
              <ExpenseFormPage />
            </ProtectedRoute>
          }
        />
        {/* end expenses routes. */}
        {/* Finance / GL (Wave 8c / Phase 12 — FE-A owns this block) */}
        <Route
          path="/finance/accounts"
          element={
            <ProtectedRoute>
              <AccountListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/accounts/new"
          element={
            <ProtectedRoute>
              <AccountFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/accounts/:id"
          element={
            <ProtectedRoute>
              <AccountFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/journal-entries"
          element={
            <ProtectedRoute>
              <JournalEntryListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/journal-entries/new"
          element={
            <ProtectedRoute>
              <JournalEntryFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/journal-entries/:id"
          element={
            <ProtectedRoute>
              <JournalEntryDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/finance/journal-entries/:id/edit"
          element={
            <ProtectedRoute>
              <JournalEntryFormPage />
            </ProtectedRoute>
          }
        />
        {/* end finance / GL routes. */}
        {/* Inventory (Wave 8f / Phase 13 — FE-A owns this block) */}
        <Route
          path="/warehouses"
          element={
            <ProtectedRoute>
              <WarehouseListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/warehouses/new"
          element={
            <ProtectedRoute>
              <WarehouseFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/warehouses/:id/edit"
          element={
            <ProtectedRoute>
              <WarehouseFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock"
          element={
            <ProtectedRoute>
              <StockOverviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/adjust"
          element={
            <ProtectedRoute>
              <StockAdjustPage />
            </ProtectedRoute>
          }
        />
        {/* end inventory routes. */}
        {/* Operations (Wave 8f / Phase 13 — FE-A owns this block) */}
        <Route
          path="/receiving"
          element={
            <ProtectedRoute>
              <ReceivingOrderListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/receiving/new"
          element={
            <ProtectedRoute>
              <ReceivingOrderFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/receiving/:id"
          element={
            <ProtectedRoute>
              <ReceivingOrderDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/production"
          element={
            <ProtectedRoute>
              <ProductionRunListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/production/new"
          element={
            <ProtectedRoute>
              <ProductionRunFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/production/:id"
          element={
            <ProtectedRoute>
              <ProductionRunDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shipments"
          element={
            <ProtectedRoute>
              <ShipmentListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shipments/new"
          element={
            <ProtectedRoute>
              <ShipmentFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shipments/:id"
          element={
            <ProtectedRoute>
              <ShipmentDetailPage />
            </ProtectedRoute>
          }
        />
        {/* end operations routes. */}
        {/* Settings (Wave 3) — FE-B owns this block. */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsIndexRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/currencies"
          element={
            <ProtectedRoute>
              <CurrenciesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/taxes"
          element={
            <ProtectedRoute>
              <TaxesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/payment-methods"
          element={
            <ProtectedRoute>
              <PaymentMethodsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/exchange-rates"
          element={
            <ProtectedRoute>
              <ExchangeRatesPage />
            </ProtectedRoute>
          }
        />
        {/* end settings routes. */}
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </Suspense>
  );
}
