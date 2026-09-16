import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
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
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, LoadingState } from '@/components/common/DataTable';
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
  const [activeTab, setActiveTab] = useState('overview');

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

  // Subscriptions tab states
  const [subscriptions, setSubscriptions] = useState([]);
  const [isSubLoading, setIsSubLoading] = useState(false);

  // Audit logs tab states
  const [auditLogs, setAuditLogs] = useState([]);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');

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
      const res = await api.get('/admin/subscriptions');
      setSubscriptions(res.data || []);
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
  }, [activeTab]);

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
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </Card>
        </TabsContent>

        {/* USERS TAB */}
        <TabsContent value="users" className="mt-6 flex flex-col gap-6">
          <SearchFilterBar
            searchValue={userSearch}
            onSearchChange={(v) => {
              setUserSearch(v);
              loadUsers();
            }}
            searchPlaceholder="Search platform users by name or email…"
          />

          <Card className="overflow-hidden p-0">
            <DataTable
              head={
                <>
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
              colSpan={7}
              columns={7}
            >
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-bold">{u.name || 'Unnamed User'}</TableCell>
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
                  <TableCell className="font-bold">{s.workspace?.name || 'Workspace'}</TableCell>
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

        {/* SECURITY AUDIT TAB */}
        <TabsContent value="audit" className="mt-6 flex flex-col gap-6">
          <SearchFilterBar
            searchValue={auditSearch}
            onSearchChange={(v) => {
              setAuditSearch(v);
              loadAuditLogs();
            }}
            searchPlaceholder="Search audit log actions, entities, or users…"
          />

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
                  <TableCell className="font-mono text-xs text-primary font-bold">{log.action}</TableCell>
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
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreating, setIsCreating] = useState(false);
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

      <Card className="overflow-hidden p-0">
        <DataTable
          head={
            <>
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
          colSpan={7}
          columns={7}
        >
          {coupons.map((c) => (
            <TableRow key={c.id}>
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
                <Button variant={c.active ? 'outline' : 'default'} size="sm" onClick={() => handleToggle(c)}>
                  {c.active ? 'Disable' : 'Enable'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </Card>
    </div>
  );
}
