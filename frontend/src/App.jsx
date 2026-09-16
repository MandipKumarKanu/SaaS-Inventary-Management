import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { AuthLayout } from './components/layout/AuthLayout';
import { AdminLayout } from './components/layout/AdminLayout';
import { Seo } from './components/seo/Seo';
import { LoadingState } from './components/common/DataTable';

// Route-level code splitting: each page becomes its own chunk, loaded on demand.
// Pages use named exports, so map them to default for React.lazy.
const lazyPage = (importFn, exportName) =>
  lazy(() => importFn().then((m) => ({ default: m[exportName] })));

const LoginPage = lazyPage(() => import('./pages/auth/LoginPage'), 'LoginPage');
const SignupPage = lazyPage(() => import('./pages/auth/SignupPage'), 'SignupPage');
const DashboardPage = lazyPage(() => import('./pages/dashboard/DashboardPage'), 'DashboardPage');
const ProductsPage = lazyPage(() => import('./pages/products/ProductsPage'), 'ProductsPage');
const CategoriesPage = lazyPage(() => import('./pages/categories/CategoriesPage'), 'CategoriesPage');
const WarehousesPage = lazyPage(() => import('./pages/warehouses/WarehousesPage'), 'WarehousesPage');
const InventoryPage = lazyPage(() => import('./pages/inventory/InventoryPage'), 'InventoryPage');
const TransactionLedgerPage = lazyPage(
  () => import('./pages/inventory/TransactionLedgerPage'),
  'TransactionLedgerPage'
);
const MembersPage = lazyPage(() => import('./pages/team/MembersPage'), 'MembersPage');
const RolesPage = lazyPage(() => import('./pages/roles/RolesPage'), 'RolesPage');
const WorkspaceSettingsPage = lazyPage(
  () => import('./pages/settings/WorkspaceSettingsPage'),
  'WorkspaceSettingsPage'
);

// Phase 3 Pages
const TransfersPage = lazyPage(() => import('./pages/transfers/TransfersPage'), 'TransfersPage');
const TransferDetailPage = lazyPage(
  () => import('./pages/transfers/TransferDetailPage'),
  'TransferDetailPage'
);
const CycleCountPage = lazyPage(() => import('./pages/counts/CycleCountPage'), 'CycleCountPage');
const CountDetailPage = lazyPage(() => import('./pages/counts/CountDetailPage'), 'CountDetailPage');
const BarcodeScannerPage = lazyPage(
  () => import('./pages/scanner/BarcodeScannerPage'),
  'BarcodeScannerPage'
);
const BatchesPage = lazyPage(() => import('./pages/batches/BatchesPage'), 'BatchesPage');

// Phase 4 Pages
const SuppliersPage = lazyPage(() => import('./pages/suppliers/SuppliersPage'), 'SuppliersPage');
const CustomersPage = lazyPage(() => import('./pages/customers/CustomersPage'), 'CustomersPage');
const PurchaseOrdersPage = lazyPage(
  () => import('./pages/purchases/PurchaseOrdersPage'),
  'PurchaseOrdersPage'
);
const PODetailPage = lazyPage(() => import('./pages/purchases/PODetailPage'), 'PODetailPage');
const SalesOrdersPage = lazyPage(() => import('./pages/sales/SalesOrdersPage'), 'SalesOrdersPage');
const SODetailPage = lazyPage(() => import('./pages/sales/SODetailPage'), 'SODetailPage');
const ReturnsPage = lazyPage(() => import('./pages/returns/ReturnsPage'), 'ReturnsPage');
const ReturnDetailPage = lazyPage(
  () => import('./pages/returns/ReturnDetailPage'),
  'ReturnDetailPage'
);
const ReorderRecommendationsPage = lazyPage(
  () => import('./pages/reorder/ReorderRecommendationsPage'),
  'ReorderRecommendationsPage'
);

// Phase 5 Pages
const ABCAnalysisPage = lazyPage(
  () => import('./pages/analytics/ABCAnalysisPage'),
  'ABCAnalysisPage'
);
const DemandForecastPage = lazyPage(
  () => import('./pages/analytics/DemandForecastPage'),
  'DemandForecastPage'
);
const ReportsCenterPage = lazyPage(
  () => import('./pages/reports/ReportsCenterPage'),
  'ReportsCenterPage'
);
const CSVImportPage = lazyPage(() => import('./pages/reports/CSVImportPage'), 'CSVImportPage');
const NotificationCenterPage = lazyPage(
  () => import('./pages/notifications/NotificationCenterPage'),
  'NotificationCenterPage'
);
const SaaSAdminPortalPage = lazyPage(
  () => import('./pages/admin/SaaSAdminPortalPage'),
  'SaaSAdminPortalPage'
);

// Phase 6 Pages
const APIKeysSettingsPage = lazyPage(
  () => import('./pages/settings/APIKeysSettingsPage'),
  'APIKeysSettingsPage'
);
const WebhooksSettingsPage = lazyPage(
  () => import('./pages/settings/WebhooksSettingsPage'),
  'WebhooksSettingsPage'
);
const BillingSettingsPage = lazyPage(
  () => import('./pages/settings/BillingSettingsPage'),
  'BillingSettingsPage'
);
const CurrenciesSettingsPage = lazyPage(
  () => import('./pages/settings/CurrenciesSettingsPage'),
  'CurrenciesSettingsPage'
);

// Phase 7 Pages
const IntegrationsHubPage = lazyPage(
  () => import('./pages/integrations/IntegrationsHubPage'),
  'IntegrationsHubPage'
);
const ShippingCarrierPage = lazyPage(
  () => import('./pages/shipping/ShippingCarrierPage'),
  'ShippingCarrierPage'
);
const PublicAPIDocsPage = lazyPage(
  () => import('./pages/docs/PublicAPIDocsPage'),
  'PublicAPIDocsPage'
);
const SystemHealthPage = lazyPage(
  () => import('./pages/admin/SystemHealthPage'),
  'SystemHealthPage'
);

// Phase 8 Pages
const BackupRecoveryPage = lazyPage(
  () => import('./pages/settings/BackupRecoveryPage'),
  'BackupRecoveryPage'
);
const SecurityAuditPage = lazyPage(
  () => import('./pages/settings/SecurityAuditPage'),
  'SecurityAuditPage'
);

// Phase 9 Pages
const WhiteLabelSettingsPage = lazyPage(
  () => import('./pages/settings/WhiteLabelSettingsPage'),
  'WhiteLabelSettingsPage'
);
const DemoDataSettingsPage = lazyPage(
  () => import('./pages/settings/DemoDataSettingsPage'),
  'DemoDataSettingsPage'
);

// Phase 10 Pages
const AICopilotAssistantPage = lazyPage(
  () => import('./pages/ai/AICopilotAssistantPage'),
  'AICopilotAssistantPage'
);
const AutomationRulesPage = lazyPage(
  () => import('./pages/automation/AutomationRulesPage'),
  'AutomationRulesPage'
);
const WarehouseRoutingPage = lazyPage(
  () => import('./pages/settings/WarehouseRoutingPage'),
  'WarehouseRoutingPage'
);

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <LoadingState message="Loading page…" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Seo />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* Auth Routes */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
          </Route>

          {/* Protected App Routes */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/ai-copilot" element={<AICopilotAssistantPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/warehouses" element={<WarehousesPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/transfers" element={<TransfersPage />} />
            <Route path="/transfers/:id" element={<TransferDetailPage />} />
            <Route path="/counts" element={<CycleCountPage />} />
            <Route path="/counts/:id" element={<CountDetailPage />} />
            <Route path="/scanner" element={<BarcodeScannerPage />} />
            <Route path="/batches" element={<BatchesPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/purchases" element={<PurchaseOrdersPage />} />
            <Route path="/purchases/:id" element={<PODetailPage />} />
            <Route path="/sales" element={<SalesOrdersPage />} />
            <Route path="/sales/:id" element={<SODetailPage />} />
            <Route path="/returns" element={<ReturnsPage />} />
            <Route path="/returns/:id" element={<ReturnDetailPage />} />
            <Route path="/reorder" element={<ReorderRecommendationsPage />} />
            <Route path="/automation" element={<AutomationRulesPage />} />
            <Route path="/abc-analysis" element={<ABCAnalysisPage />} />
            <Route path="/forecast" element={<DemandForecastPage />} />
            <Route path="/reports" element={<ReportsCenterPage />} />
            <Route path="/import" element={<CSVImportPage />} />
            <Route path="/notifications" element={<NotificationCenterPage />} />
            <Route path="/integrations" element={<IntegrationsHubPage />} />
            <Route path="/shipping" element={<ShippingCarrierPage />} />
            <Route path="/api-docs" element={<PublicAPIDocsPage />} />
            <Route path="/settings/api-keys" element={<APIKeysSettingsPage />} />
            <Route path="/settings/webhooks" element={<WebhooksSettingsPage />} />
            <Route path="/settings/billing" element={<BillingSettingsPage />} />
            <Route path="/settings/currencies" element={<CurrenciesSettingsPage />} />
            <Route path="/settings/3pl-routing" element={<WarehouseRoutingPage />} />
            <Route path="/settings/backup" element={<BackupRecoveryPage />} />
            <Route path="/settings/security-audit" element={<SecurityAuditPage />} />
            <Route path="/settings/branding" element={<WhiteLabelSettingsPage />} />
            <Route path="/settings/demo-data" element={<DemoDataSettingsPage />} />
            <Route path="/ledger" element={<TransactionLedgerPage />} />
            <Route path="/team" element={<MembersPage />} />
            <Route path="/roles" element={<RolesPage />} />
            <Route path="/settings" element={<WorkspaceSettingsPage />} />
          </Route>

          {/* Standalone SaaS Platform Admin Portal (Super Admin Only) */}
          <Route element={<AdminLayout />}>
            <Route path="/admin-portal" element={<SaaSAdminPortalPage />} />
            <Route path="/system-health" element={<SystemHealthPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
