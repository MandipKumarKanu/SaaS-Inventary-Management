import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { CardDescription } from '@/components/ui/card';
import {
  Building2,
  Users,
  DollarSign,
  Activity,
  ShieldAlert,
  CreditCard,
  Ban,
  CheckCircle,
  RefreshCw,
  SlidersHorizontal,
  Tag,
  Bell,
  Settings,
  Download,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, LoadingState } from '@/components/common/DataTable';
import { SortableHead } from '@/components/common/SortableHead';
import { StatCard } from '@/components/common/StatCard';
import { StatusBadge } from '@/components/common/StatusBadge';
import { SearchFilterBar } from '@/components/common/SearchFilterBar';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';

export function SaaSAdminPortalPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const setActiveTab = (tab) => setSearchParams({ tab }, { replace: true });

  // Telemetry states
  const [overview, setOverview] = useState(null);
  const [health, setHealth] = useState(null);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);

  // Workspaces tab states
  const [workspaces, setWorkspaces] = useState([]);
  const [isWsLoading, setIsWsLoading] = useState(false);
  const [wsSearch, setWsSearch] = useState('');

  // Users tab states
  const [users, setUsers] = useState([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('');

  // Subscriptions tab states
  const [subscriptions, setSubscriptions] = useState([]);
  const [isSubLoading, setIsSubLoading] = useState(false);
  const [subStatusFilter, setSubStatusFilter] = useState('');
  const [subPlanFilter, setSubPlanFilter] = useState('');
  const [subSearch, setSubSearch] = useState('');

  // Audit logs tab states
  const [auditLogs, setAuditLogs] = useState([]);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');

  // §56 Payments tab states
  const [payments, setPayments] = useState([]);
  const [isPaymentsLoading, setIsPaymentsLoading] = useState(false);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('');
  const [paymentSort, setPaymentSort] = useState({ by: null, dir: null });

  // §63 Notifications tab states
  const [opsNotifications, setOpsNotifications] = useState({ failed_jobs: [], failed_webhooks: [] });
  const [isNotifsLoading, setIsNotifsLoading] = useState(false);
  const [jobStatuses, setJobStatuses] = useState([]);

  // §70 bulk-selection states
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [selectedCouponIds, setSelectedCouponIds] = useState([]);

  // §64 Settings tab states
  const [settings, setSettings] = useState([]);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [settingsStripeMode, setSettingsStripeMode] = useState(false);
  const [savingSettingKey, setSavingSettingKey] = useState(null);

  // §51 Plans tab states
  const [plans, setPlans] = useState([]);
  const [isPlansLoading, setIsPlansLoading] = useState(false);

  // §59 Analytics tab states
  const [analytics, setAnalytics] = useState(null);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [analyticsRange, setAnalyticsRange] = useState('30');

  const loadPlans = async () => {
    setIsPlansLoading(true);
    try {
      const res = await api.get('/admin/plans');
      setPlans(res.plans || res.data?.plans || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load plans');
    } finally {
      setIsPlansLoading(false);
    }
  };

  const handleTogglePlan = async (plan) => {
    try {
      await api.patch(`/admin/plans/${plan.id}`, { is_active: !plan.is_active });
      toast.success(`Plan ${plan.is_active ? 'deactivated' : 'activated'}`);
      await loadPlans();
    } catch (err) {
      toast.error(err.message || 'Failed to update plan');
    }
  };

  const handlePlanPriceChange = async (plan, field, value) => {
    const num = Number(value);
    if (Number.isNaN(num) || num < 0 || num === Number(plan[field])) return;
    try {
      await api.patch(`/admin/plans/${plan.id}`, { [field]: num });
      toast.success(`${plan.display_name} price updated`);
      await loadPlans();
    } catch (err) {
      toast.error(err.message || 'Failed to update plan');
    }
  };

  const loadAnalytics = async () => {
    setIsAnalyticsLoading(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - Number(analyticsRange) * 86400_000);
      const res = await api.get(`/admin/analytics?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
      setAnalytics(res.data || null);
    } catch (err) {
      toast.error(err.message || 'Failed to load analytics');
    } finally {
      setIsAnalyticsLoading(false);
    }
  };

  const handleExport = async (entity) => {
    try {
      const res = await api.get(`/admin/exports/${entity}`, { responseType: 'blob' });
      const blob = new Blob([res], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entity}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${entity} export downloaded`);
    } catch (err) {
      toast.error(err.message || 'Export failed');
    }
  };

  const loadPayments = async () => {
    setIsPaymentsLoading(true);
    try {
      const params = new URLSearchParams();
      if (paymentStatusFilter) params.append('status', paymentStatusFilter);
      if (paymentSort.by) {
        params.append('sortBy', paymentSort.by);
        params.append('sortDir', paymentSort.dir);
      }
      const res = await api.get(`/admin/payments?${params.toString()}`);
      setPayments(res.data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load payments');
    } finally {
      setIsPaymentsLoading(false);
    }
  };

  const handleRefund = async (payment) => {
    const reason = window.prompt(`Refund ${payment.currency} ${Number(payment.amount).toFixed(2)} to ${payment.workspace?.name || payment.workspace_id}?\nReason (required):`);
    if (!reason || reason.trim().length < 3) return;
    const password = promptPassword();
    if (!password) return;
    try {
      await api.post(`/admin/payments/${payment.id}/refund`, { reason: reason.trim() }, { headers: { 'x-admin-password': password } });
      toast.success('Refund issued');
      loadPayments();
    } catch (err) {
      toast.error(err.message || 'Refund failed');
    }
  };

  const loadNotifications = async () => {
    setIsNotifsLoading(true);
    try {
      const [notifsRes, jobsRes] = await Promise.allSettled([api.get('/admin/notifications'), api.get('/admin/jobs')]);
      if (notifsRes.status === 'fulfilled') {
        setOpsNotifications(notifsRes.value.data || { failed_jobs: [], failed_webhooks: [] });
      }
      if (jobsRes.status === 'fulfilled') {
        setJobStatuses(jobsRes.value.data?.jobs || []);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load notifications');
    } finally {
      setIsNotifsLoading(false);
    }
  };

  const handleWebhookRetry = async (event) => {
    try {
      const res = await api.post(`/admin/webhook-events/${event.id}/retry`);
      toast.success(`Retry result: ${res.data?.status || 'completed'}`);
      loadNotifications();
    } catch (err) {
      toast.error(err.message || 'Retry failed');
    }
  };

  // §66: dangerous ops demand the admin's password — prompted once, cached
  // server-side for 5 minutes, never stored client-side.
  const promptPassword = () => window.prompt('Re-enter your password to confirm this dangerous operation:');

  const handleBulkUsers = async (status) => {
    const ids = selectedUserIds;
    if (ids.length === 0) return;
    const password = promptPassword();
    if (!password) return;
    try {
      const res = await api.post('/admin/users/bulk-status', { ids, status }, { headers: { 'x-admin-password': password } });
      toast.success(`${res.data?.succeeded ?? 0} users ${status === 'suspended' ? 'suspended' : 'reactivated'}${res.data?.failed ? `, ${res.data.failed} failed` : ''}`);
      setSelectedUserIds([]);
      loadUsers();
    } catch (err) {
      toast.error(err.message || 'Bulk action failed');
    }
  };

  const handleBulkCoupons = async (active) => {
    const ids = selectedCouponIds;
    if (ids.length === 0) return;
    const password = promptPassword();
    if (!password) return;
    try {
      const res = await api.post('/admin/coupons/bulk-status', { ids, active }, { headers: { 'x-admin-password': password } });
      toast.success(`${res.data?.succeeded ?? 0} coupons ${active ? 'enabled' : 'disabled'}${res.data?.failed ? `, ${res.data.failed} failed` : ''}`);
      setSelectedCouponIds([]);
      await loadCoupons();
    } catch (err) {
      toast.error(err.message || 'Bulk action failed');
    }
  };

  const loadSettings = async () => {
    setIsSettingsLoading(true);
    try {
      const res = await api.get('/admin/settings');
      setSettings(res.data?.settings || []);
      setSettingsStripeMode(Boolean(res.data?.stripe_mode));
    } catch (err) {
      toast.error(err.message || 'Failed to load settings');
    } finally {
      setIsSettingsLoading(false);
    }
  };

  const handleSaveSetting = async (key, value) => {
    setSavingSettingKey(key);
    const password = promptPassword();
    if (!password) {
      setSavingSettingKey(null);
      return;
    }
    try {
      await api.patch(`/admin/settings/${key}`, { value }, { headers: { 'x-admin-password': password } });
      toast.success('Setting saved');
      await loadSettings();
    } catch (err) {
      toast.error(err.message || 'Failed to save setting');
    } finally {
      setSavingSettingKey(null);
    }
  };

  const loadOverview = async () => {
    setIsOverviewLoading(true);
    try {
      const [overviewRes, healthRes] = await Promise.allSettled([
        api.get('/admin/overview'),
        api.get('/monitoring/health'),
      ]);
      if (overviewRes.status === 'fulfilled') {
        setOverview(overviewRes.value.data);
      }
      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value.data || null);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load telemetry');
    } finally {
      setIsOverviewLoading(false);
    }
  };

  const loadWorkspaces = async () => {
    setIsWsLoading(true);
    try {
      const params = new URLSearchParams();
      if (wsSearch) params.append('search', wsSearch);
      const res = await api.get(`/admin/workspaces?${params.toString()}`);
      setWorkspaces(res.data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load tenant workspaces');
    } finally {
      setIsWsLoading(false);
    }
  };

  const loadUsers = async () => {
    setIsUsersLoading(true);
    try {
      const params = new URLSearchParams();
      if (userSearch) params.append('search', userSearch);
      if (userStatusFilter) params.append('status', userStatusFilter);
      const res = await api.get(`/admin/users?${params.toString()}`);
      setUsers(res.data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load platform users');
    } finally {
      setIsUsersLoading(false);
    }
  };

  const loadSubscriptions = async () => {
    setIsSubLoading(true);
    try {
      const params = new URLSearchParams();
      if (subStatusFilter) params.append('status', subStatusFilter);
      if (subPlanFilter) params.append('plan', subPlanFilter);
      if (subSearch) params.append('search', subSearch);
      const res = await api.get(`/admin/subscriptions?${params.toString()}`);
      setSubscriptions(res.subscriptions || res.data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load subscriptions');
    } finally {
      setIsSubLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    setIsAuditLoading(true);
    try {
      const params = new URLSearchParams();
      if (auditSearch) params.append('search', auditSearch);
      if (auditFrom) params.append('from', new Date(auditFrom).toISOString());
      if (auditTo) params.append('to', new Date(auditTo).toISOString());
      const res = await api.get(`/admin/audit-logs?${params.toString()}`);
      setAuditLogs(res.data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load security logs');
    } finally {
      setIsAuditLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  useEffect(() => {
    if (activeTab === 'workspaces') loadWorkspaces();
    else if (activeTab === 'users') loadUsers();
    else if (activeTab === 'subscriptions') loadSubscriptions();
    else if (activeTab === 'audit') loadAuditLogs();
    else if (activeTab === 'payments') loadPayments();
    else if (activeTab === 'notifications') loadNotifications();
    else if (activeTab === 'settings') loadSettings();
    else if (activeTab === 'plans') loadPlans();
    else if (activeTab === 'analytics') loadAnalytics();
  }, [activeTab, paymentStatusFilter, analyticsRange, subStatusFilter, subPlanFilter, userStatusFilter, auditFrom, auditTo, paymentSort]);

  const handleToggleWorkspaceStatus = async (id, currentStatus) => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      await api.patch(`/admin/workspaces/${id}/status`, { status: nextStatus });
      toast.success(`Workspace status updated to ${nextStatus}`);
      loadWorkspaces();
      loadOverview();
    } catch (err) {
      toast.error(err.message || 'Failed to update workspace status');
    }
  };

  const handleToggleUserStatus = async (userId, currentStatus) => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      await api.patch(`/admin/users/${userId}/status`, { status: nextStatus });
      toast.success(`User status updated to ${nextStatus}`);
      loadUsers();
      loadOverview();
    } catch (err) {
      toast.error(err.message || 'Failed to update user status');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SaaS Platform Admin & Telemetry Operations"
        description="Global multi-tenant monitoring, tenant suspension controls, platform user accounts, MRR telemetry, and security audit logs"
        actions={
          <Button variant="outline" size="sm" onClick={loadOverview} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh Telemetry
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Organizations / Workspaces"
          value={overview?.totalWorkspaces ?? '—'}
          icon={Building2}
          badge={overview ? `${overview.activeWorkspaces} active` : undefined}
          isLoading={isOverviewLoading}
        />
        <StatCard
          title="Total Platform Users"
          value={overview?.totalUsers != null ? `${overview.totalUsers}` : '—'}
          icon={Users}
          isLoading={isOverviewLoading}
        />
        <StatCard
          title="Monthly Recurring Revenue (MRR)"
          value={overview?.totalMRR != null ? `$${overview.totalMRR?.toLocaleString()}/mo` : '—'}
          icon={DollarSign}
          isLoading={isOverviewLoading}
        />
        <StatCard
          title="Platform Health Status"
          value={
            !health
              ? '—'
              : String(health.status || '').toLowerCase() === 'operational'
                ? 'Operational'
                : `Degraded (${health.status})`
          }
          icon={Activity}
          badge={
            health?.uptime_seconds != null
              ? `${Math.floor(health.uptime_seconds / 60)}m uptime`
              : undefined
          }
          isLoading={isOverviewLoading}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5 md:w-auto">
          <TabsTrigger value="overview" className="gap-2">
            <Activity className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="workspaces" className="gap-2">
            <Building2 className="h-4 w-4" />
            Tenants
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="subscriptions" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Subscriptions
          </TabsTrigger>
          <TabsTrigger value="coupons" className="gap-2">
            <Tag className="h-4 w-4" />
            Coupons
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-2">
            <DollarSign className="h-4 w-4" />
            Payments
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            Alerts
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="plans" className="gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Plans
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <Activity className="h-4 w-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <ShieldAlert className="h-4 w-4" />
            Security Audit
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="mt-6 flex flex-col gap-6">
          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b bg-muted/30">
              <CardTitle>Registered Tenant Organizations</CardTitle>
            </CardHeader>
            <DataTable
              head={
                <>
                  <TableHead>Workspace Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Status</TableHead>
                </>
              }
              isLoading={isOverviewLoading}
              isEmpty={!isOverviewLoading && (!overview?.workspaces || overview.workspaces.length === 0)}
              colSpan={4}
              columns={4}
            >
              {overview?.workspaces?.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-bold">
                    <span className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      {w.name}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">{w.slug}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {new Date(w.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={w.status} />
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </Card>
        </TabsContent>

        {/* WORKSPACES TAB */}
        <TabsContent value="workspaces" className="mt-6 flex flex-col gap-6">
          <SearchFilterBar
            searchValue={wsSearch}
            onSearchChange={(v) => {
              setWsSearch(v);
              loadWorkspaces();
            }}
            searchPlaceholder="Filter tenants by workspace name or slug…"
          />

          <Card className="overflow-hidden p-0">
            <DataTable
              head={
                <>
                  <TableHead>Organization Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </>
              }
              isLoading={isWsLoading}
              isEmpty={!isWsLoading && workspaces.length === 0}
              colSpan={7}
              columns={7}
            >
              {workspaces.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-extrabold">{w.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{w.slug}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{w.planName}</Badge>
                  </TableCell>
                  <TableCell>{w.memberCount} users</TableCell>
                  <TableCell>{w.productCount} products</TableCell>
                  <TableCell>
                    <StatusBadge status={w.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button asChild variant="outline" size="sm" className="gap-1.5">
                        <Link to={`/admin-portal/workspaces/${w.id}`}>
                          <SlidersHorizontal className="h-3.5 w-3.5" /> Details
                        </Link>
                      </Button>
                      <ConfirmDialog
                        title={`${w.status === 'active' ? 'Suspend' : 'Activate'} ${w.name}?`}
                      description={`Are you sure you want to ${w.status === 'active' ? 'suspend' : 'activate'} this organization? ${
                        w.status === 'active' ? 'Members will be blocked from logging in.' : 'Access will be restored.'
                      }`}
                      confirmLabel={`${w.status === 'active' ? 'Suspend Tenant' : 'Activate Tenant'}`}
                      destructive={w.status === 'active'}
                      onConfirm={() => handleToggleWorkspaceStatus(w.id, w.status)}
                      trigger={
                        <Button
                          variant={w.status === 'active' ? 'destructive' : 'outline'}
                          size="sm"
                          className="gap-1.5"
                        >
                          {w.status === 'active' ? (
                            <>
                              <Ban className="h-3.5 w-3.5" /> Suspend
                            </>
                          ) : (
                            <>
                              <CheckCircle className="h-3.5 w-3.5" /> Activate
                            </>
                          )}
                        </Button>
                      }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </Card>
        </TabsContent>

        {/* USERS TAB */}
        <TabsContent value="users" className="mt-6 flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <SearchFilterBar
              searchValue={userSearch}
              onSearchChange={(v) => {
                setUserSearch(v);
                loadUsers();
              }}
              searchPlaceholder="Search platform users by name or email…"
            />
            <select
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={userStatusFilter}
              onChange={(e) => setUserStatusFilter(e.target.value)}
              aria-label="Filter by account status"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
            {selectedUserIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{selectedUserIds.length} selected</span>
                <Button variant="outline" size="sm" onClick={() => handleBulkUsers('suspended')}>
                  Suspend selected
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleBulkUsers('active')}>
                  Reactivate selected
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedUserIds([])}>
                  Clear
                </Button>
              </div>
            )}
          </div>

          <Card className="overflow-hidden p-0">
            <DataTable
              head={
                <>
                  <TableHead className="w-8"> </TableHead>
                  <TableHead>User Account</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead>Joined Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </>
              }
              isLoading={isUsersLoading}
              isEmpty={!isUsersLoading && users.length === 0}
              colSpan={8}
              columns={8}
            >
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${u.email}`}
                      checked={selectedUserIds.includes(u.id)}
                      onChange={(e) =>
                        setSelectedUserIds((ids) => (e.target.checked ? [...ids, u.id] : ids.filter((id) => id !== u.id)))
                      }
                    />
                  </TableCell>
                  <TableCell className="font-bold">
                    <Link
                      to={`/admin-portal/users/${u.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {u.name || 'Unnamed User'}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    {u.is_platform_admin ? (
                      <Badge variant="destructive">Super Admin</Badge>
                    ) : (
                      <Badge variant="secondary">User</Badge>
                    )}
                  </TableCell>
                  <TableCell>{u.workspaceCount} memberships</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={u.status || 'active'} />
                  </TableCell>
                  <TableCell className="text-right">
                    <ConfirmDialog
                      title={`${u.status === 'suspended' ? 'Activate' : 'Suspend'} account ${u.email}?`}
                      description={`Are you sure you want to ${u.status === 'suspended' ? 'activate' : 'suspend'} this user account?`}
                      confirmLabel={u.status === 'suspended' ? 'Activate Account' : 'Suspend Account'}
                      destructive={u.status !== 'suspended'}
                      onConfirm={() => handleToggleUserStatus(u.id, u.status || 'active')}
                      trigger={
                        <Button
                          variant={u.status === 'suspended' ? 'outline' : 'ghost'}
                          size="sm"
                          className="gap-1.5"
                        >
                          {u.status === 'suspended' ? (
                            <>
                              <CheckCircle className="h-3.5 w-3.5" /> Activate
                            </>
                          ) : (
                            <>
                              <Ban className="h-3.5 w-3.5 text-destructive" /> Suspend
                            </>
                          )}
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </Card>
        </TabsContent>

        {/* SUBSCRIPTIONS TAB */}
        <TabsContent value="subscriptions" className="mt-6 flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={subStatusFilter}
              onChange={(e) => setSubStatusFilter(e.target.value)}
              aria-label="Filter by subscription status"
            >
              <option value="">All statuses</option>
              <option value="trialing">Trialing</option>
              <option value="active">Active</option>
              <option value="past_due">Past due</option>
              <option value="cancelled">Cancelled</option>
              <option value="suspended">Suspended</option>
            </select>
            <select
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={subPlanFilter}
              onChange={(e) => setSubPlanFilter(e.target.value)}
              aria-label="Filter by plan"
            >
              <option value="">All plans</option>
              {plans.map((p) => (
                <option key={p.id} value={p.name}>{p.display_name}</option>
              ))}
            </select>
            <SearchFilterBar
              searchValue={subSearch}
              onSearchChange={(v) => {
                setSubSearch(v);
                loadSubscriptions();
              }}
              searchPlaceholder="Search by workspace name…"
            />
          </div>
          <Card className="overflow-hidden p-0">
            <DataTable
              head={
                <>
                  <TableHead>Tenant Workspace</TableHead>
                  <TableHead>Plan Level</TableHead>
                  <TableHead>Monthly Rate</TableHead>
                  <TableHead>Billing Cycle</TableHead>
                  <TableHead>Subscription Status</TableHead>
                </>
              }
              isLoading={isSubLoading}
              isEmpty={!isSubLoading && subscriptions.length === 0}
              colSpan={5}
              columns={5}
            >
              {subscriptions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-bold">
                    {s.workspace?.id ? (
                      <Link
                        to={`/admin-portal/workspaces/${s.workspace.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {s.workspace?.name || 'Workspace'}
                      </Link>
                    ) : (
                      s.workspace?.name || 'Workspace'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{s.plan?.display_name || s.plan?.name || 'Standard'}</Badge>
                  </TableCell>
                  <TableCell className="font-mono font-bold">${s.plan?.price_monthly || 0}/mo</TableCell>
                  <TableCell className="capitalize">{s.billing_interval || 'monthly'}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </Card>
        </TabsContent>

        {/* COUPONS TAB (§52–§55) */}
        <TabsContent value="coupons" className="mt-6 flex flex-col gap-6">
          <CouponManagerPanel />
        </TabsContent>

        {/* PAYMENTS TAB (§56/§57) */}
        <TabsContent value="payments" className="mt-6 flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <select
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={paymentStatusFilter}
              onChange={(e) => setPaymentStatusFilter(e.target.value)}
              aria-label="Filter by payment status"
            >
              <option value="">All statuses</option>
              <option value="successful">Successful</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
              <option value="pending">Pending</option>
            </select>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleExport('subscriptions')}>
              <Download className="h-3.5 w-3.5" /> Export subscriptions
            </Button>
          </div>
          <Card className="overflow-hidden p-0">
            <DataTable
              head={
                <>
                  <TableHead>Workspace</TableHead>
                  <SortableHead label="Amount" field="amount" sort={paymentSort} onSort={(by, dir) => setPaymentSort({ by, dir })} />
                  <SortableHead label="Status" field="status" sort={paymentSort} onSort={(by, dir) => setPaymentSort({ by, dir })} />
                  <TableHead>Provider Ref</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Failure Reason</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </>
              }
              isLoading={isPaymentsLoading}
              isEmpty={!isPaymentsLoading && payments.length === 0}
              colSpan={8}
              columns={8}
            >
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.workspace?.id ? (
                      <Link to={`/admin-portal/workspaces/${p.workspace.id}`} className="underline-offset-4 hover:underline">
                        {p.workspace.name}
                      </Link>
                    ) : (
                      p.workspace?.name || '—'
                    )}
                  </TableCell>
                  <TableCell className="font-mono font-bold">
                    <Link to={`/admin-portal/payments/${p.id}`} className="underline-offset-4 hover:underline">
                      {p.currency} {Number(p.amount).toFixed(2)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.status === 'successful' ? 'success' : p.status === 'failed' ? 'destructive' : p.status === 'refunded' ? 'secondary' : 'outline'}>
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.provider_reference || '—'}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.invoice_id || '—'}</TableCell>
                  <TableCell className="max-w-48 truncate text-xs text-muted-foreground" title={p.failure_reason || ''}>{p.failure_reason || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {p.status === 'successful' && (
                      <Button variant="outline" size="sm" onClick={() => handleRefund(p)}>
                        Refund
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </Card>
        </TabsContent>

        {/* ALERTS / NOTIFICATIONS TAB (§63) */}
        <TabsContent value="notifications" className="mt-6 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Failed background jobs</CardTitle>
              <CardDescription>Job runs that ended in failure — investigate via the monitoring dashboard.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                head={
                  <>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Started</TableHead>
                  </>
                }
                isLoading={isNotifsLoading}
                isEmpty={!isNotifsLoading && opsNotifications.failed_jobs.length === 0}
                colSpan={4}
                columns={4}
              >
                {opsNotifications.failed_jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-mono text-xs font-bold">{j.job_name}</TableCell>
                    <TableCell><Badge variant="destructive">{j.status}</Badge></TableCell>
                    <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={j.error || ''}>{j.error || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(j.executed_at || j.started_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Failed webhooks</CardTitle>
              <CardDescription>Stripe webhook events that failed processing. Retry re-dispatches the stored payload through the idempotent handler — it can never double-process.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                head={
                  <>
                    <TableHead>Event</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </>
                }
                isLoading={isNotifsLoading}
                isEmpty={!isNotifsLoading && opsNotifications.failed_webhooks.length === 0}
                colSpan={8}
                columns={8}
              >
                {opsNotifications.failed_webhooks.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-xs">
                      <Link to={`/admin-portal/webhook-events/${w.id}`} className="underline-offset-4 hover:underline">
                        {w.event_id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{w.event_type}</TableCell>
                    <TableCell><Badge variant="destructive">{w.processing_status}</Badge></TableCell>
                    <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={w.detail || ''}>{w.detail || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{w.processing_duration_ms != null ? `${w.processing_duration_ms} ms` : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{w.delivery_attempt ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(w.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleWebhookRetry(w)}>
                        Retry
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Background jobs (§62)</CardTitle>
              <CardDescription>Per-job status across the worker cycle: last run, outcome, failures.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                head={
                  <>
                    <TableHead>Job</TableHead>
                    <TableHead>Last status</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Failures</TableHead>
                    <TableHead>Total runs</TableHead>
                    <TableHead>Last error</TableHead>
                  </>
                }
                isLoading={isNotifsLoading}
                isEmpty={!isNotifsLoading && jobStatuses.length === 0}
                colSpan={7}
                columns={7}
              >
                {jobStatuses.map((j) => (
                  <TableRow key={j.job_name}>
                    <TableCell className="font-mono text-xs font-bold">{j.job_name}</TableCell>
                    <TableCell>
                      <Badge variant={j.last_status === 'success' ? 'success' : 'destructive'}>{j.last_status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(j.last_run).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{j.last_duration_ms != null ? `${j.last_duration_ms} ms` : '—'}</TableCell>
                    <TableCell className={j.failure_count > 0 ? 'font-bold text-destructive' : ''}>{j.failure_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{j.total_runs}</TableCell>
                    <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={j.last_error || ''}>{j.last_error || '—'}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PLATFORM SETTINGS TAB (§64) */}
        <TabsContent value="settings" className="mt-6 flex flex-col gap-6">
          <SettingsPanel
            settings={settings}
            isLoading={isSettingsLoading}
            stripeMode={settingsStripeMode}
            savingKey={savingSettingKey}
            onSave={handleSaveSetting}
            onExport={handleExport}
          />
        </TabsContent>

        {/* PLANS TAB (§34/§51) */}
        <TabsContent value="plans" className="mt-6 flex flex-col gap-6">
          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b bg-muted/30">
              <CardTitle>Subscription Plans</CardTitle>
              <CardDescription>
                Pricing and entitlement edits apply going forward; historical subscriptions and billing rows keep their plan references.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                head={
                  <>
                    <TableHead>Plan</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Price / mo</TableHead>
                    <TableHead>Price / yr</TableHead>
                    <TableHead>Key limits</TableHead>
                    <TableHead>Key features</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </>
                }
                isLoading={isPlansLoading}
                isEmpty={!isPlansLoading && plans.length === 0}
                colSpan={8}
                columns={8}
              >
                {plans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-bold">{p.display_name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.name}</TableCell>
                    <TableCell>
                      <input
                        className="h-8 w-20 rounded-md border border-input bg-background px-2 font-mono text-xs"
                        type="number"
                        min="0"
                        defaultValue={Number(p.price_monthly)}
                        onBlur={(e) => handlePlanPriceChange(p, 'price_monthly', e.target.value)}
                        aria-label={`${p.display_name} monthly price`}
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        className="h-8 w-20 rounded-md border border-input bg-background px-2 font-mono text-xs"
                        type="number"
                        min="0"
                        defaultValue={Number(p.price_annual)}
                        onBlur={(e) => handlePlanPriceChange(p, 'price_annual', e.target.value)}
                        aria-label={`${p.display_name} annual price`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.limits?.users ?? '—'} users · {p.limits?.products ?? '—'} products
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {Object.entries(p.features || {})
                        .filter(([, v]) => v)
                        .map(([k]) => k.replace(/_/g, ' '))
                        .slice(0, 3)
                        .join(', ') || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? 'success' : 'secondary'}>{p.is_active ? 'active' : 'inactive'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <ConfirmDialog
                        title={`${p.is_active ? 'Deactivate' : 'Activate'} ${p.display_name}?`}
                        description={
                          p.is_active
                            ? 'The plan disappears from upgrade flows. Existing subscriptions keep their entitlements.'
                            : 'The plan becomes available for checkout and upgrades again.'
                        }
                        confirmLabel={p.is_active ? 'Deactivate' : 'Activate'}
                        destructive={p.is_active}
                        onConfirm={() => handleTogglePlan(p)}
                        trigger={
                          <Button variant={p.is_active ? 'outline' : 'default'} size="sm">
                            {p.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ANALYTICS TAB (§59) */}
        <TabsContent value="analytics" className="mt-6 flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <select
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={analyticsRange}
              onChange={(e) => setAnalyticsRange(e.target.value)}
              aria-label="Analytics date range"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last 365 days</option>
            </select>
          </div>

          {analytics && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="New users" value={analytics.growth?.new_users} icon={Users} isLoading={isAnalyticsLoading} />
                <StatCard title="New workspaces" value={analytics.growth?.new_workspaces} icon={Building2} isLoading={isAnalyticsLoading} />
                <StatCard title="New subscriptions" value={analytics.growth?.new_subscriptions} icon={CreditCard} isLoading={isAnalyticsLoading} />
                <StatCard title="Trial starts" value={analytics.growth?.trial_starts} icon={Activity} isLoading={isAnalyticsLoading} />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Subscription lifecycle</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-muted-foreground">Upgrades:</span> <span className="font-bold">{analytics.subscriptions?.upgrades ?? 0}</span></div>
                    <div><span className="text-muted-foreground">Downgrades:</span> <span className="font-bold">{analytics.subscriptions?.downgrades ?? 0}</span></div>
                    <div><span className="text-muted-foreground">Cancellations:</span> <span className="font-bold">{analytics.subscriptions?.cancellations ?? 0}</span></div>
                    <div><span className="text-muted-foreground">Reactivations:</span> <span className="font-bold">{analytics.subscriptions?.reactivations ?? 0}</span></div>
                    <div><span className="text-muted-foreground">Expirations:</span> <span className="font-bold">{analytics.subscriptions?.expirations ?? 0}</span></div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Coupons</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <div><span className="text-muted-foreground">Redemptions:</span> <span className="font-bold">{analytics.coupons?.redemptions ?? 0}</span></div>
                    <div>
                      <span className="text-muted-foreground">Discount total:</span>{' '}
                      <span className="font-bold">${Number(analytics.coupons?.discount_total ?? 0).toFixed(2)}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Active plan distribution</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm">
                    {Object.entries(analytics.plans?.active_distribution || {}).map(([name, count]) => (
                      <div key={name} className="flex items-center justify-between">
                        <span className="capitalize">{name}</span>
                        <span className="font-bold">{count}</span>
                      </div>
                    ))}
                    {Object.keys(analytics.plans?.active_distribution || {}).length === 0 && (
                      <div className="text-sm text-muted-foreground">No active subscriptions in range.</div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Payments by status</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm">
                    {Object.entries(analytics.billing?.by_status || {}).map(([status, info]) => (
                      <div key={status} className="flex items-center justify-between">
                        <span className="capitalize">{status}</span>
                        <span className="font-bold">
                          {info.count} · ${Number(info.amount).toFixed(2)}
                        </span>
                      </div>
                    ))}
                    {Object.keys(analytics.billing?.by_status || {}).length === 0 && (
                      <div className="text-sm text-muted-foreground">No payments in range.</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* SECURITY AUDIT TAB */}
        <TabsContent value="audit" className="mt-6 flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <SearchFilterBar
              searchValue={auditSearch}
              onSearchChange={(v) => {
                setAuditSearch(v);
                loadAuditLogs();
              }}
              searchPlaceholder="Search audit log actions, entities, or users…"
            />
            <input
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              type="date"
              value={auditFrom}
              onChange={(e) => setAuditFrom(e.target.value)}
              aria-label="Audit logs from date"
            />
            <input
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              type="date"
              value={auditTo}
              onChange={(e) => setAuditTo(e.target.value)}
              aria-label="Audit logs to date"
            />
            {(auditFrom || auditTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAuditFrom('');
                  setAuditTo('');
                  setTimeout(loadAuditLogs, 0);
                }}
              >
                Clear dates
              </Button>
            )}
          </div>

          <Card className="overflow-hidden p-0">
            <DataTable
              head={
                <>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User Account</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Workspace</TableHead>
                </>
              }
              isLoading={isAuditLoading}
              isEmpty={!isAuditLoading && auditLogs.length === 0}
              colSpan={5}
              columns={5}
            >
              {auditLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{log.user?.email || 'System'}</TableCell>
                  <TableCell className="font-mono text-xs font-bold text-primary">
                    <Link to={`/admin-portal/audit-events/${log.id}`} className="underline-offset-4 hover:underline">
                      {log.action}
                    </Link>
                  </TableCell>
                  <TableCell>{log.entity}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {log.workspace?.name || 'Global'}
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================
// Coupon management panel (PRD §52–§55)
// Create, generate bulk codes, list, enable/disable.
// Server enforces permissions; this is UX only (§65).
// ============================================

function CouponManagerPanel() {
  const [coupons, setCoupons] = useState([]);
  const [selectedCouponIds, setSelectedCouponIds] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  // §55 redemption history drill-down
  const [redemptionsFor, setRedemptionsFor] = useState(null);
  const [redemptions, setRedemptions] = useState([]);
  const [isRedemptionsLoading, setIsRedemptionsLoading] = useState(false);
  const [form, setForm] = useState({
    code: '', description: '', discount_type: 'PERCENTAGE', discount_value: 10,
    target_plan_name: '', applies_to: 'upgrades', duration: 'ONE_TIME',
    duration_in_months: '', starts_at: '', expires_at: '',
    max_redemptions: '', max_redemptions_per_user: '', max_redemptions_per_workspace: '',
  });
  const [genForm, setGenForm] = useState({ prefix: 'PROMO', length: 10, count: 5 });
  const [generatedCodes, setGeneratedCodes] = useState([]);

  const loadCoupons = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      const res = await api.get(`/admin/coupons?${params.toString()}`);
      setCoupons(res.data || res.coupons || []);
      // response is { success, coupons, total } — handle both shapes
      if (Array.isArray(res)) setCoupons(res);
    } catch (err) {
      toast.error(err.message || 'Failed to load coupons');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCoupons();
  }, [statusFilter]);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      await api.post('/admin/coupons', {
        code: form.code.trim(),
        description: form.description || null,
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        target_plan_name: form.target_plan_name || null,
        applies_to: form.applies_to,
        duration: form.duration,
        duration_in_months: form.duration === 'MULTI_MONTH' && form.duration_in_months ? Number(form.duration_in_months) : null,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
        max_redemptions_per_user: form.max_redemptions_per_user ? Number(form.max_redemptions_per_user) : null,
        max_redemptions_per_workspace: form.max_redemptions_per_workspace ? Number(form.max_redemptions_per_workspace) : null,
      });
      toast.success(`Coupon ${form.code.toUpperCase()} created`);
      setForm((f) => ({ ...f, code: '', description: '' }));
      await loadCoupons();
    } catch (err) {
      toast.error(err.message || 'Failed to create coupon');
    } finally {
      setIsCreating(false);
    }
  };

  const handleGenerate = async () => {
    try {
      const res = await api.post('/admin/coupons/generate', genForm);
      setGeneratedCodes(res.codes || res.data?.codes || []);
      toast.success(`${generatedCodes.length + (res.codes?.length ?? 0)} codes generated`);
    } catch (err) {
      toast.error(err.message || 'Code generation failed');
    }
  };

  const handleToggle = async (coupon) => {
    try {
      await api.patch(`/admin/coupons/${coupon.id}`, { active: !coupon.active });
      await loadCoupons();
    } catch (err) {
      toast.error(err.message || 'Failed to update coupon');
    }
  };

  const handleBulkCoupons = async (active) => {
    if (selectedCouponIds.length === 0) return;
    try {
      await Promise.all(
        selectedCouponIds.map((id) => api.patch(`/admin/coupons/${id}`, { active }))
      );
      toast.success(`${selectedCouponIds.length} coupons ${active ? 'enabled' : 'disabled'}`);
      setSelectedCouponIds([]);
      await loadCoupons();
    } catch (err) {
      toast.error(err.message || 'Bulk update failed');
    }
  };

  const loadRedemptions = async (coupon) => {
    setRedemptionsFor(coupon);
    setIsRedemptionsLoading(true);
    try {
      const res = await api.get(`/admin/coupons/${coupon.id}/redemptions?page=1&pageSize=50`);
      setRedemptions(res.redemptions || res.data?.redemptions || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load redemptions');
      setRedemptions([]);
    } finally {
      setIsRedemptionsLoading(false);
    }
  };

  const statusBadgeVariant = (status) =>
    status === 'active' ? 'success' : status === 'disabled' ? 'secondary' : status === 'expired' || status === 'exhausted' ? 'destructive' : 'outline';

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create coupon</CardTitle>
            <CardDescription>Discounts are validated server-side; amounts are never trusted from the client at redemption.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" placeholder="CODE" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} aria-label="Coupon code" />
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} aria-label="Coupon description" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })} aria-label="Discount type">
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED_AMOUNT">Fixed amount</option>
                <option value="FULL_DISCOUNT">Full discount (100%)</option>
                <option value="PLAN_ACCESS">Plan access</option>
              </select>
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" type="number" min="0" placeholder="Value" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} aria-label="Discount value" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <select className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" value={form.applies_to} onChange={(e) => setForm({ ...form, applies_to: e.target.value })} aria-label="Applies to">
                <option value="new_subscriptions">New subscriptions</option>
                <option value="upgrades">Upgrades</option>
                <option value="renewals">Renewals</option>
                <option value="reactivations">Reactivations</option>
                <option value="any">Any operation</option>
              </select>
              <select className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} aria-label="Duration">
                <option value="ONE_TIME">One time</option>
                <option value="FIRST_PERIOD">First period</option>
                <option value="MULTI_MONTH">Multi month</option>
              </select>
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" type="number" min="1" max="36" placeholder="Months" value={form.duration_in_months} onChange={(e) => setForm({ ...form, duration_in_months: e.target.value })} aria-label="Duration months" disabled={form.duration !== 'MULTI_MONTH'} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} aria-label="Starts at" />
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} aria-label="Expires at" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" type="number" min="1" placeholder="Max total" value={form.max_redemptions} onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })} aria-label="Max total redemptions" />
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" type="number" min="1" placeholder="Max per user" value={form.max_redemptions_per_user} onChange={(e) => setForm({ ...form, max_redemptions_per_user: e.target.value })} aria-label="Max per user" />
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" type="number" min="1" placeholder="Max per workspace" value={form.max_redemptions_per_workspace} onChange={(e) => setForm({ ...form, max_redemptions_per_workspace: e.target.value })} aria-label="Max per workspace" />
            </div>
            <Button onClick={handleCreate} disabled={isCreating || !form.code.trim()} className="justify-self-start">
              Create coupon
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Bulk code generator</CardTitle>
            <CardDescription>Cryptographically random, unique codes. Apply plan/limits per batch after creation.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" placeholder="Prefix" value={genForm.prefix} onChange={(e) => setGenForm({ ...genForm, prefix: e.target.value.toUpperCase() })} aria-label="Code prefix" />
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" type="number" min="6" max="24" value={genForm.length} onChange={(e) => setGenForm({ ...genForm, length: Number(e.target.value) })} aria-label="Code length" />
              <input className="flex h-9 rounded-md border border-input bg-background px-3 text-sm" type="number" min="1" max="500" value={genForm.count} onChange={(e) => setGenForm({ ...genForm, count: Number(e.target.value) })} aria-label="Number of codes" />
            </div>
            <Button variant="secondary" onClick={handleGenerate} className="justify-self-start">Generate codes</Button>
            {generatedCodes.length > 0 && (
              <textarea
                className="min-h-24 rounded-md border border-input bg-background p-3 font-mono text-xs"
                readOnly
                value={generatedCodes.join('\n')}
                aria-label="Generated codes"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <SearchFilterBar
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          loadCoupons();
        }}
        searchPlaceholder="Search coupons by code or description…"
      />

      {selectedCouponIds.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{selectedCouponIds.length} selected</span>
          <Button variant="outline" size="sm" onClick={() => handleBulkCoupons(false)}>
            Disable selected
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleBulkCoupons(true)}>
            Enable selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedCouponIds([])}>
            Clear
          </Button>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <DataTable
          head={
            <>
              <TableHead className="w-8"> </TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Applies to</TableHead>
              <TableHead>Redemptions</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Actions</TableHead>
            </>
          }
          isLoading={isLoading}
          isEmpty={!isLoading && coupons.length === 0}
          colSpan={8}
          columns={8}
        >
          {coupons.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <input
                  type="checkbox"
                  aria-label={`Select ${c.code}`}
                  checked={selectedCouponIds.includes(c.id)}
                  onChange={(e) =>
                    setSelectedCouponIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id)))
                  }
                />
              </TableCell>
              <TableCell className="font-mono font-bold">{c.code}</TableCell>
              <TableCell>
                {c.discount_type === 'PERCENTAGE' ? `${Number(c.discount_value)}%` : c.discount_type === 'FIXED_AMOUNT' ? `${c.currency} ${Number(c.discount_value)}` : c.discount_type.replace('_', ' ')}
              </TableCell>
              <TableCell className="text-xs">{(c.applies_to || '').replace(/_/g, ' ')}</TableCell>
              <TableCell className="font-mono text-xs">
                {c.current_redemptions}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}
              </TableCell>
              <TableCell><Badge variant={statusBadgeVariant(c.status)}>{c.status}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}</TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => loadRedemptions(c)}>
                    History
                  </Button>
                  <Button variant={c.active ? 'outline' : 'default'} size="sm" onClick={() => handleToggle(c)}>
                    {c.active ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </Card>

      {/* §55 redemption history drill-down */}
      {redemptionsFor && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">
                  Redemptions — <span className="font-mono">{redemptionsFor.code}</span>
                </CardTitle>
                <CardDescription>
                  {redemptionsFor.current_redemptions} total
                  {redemptionsFor.max_redemptions ? ` of ${redemptionsFor.max_redemptions}` : ''} redeemed
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setRedemptionsFor(null); setRedemptions([]); }}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              head={
                <>
                  <TableHead>Workspace</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead>Original</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Final</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </>
              }
              isLoading={isRedemptionsLoading}
              isEmpty={!isRedemptionsLoading && redemptions.length === 0}
              colSpan={8}
              columns={8}
            >
              {redemptions.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.workspaces?.name || r.workspace_id}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.users?.email || r.user_id}</TableCell>
                  <TableCell className="text-xs">{(r.operation || '').replace(/_/g, ' ')}</TableCell>
                  <TableCell className="font-mono text-xs">{r.currency} {Number(r.original_amount).toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-xs text-green-600">-{r.currency} {Number(r.discount_amount).toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.currency} {Number(r.final_amount).toFixed(2)}</TableCell>
                  <TableCell><Badge variant={r.status === 'applied' ? 'success' : 'destructive'}>{r.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.redeemed_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** §64 platform settings — config_defaults management + §71 exports. */
function SettingsPanel({ settings, isLoading, stripeMode, savingKey, onSave, onExport }) {
  const [drafts, setDrafts] = useState({});

  const renderInput = (s) => {
    const draft = drafts[s.key] ?? (s.type === 'json' ? JSON.stringify(s.value) : String(s.value ?? ''));
    const onChange = (v) => setDrafts((d) => ({ ...d, [s.key]: v }));
    if (s.type === 'json') {
      return (
        <textarea
          className="min-h-16 rounded-md border border-input bg-background p-2 font-mono text-xs"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          aria-label={s.label}
        />
      );
    }
    return (
      <input
        className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
        type={s.type === 'number' ? 'number' : 'text'}
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        aria-label={s.label}
      />
    );
  };

  const serialize = (s) => {
    const draft = drafts[s.key];
    if (draft === undefined) return undefined; // unchanged
    if (s.type === 'number') return Number(draft);
    if (s.type === 'json') {
      try { return JSON.parse(draft); } catch { return draft; } // server re-validates
    }
    return draft;
  };

  if (isLoading) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Loading settings…</CardContent></Card>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Platform defaults</CardTitle>
          <CardDescription>
            Operational defaults live in the database and take effect immediately (no deploy).
            {stripeMode ? ' Stripe billing is active: plan changes route through Stripe checkout.' : ' Native (dev) billing mode: plan changes are applied directly.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {settings.map((s) => {
            const value = serialize(s);
            const dirty = value !== undefined && JSON.stringify(value) !== JSON.stringify(s.value);
            return (
              <div key={s.key} className="grid items-start gap-2 md:grid-cols-[1fr_320px_auto]">
                <div>
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="font-mono text-xs text-muted-foreground">{s.key}</div>
                </div>
                {renderInput(s)}
                <Button
                  size="sm"
                  disabled={!dirty || savingKey === s.key}
                  onClick={() => onSave(s.key, value)}
                >
                  {savingKey === s.key ? 'Saving…' : 'Save'}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Exports</CardTitle>
          <CardDescription>CSV downloads, capped at 10,000 rows, gated by the same permissions as each list.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {['users', 'workspaces', 'subscriptions', 'coupons'].map((entity) => (
            <Button key={entity} variant="outline" size="sm" className="gap-1.5" onClick={() => onExport(entity)}>
              <Download className="h-3.5 w-3.5" /> Export {entity}
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
