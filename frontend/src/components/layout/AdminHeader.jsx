import { useLocation, useNavigate, Link } from 'react-router';
import {
  Menu,
  ChevronRight,
  ShieldCheck,
  Search,
  ArrowLeft,
  Bell,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/common/ThemeToggle';

export function AdminHeader({ onOpenMobile, isCollapsed, onToggleCollapse }) {
  const location = useLocation();
  const navigate = useNavigate();

  const searchParams = new URLSearchParams(location.search);
  const currentTab = searchParams.get('tab') || 'overview';

  const getBreadcrumbTitle = () => {
    if (location.pathname === '/system-health') return 'System Telemetry';
    if (location.pathname.includes('/workspaces/')) return 'Workspace Detail';
    if (location.pathname.includes('/users/')) return 'User Detail';
    if (location.pathname.includes('/payments/')) return 'Payment Detail';
    if (location.pathname.includes('/webhook-events/')) return 'Webhook Event Detail';
    if (location.pathname.includes('/audit-events/')) return 'Audit Event Detail';

    switch (currentTab) {
      case 'workspaces': return 'Workspaces';
      case 'users': return 'Users & Access';
      case 'subscriptions': return 'Subscriptions & Plans';
      case 'coupons': return 'Coupons & Discounts';
      case 'audit_logs': return 'Audit Trail';
      case 'webhooks': return 'Webhooks & Integrations';
      case 'alerts': return 'Alerts & Incidents';
      case 'settings': return 'Platform Settings';
      default: return 'Platform Overview';
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 w-full items-center justify-between border-b border-border/60 bg-background/95 px-4 backdrop-blur-md md:px-7">
      <div className="flex items-center gap-3">
        {/* Mobile Menu Button */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenMobile}
          className="md:hidden text-muted-foreground hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-sm font-medium">
          <Link
            to="/admin-portal"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <ShieldCheck className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <span className="hidden sm:inline">Admin Portal</span>
          </Link>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          <span className="font-semibold text-foreground tracking-tight">
            {getBreadcrumbTitle()}
          </span>
        </div>
      </div>

      {/* Right Action Tools */}
      <div className="flex items-center gap-3">
        {/* System Health Badge */}
        <Badge
          variant="outline"
          className="hidden lg:flex items-center gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 text-xs font-semibold"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Platform Active
        </Badge>

        <ThemeToggle />

        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/dashboard')}
          className="gap-2 border-purple-500/20 bg-purple-500/5 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10 hover:border-purple-500/40"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Workspace Panel</span>
        </Button>
      </div>
    </header>
  );
}
