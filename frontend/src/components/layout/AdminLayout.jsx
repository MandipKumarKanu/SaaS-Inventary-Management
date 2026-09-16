import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router';
import { useAuthStore } from '../../store/useAuthStore';
import { ShieldCheck, Activity, ArrowLeft, Boxes, AlertCircle, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { api } from '../../lib/api';

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token, logout, fetchProfile } = useAuthStore();
  const [isVerifying, setIsVerifying] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function verifyAdmin() {
      if (!token) {
        if (isMounted) setIsVerifying(false);
        return;
      }
      try {
        // Fetch fresh profile & check admin endpoint
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
  }, [token, fetchProfile]);

  if (!token) {
    navigate('/login');
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
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Top Admin Header */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-purple-500/20 bg-purple-950/95 px-4 text-white shadow-md backdrop-blur-md md:px-7">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white font-bold shadow">
              <Boxes className="h-5 w-5" />
            </div>
            <span className="font-bold tracking-tight text-base">SaaS Super Admin</span>
            <Badge className="bg-purple-700 hover:bg-purple-700 text-white border-none text-[11px] px-2 py-0.5">
              System Control
            </Badge>
          </div>

          <nav className="hidden md:flex items-center gap-1 ml-6 border-l border-purple-800/60 pl-6">
            <Link
              to="/admin-portal"
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                location.pathname === '/admin-portal'
                  ? 'bg-purple-800 text-white shadow-sm'
                  : 'text-purple-200 hover:bg-purple-900/60 hover:text-white'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              Platform Overview
            </Link>

            <Link
              to="/system-health"
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                location.pathname === '/system-health'
                  ? 'bg-purple-800 text-white shadow-sm'
                  : 'text-purple-200 hover:bg-purple-900/60 hover:text-white'
              }`}
            >
              <Activity className="h-4 w-4" />
              System Telemetry
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/dashboard')}
            className="gap-2 border-purple-700 bg-purple-900/40 text-purple-100 hover:bg-purple-800 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Workspace Panel</span>
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={logout}
            title="Sign Out"
            className="text-purple-200 hover:bg-purple-900 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main Admin Body */}
      <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-7">
        <Outlet />
      </main>
    </div>
  );
}
