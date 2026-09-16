import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreateRoleModal } from './CreateRoleModal';
import { Shield, Plus, Trash2, Check } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LoadingState } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/components/ui/sonner';

export function RolesPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [roles, setRoles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadRoles = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/roles`);
      setRoles(res.data || []);
    } catch (err) {
      console.error('Failed to load workspace roles:', err);
      setError(err.message || 'Failed to load roles');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, [activeWorkspace]);

  const handleDeleteRole = async (roleId) => {
    try {
      await api.delete(`/workspaces/${activeWorkspace.id}/roles/${roleId}`);
      loadRoles();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roles & Granular Permissions"
        description={`Configure custom role-based access control (RBAC) policies for ${activeWorkspace?.name}`}
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Custom Role
          </Button>
        }
      />

      {isLoading ? (
        <LoadingState message="Loading roles..." />
      ) : error ? (
        <ErrorState description={error} onRetry={loadRoles} />
      ) : roles.length === 0 ? (
        <EmptyState
          title="No roles configured yet."
          description="Create a custom role to grant fine-grained permissions to your team."
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id} className="flex flex-col justify-between">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Shield className="h-[18px] w-[18px]" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold">{role.name}</h3>
                      <Badge variant={role.is_system ? 'default' : 'warning'} className="mt-1">
                        {role.is_system ? 'System Role' : 'Custom Policy'}
                      </Badge>
                    </div>
                  </div>

                  {!role.is_system && (
                    <ConfirmDialog
                      title="Delete this custom role?"
                      description="Are you sure you want to delete this custom role?"
                      confirmLabel="Delete"
                      onConfirm={() => handleDeleteRole(role.id)}
                      trigger={
                        <Button variant="destructive" size="sm" title="Delete Role">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-[13px] text-muted-foreground">
                  {role.description || 'Custom access role for workspace operations.'}
                </p>
                <Separator />
                <div className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                  Permissions ({role.permissions?.length || 0})
                </div>
                <div className="flex max-h-25 flex-wrap gap-1.5 overflow-y-auto">
                  {role.permissions?.length ? (
                    role.permissions.map((p) => {
                      // API returns permission objects {id, code, ...}; be
                      // tolerant of plain code strings too.
                      const key = typeof p === 'string' ? p : (p.id ?? p.code);
                      const label = typeof p === 'string' ? p : (p.code ?? '');
                      return (
                        <Badge key={key} variant="secondary" className="text-[10px] normal-case">
                          <Check className="h-2.5 w-2.5 text-success" />
                          {label}
                        </Badge>
                      );
                    })
                  ) : (
                    <span className="text-xs text-muted-foreground">Full workspace access</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isModalOpen && (
        <CreateRoleModal
          onClose={() => setIsModalOpen(false)}
          onRoleCreated={loadRoles}
        />
      )}
    </div>
  );
}
