import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { CreateWorkspaceModal } from '../../pages/settings/CreateWorkspaceModal';
import { InviteMemberModal } from '../../pages/team/InviteMemberModal';
import { PermissionDeniedPage } from '../../components/common/PermissionDeniedPage';
import { LoadingState } from '@/components/common/DataTable';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';

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
    if (!token || !workspaceSlug) return;

    // Wait until the list is available before judging the slug.
    if (workspaces.length === 0) {
      setIsResolving(true);
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
  }, [token, workspaceSlug, workspaces, activeWorkspace?.id, setActiveWorkspace]);

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
