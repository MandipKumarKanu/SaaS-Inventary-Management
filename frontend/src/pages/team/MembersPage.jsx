import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { InviteMemberModal } from './InviteMemberModal';
import {
  Users,
  UserPlus,
  Mail,
  Trash2,
  Shield,
  Search,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { toast } from '@/components/ui/sonner';

export function MembersPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [activeTab, setActiveTab] = useState('members'); // 'members' | 'invitations'
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const { page, pageSize, total, totalPages, applyMeta, setPage } = usePagination();
  const [searchQuery, setSearchQuery] = useState('');
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  const loadData = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const [membersRes, invRes] = await Promise.all([
        api.get(`/workspaces/${activeWorkspace.id}/members?page=${page}&pageSize=${pageSize}`),
        api.get(`/workspaces/${activeWorkspace.id}/invitations`),
      ]);
      setMembers(membersRes.data || []);
      applyMeta(membersRes.meta);
      setInvitations(invRes.data || []);
    } catch (err) {
      console.error('Failed to load team members data:', err);
      setError(err.message || 'Failed to load team members data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeWorkspace, page]);

  const handleRevokeInvite = async (invitationId) => {
    try {
      await api.delete(`/workspaces/${activeWorkspace.id}/invitations/${invitationId}`);
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRemoveMember = async (memberId) => {
    try {
      await api.delete(`/workspaces/${activeWorkspace.id}/members/${memberId}`);
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const filteredMembers = members.filter((m) =>
    (m.user?.name || m.user?.email || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredInvitations = invitations.filter((inv) =>
    inv.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team & Members"
        description={`Manage access control and team invitations for ${activeWorkspace?.name}`}
        actions={
          <Button onClick={() => setIsInviteModalOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Invite Member
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="members">
              <Users className="h-3.5 w-3.5" />
              Active Members ({members.length})
            </TabsTrigger>
            <TabsTrigger value="invitations">
              <Mail className="h-3.5 w-3.5" />
              Pending Invites ({invitations.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-70">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-9 text-[13px]"
          />
        </div>
      </div>

      {activeTab === 'members' ? (
        <>
          <Card className="overflow-hidden p-0">
            <DataTable
              head={
                <>
                  <TableHead>Member</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </>
              }
              isLoading={isLoading}
              error={error}
              onRetry={loadData}
              errorTitle="Couldn't load members"
              isEmpty={!isLoading && filteredMembers.length === 0}
              colSpan={5}
              columns={5}
              emptyTitle="No members found."
          >
            {filteredMembers.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {(m.user?.name || m.user?.email || 'U').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-semibold">{m.user?.name || 'Workspace Member'}</div>
                      <div className="text-xs text-muted-foreground">{m.user?.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={m.status} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {m.roles?.length ? (
                      m.roles.map((r) => (
                        <Badge key={r.id}>
                          <Shield className="h-2.5 w-2.5" />
                          {r.name}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="secondary">Member</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-[13px] text-muted-foreground">
                  {new Date(m.joined_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <ConfirmDialog
                    title="Remove this member?"
                    description="Are you sure you want to remove this member from the workspace?"
                    confirmLabel="Remove"
                    onConfirm={() => handleRemoveMember(m.id)}
                    trigger={
                      <Button variant="destructive" size="sm" title="Remove member">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </Card>
          <PaginationBar
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </>
      ) : (
        <Card className="overflow-hidden p-0">
          <DataTable
            head={
              <>
                <TableHead>Invitee Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </>
            }
            isLoading={isLoading}
            error={error}
            onRetry={loadData}
            errorTitle="Couldn't load invitations"
            isEmpty={!isLoading && filteredInvitations.length === 0}
            colSpan={4}
            columns={4}
            emptyTitle="No pending invitations."
          >
            {filteredInvitations.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Mail className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{inv.email}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={inv.status} />
                </TableCell>
                <TableCell className="text-[13px] text-muted-foreground">
                  {new Date(inv.expires_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <ConfirmDialog
                    title="Revoke this invitation?"
                    description="Are you sure you want to revoke this invitation?"
                    confirmLabel="Revoke"
                    onConfirm={() => handleRevokeInvite(inv.id)}
                    trigger={
                      <Button variant="destructive" size="sm" title="Revoke invitation">
                        <XCircle className="h-3.5 w-3.5" />
                        Revoke
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </Card>
      )}

      {isInviteModalOpen && (
        <InviteMemberModal
          onClose={() => setIsInviteModalOpen(false)}
          onInvitationCreated={loadData}
        />
      )}
    </div>
  );
}
