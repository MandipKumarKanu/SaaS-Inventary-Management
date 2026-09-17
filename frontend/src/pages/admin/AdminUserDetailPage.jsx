import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { api } from '../../lib/api';
import { ArrowLeft, RefreshCw, Building2, CreditCard, History } from 'lucide-react';
import { DataTable } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';

/**
 * Admin user detail (PRD §44/§45): profile, workspace memberships with
 * roles, related subscriptions, recent activity, and the suspend/reactivate
 * action with confirmation. Never renders secrets — the API selects only
 * safe profile fields.
 */
export function AdminUserDetailPage() {
  const { userId } = useParams();
  const [detail, setDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/admin/users/${userId}`);
      setDetail(res.data || null);
    } catch (err) {
      setError(err.message || 'Failed to load user');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleStatus = async () => {
    if (!detail?.user) return;
    const next = detail.user.status === 'suspended' ? 'active' : 'suspended';
    try {
      await api.patch(`/admin/users/${detail.user.id}/status`, { status: next });
      toast.success(`User ${next === 'active' ? 'reactivated' : 'suspended'}`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to update user status');
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <p className="text-sm text-destructive">{error || 'User not found'}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin-portal">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to portal
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const { user, memberships, subscriptions, recent_activity: recentActivity } = detail;
  const suspended = user.status === 'suspended';

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
            <Link to="/admin-portal">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Admin portal
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{user.name || 'Unnamed User'}</h1>
          <p className="font-mono text-sm text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={user.status || 'active'} />
          <ConfirmDialog
            title={`${suspended ? 'Reactivate' : 'Suspend'} ${user.email}?`}
            description={
              suspended
                ? 'The account will regain access to its workspaces.'
                : 'The account will be blocked from logging in across all workspaces.'
            }
            confirmLabel={suspended ? 'Reactivate Account' : 'Suspend Account'}
            destructive={!suspended}
            onConfirm={handleToggleStatus}
            trigger={
              <Button variant={suspended ? 'default' : 'destructive'} size="sm">
                {suspended ? 'Reactivate' : 'Suspend'}
              </Button>
            }
          />
        </div>
      </div>

      {/* Profile card (§44) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Account status:</span>{' '}
            <span className="font-medium capitalize">{user.status || 'active'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Platform admin:</span>{' '}
            {user.is_platform_admin ? <Badge variant="destructive">Yes</Badge> : <Badge variant="secondary">No</Badge>}
          </div>
          <div>
            <span className="text-muted-foreground">Created:</span>{' '}
            <span className="font-medium">{new Date(user.created_at).toLocaleString()}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Last login:</span>{' '}
            <span className="font-medium">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '—'}</span>
          </div>
        </CardContent>
      </Card>

      {/* Memberships (§44) */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b bg-muted/30">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-4 w-4" /> Workspace memberships
          </CardTitle>
          <CardDescription>{memberships.length} workspace{memberships.length === 1 ? '' : 's'}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            head={
              <>
                <TableHead>Workspace</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Membership status</TableHead>
                <TableHead>Workspace status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </>
            }
            isLoading={false}
            isEmpty={memberships.length === 0}
            emptyDescription="This user has no workspace memberships."
            colSpan={6}
            columns={6}
          >
            {memberships.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">
                  {m.workspace?.id ? (
                    <Link
                      to={`/admin-portal/workspaces/${m.workspace.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {m.workspace.name}
                    </Link>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>{m.role_name ? <Badge variant="outline">{m.role_name}</Badge> : '—'}</TableCell>
                <TableCell><StatusBadge status={m.status || 'active'} /></TableCell>
                <TableCell>{m.workspace ? <StatusBadge status={m.workspace.status} /> : '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  {m.workspace?.id && (
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/admin-portal/workspaces/${m.workspace.id}`}>View workspace</Link>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>

      {/* Subscriptions across the user's workspaces (§44) */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b bg-muted/30">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="h-4 w-4" /> Related subscriptions
          </CardTitle>
          <CardDescription>Subscriptions on workspaces this user belongs to</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            head={
              <>
                <TableHead>Workspace</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Current period end</TableHead>
              </>
            }
            isLoading={false}
            isEmpty={subscriptions.length === 0}
            emptyDescription="No subscriptions on the user's workspaces."
            colSpan={5}
            columns={5}
          >
            {subscriptions.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  {s.workspace_id ? (
                    <Link to={`/admin-portal/workspaces/${s.workspace_id}`} className="underline-offset-4 hover:underline">
                      {memberships.find((m) => m.workspace?.id === s.workspace_id)?.workspace?.name || s.workspace_id}
                    </Link>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell><Badge variant="outline">{s.plan?.display_name || s.plan?.name || '—'}</Badge></TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell className="capitalize">{s.billing_interval || 'monthly'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : '—'}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>

      {/* Recent activity (§44 audit) */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b bg-muted/30">
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-4 w-4" /> Recent activity
          </CardTitle>
          <CardDescription>Latest audit rows attributed to this user</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            head={
              <>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>When</TableHead>
              </>
            }
            isLoading={false}
            isEmpty={recentActivity.length === 0}
            emptyDescription="No recent activity for this user."
            colSpan={3}
            columns={3}
          >
            {recentActivity.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-mono text-xs font-medium">{a.action}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {a.entity}{a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}…` : ''}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminUserDetailPage;
