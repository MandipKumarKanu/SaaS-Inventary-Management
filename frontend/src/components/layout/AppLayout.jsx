import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import { Plus, Building2 } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { CreateWorkspaceModal } from '../../pages/settings/CreateWorkspaceModal';
import { InviteMemberModal } from '../../pages/team/InviteMemberModal';
import { PermissionDeniedPage } from '../../components/common/PermissionDeniedPage';
import { LoadingState } from '@/components/common/DataTable';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

/**
 * AppLayout: Workspace layout authority.
 * Resolves :workspaceSlug against store workspaces & membership,
 * handles legacy redirects, 0 workspaces UI, and unauthorized access.
 */
export function AppLayout() {
  const navigate = useNavigate();
  const { workspaceSlug } = useParams();
  const { token, user } = useAuthStore();
  const {
    workspaces,
    activeWorkspace,
    membership,
    isLoading: isWsLoading,
    fetchWorkspaces,
    setActiveWorkspace,
    fetchCurrentMember,
  } = useWorkspaceStore();

  const fetchProfile = useAuthStore((state) => state.fetchProfile);

  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // 1. Auth Guard
  useEffect(() => {
    if (!token) {
      navigate('/login');
    }
  }, [token, navigate]);

  // 2. Boot: load workspaces once if store is empty
  useEffect(() => {
    if (!token) return;
    if (workspaces.length === 0 && !isWsLoading) {
      fetchWorkspaces();
    }
    if (fetchProfile) fetchProfile();
  }, [token, workspaces.length, isWsLoading, fetchWorkspaces, fetchProfile]);

  // 3. Sync route slug with activeWorkspace & fetch membership if missing
  useEffect(() => {
    if (!token) return;
    if (workspaces.length === 0) return;

    if (!workspaceSlug) {
      const target = activeWorkspace || workspaces[0];
      const slugOrId = target?.slug || target?.id;
      if (slugOrId) {
        navigate(`/app/${slugOrId}/dashboard`, { replace: true });
      }
      return;
    }

    const matched = workspaces.find(
      (w) => w.slug === workspaceSlug || w.id === workspaceSlug
    );

    if (matched) {
      if (activeWorkspace?.id !== matched.id) {
        setActiveWorkspace(matched);
      } else if (!membership || membership.workspace_id !== matched.id) {
        fetchCurrentMember(matched.id);
      }
    }
  }, [token, workspaceSlug, workspaces, activeWorkspace, membership, setActiveWorkspace, fetchCurrentMember, navigate]);

  if (!user || !token) return null;

  // 4. Loading state: active if workspaces are fetching or membership for activeWorkspace is pending
  const isResolving = isWsLoading || (activeWorkspace && (!membership || membership.workspace_id !== activeWorkspace.id));

  if (isResolving && workspaces.length > 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingState message="Opening workspace…" />
      </div>
    );
  }

  // 5. Handle user with 0 workspaces
  if (workspaces.length === 0 && !isWsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-8 text-center text-card-foreground shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Building2 className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Create your workspace</h2>
            <p className="text-sm text-muted-foreground">
              You don&apos;t have any workspaces yet. Create your first workspace to start managing your inventory.
            </p>
          </div>
          <Button onClick={() => setIsCreateWsOpen(true)} size="lg" className="w-full">
            <Plus className="mr-2 h-4 w-4" /> Create Workspace
          </Button>
        </div>
        {isCreateWsOpen && (
          <CreateWorkspaceModal onClose={() => setIsCreateWsOpen(false)} />
        )}
      </div>
    );
  }

  // 6. Handle unknown workspace slug
  const matchedWorkspace = workspaceSlug
    ? workspaces.find((w) => w.slug === workspaceSlug || w.id === workspaceSlug)
    : activeWorkspace;

  if (workspaceSlug && !matchedWorkspace) {
    return (
      <PermissionDeniedPage
        title="Workspace not found"
        description={`No workspace matches "${workspaceSlug}". It may have been renamed, or you may not be a member.`}
      />
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden lg:block">
        <Sidebar onOpenCreateWorkspaceModal={() => setIsCreateWsOpen(true)} />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <SheetContent side="left" className="w-[280px] p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Workspace navigation menu</SheetDescription>
          <Sidebar
            onOpenCreateWorkspaceModal={() => {
              setIsMobileNavOpen(false);
              setIsCreateWsOpen(true);
            }}
            onNavigate={() => setIsMobileNavOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[260px]">
        <Header
          onOpenInviteModal={() => setIsInviteOpen(true)}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
        />
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-7">
          <Outlet context={{ onOpenInviteModal: () => setIsInviteOpen(true) }} />
        </main>
      </div>

      {isCreateWsOpen && <CreateWorkspaceModal onClose={() => setIsCreateWsOpen(false)} />}
      {isInviteOpen && activeWorkspace && <InviteMemberModal onClose={() => setIsInviteOpen(false)} />}
    </div>
  );
}
