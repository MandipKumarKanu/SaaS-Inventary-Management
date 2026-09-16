import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { CreateWorkspaceModal } from '../../pages/settings/CreateWorkspaceModal';
import { InviteMemberModal } from '../../pages/team/InviteMemberModal';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';

export function AppLayout() {
  const navigate = useNavigate();
  const { token, user } = useAuthStore();
  const { fetchWorkspaces, activeWorkspace } = useWorkspaceStore();
  const fetchProfile = useAuthStore((state) => state.fetchProfile);

  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!token) {
      navigate('/login');
    } else {
      fetchWorkspaces();
      if (fetchProfile) fetchProfile();
    }
  }, [token, navigate, fetchWorkspaces, fetchProfile]);

  if (!user || !token) return null;

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
