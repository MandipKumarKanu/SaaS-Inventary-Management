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
 * Phase 9 (PRD §6): the URL is the workspace authority.
 *
 * Resolves :workspaceSlug → workspace + membership + permissions, syncs the
 * store, then renders the matched page. Handles:
 *   - unknown slug            → not-found denial (with switcher escape hatch)
 *   - slug valid, not member  → denial page (server would 403 anyway)
 *   - slug valid, member      → Outlet (all existing pages read the store)
 */
export function AppLayout() {
  const navigate = useNavigate();
  const { workspaceSlug } = useParams();
  const { token, user } = useAuthStore();
  const {
    workspaces,
    activeWorkspace,
    membership,
    fetchWorkspaces,
    setActiveWorkspace,
  } = useWorkspaceStore();

  const fetchProfile = useAuthStore((state) => state.fetchProfile);

  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isResolving, setIsResolving] = useState(true);
  const [resolution, setResolution] = useState('ok'); // 'ok' | 'not-found' | 'not-member'

  useEffect(() => {
    if (!token) {
      navigate('/login');
    }
  }, [token, navigate]);

  // Boot: load the workspace list once (idempotent — store caches).
  useEffect(() => {
    if (!token) return;
    if (workspaces.length === 0) {
      fetchWorkspaces();
    }
    if (fetchProfile) fetchProfile();
  }, [token, workspaces.length, fetchWorkspaces, fetchProfile]);

  // Resolve the URL slug against the workspace list.
  useEffect(() => {
    if (!token) return;

    const isLoadingWorkspaces = useWorkspaceStore.getState().isLoading;

    // Handle user with no workspaces
    if (workspaces.length === 0) {
      if (isLoadingWorkspaces) {
        setIsResolving(true);
        return;
      }
      setIsResolving(false);
      return;
    }

    if (!workspaceSlug) {
      const target = activeWorkspace || workspaces[0];
      const slugOrId = target?.slug || target?.id;
      if (slugOrId) {
        navigate(`/app/${slugOrId}/dashboard`, { replace: true });
      } else {
        setIsResolving(false);
      }
      return;
    }

    const matched = workspaces.find(
      (w) => w.slug === workspaceSlug || w.id === workspaceSlug
    );

    if (!matched) {
      setResolution('not-found');
      setIsResolving(false);
      return;
    }

    if (activeWorkspace?.id !== matched.id) {
      // setActiveWorkspace also fetches the membership/permissions for the
      // matched workspace (store behavior — unchanged for pages).
      setActiveWorkspace(matched);
    }
    setResolution('ok');
    setIsResolving(false);
  }, [token, workspaceSlug, workspaces, activeWorkspace, setActiveWorkspace, navigate]);

  // Load the membership for the resolved workspace before rendering children.
  useEffect(() => {
    if (resolution !== 'ok') return;
    if (!activeWorkspace) return;
    if (membership === null || membership.workspace_id !== activeWorkspace.id) {
      // fetchCurrentMember is triggered by setActiveWorkspace; but when the
      // store already had the right workspace (e.g. refresh), ensure it ran.
      setIsResolving(true);
      let cancelled = false;
      (async () => {
        await useWorkspaceStore.getState().fetchCurrentMember(activeWorkspace.id);
        if (!cancelled) setIsResolving(false);
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [resolution, activeWorkspace, membership]);

  if (!user || !token) return null;

  if (isResolving) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingState message="Opening workspace…" />
      </div>
    );
  }

  // Handle case where logged-in user has 0 workspaces
  if (workspaces.length === 0) {
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

  if (resolution !== 'ok' || !activeWorkspace) {
    return (
      <PermissionDeniedPage
        title={resolution === 'not-found' ? 'Workspace not found' : undefined}
        description={
          resolution === 'not-found'
            ? `No workspace matches "${workspaceSlug}". It may have been renamed, or you may not be a member.`
            : undefined
        }
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
