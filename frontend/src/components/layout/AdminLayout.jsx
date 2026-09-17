import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { useAuthStore } from '../../store/useAuthStore';
import { ShieldCheck, AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '../../lib/api';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';

export function AdminLayout() {
  const navigate = useNavigate();
  const { user, token, fetchProfile } = useAuthStore();
  const [isVerifying, setIsVerifying] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Sidebar controls
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function verifyAdmin() {
      if (!token) {
        if (isMounted) setIsVerifying(false);
        navigate('/login');
        return;
      }
      try {
        await fetchProfile();
        const res = await api.get('/admin/check-access');
        if (isMounted) {
          setIsAuthorized(res.data?.is_platform_admin === true);
        }
      } catch (err) {
        if (isMounted) {
          setIsAuthorized(false);
        }
      } finally {
        if (isMounted) setIsVerifying(false);
      }
    }
    verifyAdmin();
    return () => { isMounted = false; };
  }, [token, fetchProfile, navigate]);

  if (!token) {
    return null;
  }

  if (isVerifying) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3">
          <ShieldCheck className="h-8 w-8 animate-pulse text-purple-600" />
          <p className="text-sm font-medium text-muted-foreground">Verifying platform administrator credentials…</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized && !user?.is_platform_admin) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-background p-4 text-foreground">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The Platform Admin Portal is restricted to SaaS system administrators. Your account (<span className="font-semibold">{user?.email}</span>) does not have platform administrative privileges.
          </p>
          <Button className="mt-6 gap-2" onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="h-4 w-4" />
            Return to Workspace Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar Navigation */}
      <AdminSidebar
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <AdminHeader
          onOpenMobile={() => setIsMobileOpen(true)}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        />

        {/* Dynamic Page Outlet */}
        <main className="flex-1 overflow-y-auto p-4 md:p-7 custom-scrollbar bg-slate-50 dark:bg-slate-950">
          <div className="mx-auto max-w-[1500px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
