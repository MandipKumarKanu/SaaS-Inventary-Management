import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { AuthLayout } from './components/layout/AuthLayout';
import { AdminLayout } from './components/layout/AdminLayout';
import { Seo } from './components/seo/Seo';
import { LoadingState } from './components/common/DataTable';
import { useWorkspaceStore } from './store/useWorkspaceStore';
import { useAuthStore } from './store/useAuthStore';

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
const AdminWorkspaceDetailPage = lazyPage(
  () => import('./pages/admin/AdminWorkspaceDetailPage'),
  'AdminWorkspaceDetailPage'
);
const AdminUserDetailPage = lazyPage(
  () => import('./pages/admin/AdminUserDetailPage'),
  'AdminUserDetailPage'
);
const AdminPaymentDetailPage = lazyPage(
  () => import('./pages/admin/AdminPaymentDetailPage'),
  'AdminPaymentDetailPage'
);
const AdminWebhookEventDetailPage = lazyPage(
  () => import('./pages/admin/AdminWebhookEventDetailPage'),
  'AdminWebhookEventDetailPage'
);
const AdminAuditEventDetailPage = lazyPage(
  () => import('./pages/admin/AdminAuditEventDetailPage'),
  'AdminAuditEventDetailPage'
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

          {/* Standalone SaaS Platform Admin Portal (Super Admin Only) */}
          <Route element={<AdminLayout />}>
            <Route path="/admin-portal" element={<SaaSAdminPortalPage />} />
            <Route path="/admin-portal/workspaces/:workspaceId" element={<AdminWorkspaceDetailPage />} />
            <Route path="/admin-portal/users/:userId" element={<AdminUserDetailPage />} />
            <Route path="/admin-portal/payments/:paymentId" element={<AdminPaymentDetailPage />} />
            <Route path="/admin-portal/webhook-events/:eventId" element={<AdminWebhookEventDetailPage />} />
            <Route path="/admin-portal/audit-events/:auditId" element={<AdminAuditEventDetailPage />} />
            <Route path="/system-health" element={<SystemHealthPage />} />
          </Route>

          {/*
            Protected App Routes — workspace in the URL (PRD §6).
            AppLayout resolves :workspaceSlug → active workspace + membership.
          */}
          <Route path="/app/:workspaceSlug" element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="ai-copilot" element={<AICopilotAssistantPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="warehouses" element={<WarehousesPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="transfers" element={<TransfersPage />} />
            <Route path="transfers/:id" element={<TransferDetailPage />} />
            <Route path="counts" element={<CycleCountPage />} />
            <Route path="counts/:id" element={<CountDetailPage />} />
            <Route path="scanner" element={<BarcodeScannerPage />} />
            <Route path="batches" element={<BatchesPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="purchases" element={<PurchaseOrdersPage />} />
            <Route path="purchases/:id" element={<PODetailPage />} />
            <Route path="sales" element={<SalesOrdersPage />} />
            <Route path="sales/:id" element={<SODetailPage />} />
            <Route path="returns" element={<ReturnsPage />} />
            <Route path="returns/:id" element={<ReturnDetailPage />} />
            <Route path="reorder" element={<ReorderRecommendationsPage />} />
            <Route path="automation" element={<AutomationRulesPage />} />
            <Route path="abc-analysis" element={<ABCAnalysisPage />} />
            <Route path="forecast" element={<DemandForecastPage />} />
            <Route path="reports" element={<ReportsCenterPage />} />
            <Route path="import" element={<CSVImportPage />} />
            <Route path="notifications" element={<NotificationCenterPage />} />
            <Route path="integrations" element={<IntegrationsHubPage />} />
            <Route path="shipping" element={<ShippingCarrierPage />} />
            <Route path="api-docs" element={<PublicAPIDocsPage />} />
            <Route path="settings/api-keys" element={<APIKeysSettingsPage />} />
            <Route path="settings/webhooks" element={<WebhooksSettingsPage />} />
            <Route path="settings/billing" element={<BillingSettingsPage />} />
            <Route path="settings/currencies" element={<CurrenciesSettingsPage />} />
            <Route path="settings/3pl-routing" element={<WarehouseRoutingPage />} />
            <Route path="settings/backup" element={<BackupRecoveryPage />} />
            <Route path="settings/security-audit" element={<SecurityAuditPage />} />
            <Route path="settings/branding" element={<WhiteLabelSettingsPage />} />
            <Route path="settings/demo-data" element={<DemoDataSettingsPage />} />
            <Route path="ledger" element={<TransactionLedgerPage />} />
            <Route path="team" element={<MembersPage />} />
            <Route path="roles" element={<RolesPage />} />
            <Route path="settings" element={<WorkspaceSettingsPage />} />
          </Route>

          {/* Legacy paths → new /app/:workspaceSlug equivalents (redirects) */}
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/app" element={<LegacyAppRedirect />} />
          <Route path="/dashboard" element={<LegacyRedirect section="dashboard" />} />
          <Route path="/products" element={<LegacyRedirect section="products" />} />
          <Route path="/categories" element={<LegacyRedirect section="categories" />} />
          <Route path="/warehouses" element={<LegacyRedirect section="warehouses" />} />
          <Route path="/inventory" element={<LegacyRedirect section="inventory" />} />
          <Route path="/ledger" element={<LegacyRedirect section="ledger" />} />
          <Route path="/transfers" element={<LegacyRedirect section="transfers" />} />
          <Route path="/counts" element={<LegacyRedirect section="counts" />} />
          <Route path="/scanner" element={<LegacyRedirect section="scanner" />} />
          <Route path="/batches" element={<LegacyRedirect section="batches" />} />
          <Route path="/suppliers" element={<LegacyRedirect section="suppliers" />} />
          <Route path="/customers" element={<LegacyRedirect section="customers" />} />
          <Route path="/purchases" element={<LegacyRedirect section="purchases" />} />
          <Route path="/sales" element={<LegacyRedirect section="sales" />} />
          <Route path="/returns" element={<LegacyRedirect section="returns" />} />
          <Route path="/reorder" element={<LegacyRedirect section="reorder" />} />
          <Route path="/automation" element={<LegacyRedirect section="automation" />} />
          <Route path="/abc-analysis" element={<LegacyRedirect section="abc-analysis" />} />
          <Route path="/forecast" element={<LegacyRedirect section="forecast" />} />
          <Route path="/reports" element={<LegacyRedirect section="reports" />} />
          <Route path="/import" element={<LegacyRedirect section="import" />} />
          <Route path="/notifications" element={<LegacyRedirect section="notifications" />} />
          <Route path="/integrations" element={<LegacyRedirect section="integrations" />} />
          <Route path="/shipping" element={<LegacyRedirect section="shipping" />} />
          <Route path="/api-docs" element={<LegacyRedirect section="api-docs" />} />
          <Route path="/ai-copilot" element={<LegacyRedirect section="ai-copilot" />} />
          <Route path="/team" element={<LegacyRedirect section="team" />} />
          <Route path="/roles" element={<LegacyRedirect section="roles" />} />
          <Route path="/settings" element={<LegacyRedirect section="settings" />} />
          <Route path="/settings/:section" element={<LegacyRedirect />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

// ---------------------------------------------------------------------
// Legacy redirects (Phase 9): flat paths → /app/:workspaceSlug/<section>.
// The workspace slug comes from the last-used cache inside the store;
// once redirected, AppLayout is the authority and corrects if needed.
// ---------------------------------------------------------------------

function LegacyAppRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = useAuthStore.getState().token;
      if (!token) {
        navigate('/login', { replace: true });
        return;
      }

      let storeState = useWorkspaceStore.getState();
      let list = storeState.workspaces;
      if (list.length === 0) {
        list = (await storeState.fetchWorkspaces()) || [];
      }
      if (cancelled) return;

      storeState = useWorkspaceStore.getState();
      const target = storeState.activeWorkspace || list[0] || null;
      const slugOrId = target?.slug || target?.id;
      if (slugOrId) {
        navigate(`/app/${slugOrId}/dashboard`, { replace: true });
      } else {
        navigate('/app/_/dashboard', { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <LoadingState message="Opening your workspace…" />
    </div>
  );
}

function LegacyRedirect({ section }) {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = useAuthStore.getState().token;
      if (!token) {
        navigate('/login', { replace: true });
        return;
      }

      let storeState = useWorkspaceStore.getState();
      let ws = storeState.activeWorkspace;
      let slugOrId = ws?.slug || ws?.id;
      if (!slugOrId) {
        let list = storeState.workspaces;
        if (list.length === 0) {
          list = (await storeState.fetchWorkspaces()) || [];
        }
        storeState = useWorkspaceStore.getState();
        ws = storeState.activeWorkspace || list[0] || null;
        slugOrId = ws?.slug || ws?.id;
      }

      if (cancelled) return;

      if (slugOrId) {
        const pathSection = section || params.section || 'dashboard';
        const extra = params.section && section ? `/${params.section}` : '';
        const rest = location.pathname.replace(/^\/(settings\/)?[^/]+/, '');
        const destination = (`/app/${slugOrId}/${pathSection}${extra || rest}`).replace(/\/+$/, '') || `/app/${slugOrId}`;
        navigate(destination, { replace: true });
      } else {
        navigate('/app', { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [section, params.section, location.pathname, navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <LoadingState message="Redirecting…" />
    </div>
  );
}
