import { useLocation, useNavigate, Link } from 'react-router';
import {
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  Ticket,
  ShieldCheck,
  Radio,
  BellRing,
  Activity,
  Settings,
  ChevronLeft,
  ChevronRight,
  Boxes,
  ArrowLeft,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function AdminSidebar({ isCollapsed, onToggleCollapse, isMobileOpen, onCloseMobile }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const searchParams = new URLSearchParams(location.search);
  const currentTab = searchParams.get('tab') || 'overview';
  const isSystemHealth = location.pathname === '/system-health';
  const isAdminPortal = location.pathname.startsWith('/admin-portal');

  const navSections = [
    {
      title: 'Platform Control',
      items: [
        {
          id: 'overview',
          label: 'Overview',
          icon: LayoutDashboard,
          to: '/admin-portal?tab=overview',
          isActive: isAdminPortal && (currentTab === 'overview' || !currentTab),
        },
        {
          id: 'workspaces',
          label: 'Workspaces',
          icon: Building2,
          to: '/admin-portal?tab=workspaces',
          isActive: isAdminPortal && (currentTab === 'workspaces' || location.pathname.includes('/workspaces/')),
        },
        {
          id: 'users',
          label: 'Users & Access',
          icon: Users,
          to: '/admin-portal?tab=users',
          isActive: isAdminPortal && (currentTab === 'users' || location.pathname.includes('/users/')),
        },
      ],
    },
    {
      title: 'Commercial & Billing',
      items: [
        {
          id: 'subscriptions',
          label: 'Subscriptions & Plans',
          icon: CreditCard,
          to: '/admin-portal?tab=subscriptions',
          isActive: isAdminPortal && (currentTab === 'subscriptions' || location.pathname.includes('/payments/')),
        },
        {
          id: 'coupons',
          label: 'Coupons & Discounts',
          icon: Ticket,
          to: '/admin-portal?tab=coupons',
          isActive: isAdminPortal && currentTab === 'coupons',
        },
      ],
    },
    {
      title: 'Security & Observability',
      items: [
        {
          id: 'audit_logs',
          label: 'Audit Trail',
          icon: ShieldCheck,
          to: '/admin-portal?tab=audit_logs',
          isActive: isAdminPortal && (currentTab === 'audit_logs' || location.pathname.includes('/audit-events/')),
        },
        {
          id: 'webhooks',
          label: 'Webhooks & Integration',
          icon: Radio,
          to: '/admin-portal?tab=webhooks',
          isActive: isAdminPortal && (currentTab === 'webhooks' || location.pathname.includes('/webhook-events/')),
        },
        {
          id: 'alerts',
          label: 'Alerts & Incidents',
          icon: BellRing,
          to: '/admin-portal?tab=alerts',
          isActive: isAdminPortal && currentTab === 'alerts',
        },
        {
          id: 'telemetry',
          label: 'System Telemetry',
          icon: Activity,
          to: '/system-health',
          isActive: isSystemHealth,
        },
      ],
    },
    {
      title: 'Configuration',
      items: [
        {
          id: 'settings',
          label: 'Platform Settings',
          icon: Settings,
          to: '/admin-portal?tab=settings',
          isActive: isAdminPortal && currentTab === 'settings',
        },
      ],
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Navigation Drawer/Column */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-purple-900/30 bg-gradient-to-b from-purple-950 via-slate-950 to-slate-950 text-slate-100 transition-all duration-300 ease-in-out md:static md:z-30',
          isCollapsed ? 'w-20' : 'w-64',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Sidebar Header / Brand */}
        <div className="flex h-16 items-center justify-between border-b border-purple-900/30 px-4">
          <Link
            to="/admin-portal"
            className="flex items-center gap-3 overflow-hidden text-left"
            onClick={onCloseMobile}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 text-white shadow-lg shadow-purple-900/40">
              <Boxes className="h-5 w-5" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col overflow-hidden">
                <span className="truncate font-bold tracking-tight text-white text-base">
                  Platform Admin
                </span>
                <span className="truncate text-[11px] font-medium text-purple-300/80">
                  Super Admin Console
                </span>
              </div>
            )}
          </Link>

          {/* Desktop Collapse Toggle */}
          <button
            onClick={onToggleCollapse}
            className="hidden h-7 w-7 items-center justify-center rounded-lg border border-purple-800/40 bg-purple-900/30 text-purple-300 hover:bg-purple-800/60 hover:text-white transition-colors md:flex"
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Status Pill */}
        {!isCollapsed && (
          <div className="mx-4 mt-4 rounded-xl border border-purple-800/40 bg-purple-900/20 p-3 shadow-inner">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <span className="text-xs font-semibold text-emerald-300">System Healthy</span>
              </div>
              <Badge variant="outline" className="border-purple-700 bg-purple-950 text-[10px] text-purple-200">
                v2.4
              </Badge>
            </div>
          </div>
        )}

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 custom-scrollbar">
          {navSections.map((section, idx) => (
            <div key={idx} className="space-y-1.5">
              {!isCollapsed && (
                <h4 className="px-3 text-[11px] font-bold uppercase tracking-wider text-purple-300/60">
                  {section.title}
                </h4>
              )}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.id}
                      to={item.to}
                      onClick={onCloseMobile}
                      title={isCollapsed ? item.label : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
                        item.isActive
                          ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/50'
                          : 'text-slate-300 hover:bg-purple-900/30 hover:text-white'
                      )}
                    >
                      <Icon className={cn('h-5 w-5 shrink-0', item.isActive ? 'text-white' : 'text-purple-300/80')} />
                      {!isCollapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer Quick Actions */}
        <div className="border-t border-purple-900/30 p-3 space-y-2 bg-purple-950/40">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/dashboard')}
            className={cn(
              'w-full justify-start gap-2 border-purple-800/60 bg-purple-900/30 text-purple-200 hover:bg-purple-800 hover:text-white',
              isCollapsed && 'px-0 justify-center'
            )}
            title="Return to Workspace Dashboard"
          >
            <ArrowLeft className="h-4 w-4 shrink-0 text-purple-300" />
            {!isCollapsed && <span className="truncate text-xs font-semibold">Workspace Panel</span>}
          </Button>

          {/* User profile card */}
          <div className={cn('flex items-center gap-3 rounded-xl bg-purple-900/20 p-2.5', isCollapsed && 'justify-center p-2')}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-700 font-bold text-white text-xs">
              {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'A'}
            </div>
            {!isCollapsed && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <span className="truncate text-xs font-semibold text-white">
                  {user?.name || 'Super Admin'}
                </span>
                <span className="truncate text-[10px] text-purple-300/70">
                  {user?.email || 'admin@saas.com'}
                </span>
              </div>
            )}
            {!isCollapsed && (
              <button
                onClick={logout}
                className="text-purple-400 hover:text-rose-400 transition-colors"
                title="Sign Out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
