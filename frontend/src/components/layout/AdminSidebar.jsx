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
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Navigation Drawer/Column */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-800 bg-slate-900 text-slate-100 transition-all duration-200 ease-in-out md:static md:z-30',
          isCollapsed ? 'w-16' : 'w-64',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Sidebar Header / Brand */}
        <div className="flex h-16 items-center justify-between border-b border-slate-800 px-4">
          <Link
            to="/admin-portal"
            className="flex items-center gap-3 overflow-hidden text-left"
            onClick={onCloseMobile}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white font-semibold">
              <Boxes className="h-5 w-5" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col overflow-hidden">
                <span className="truncate font-semibold text-white text-sm">
                  Platform Admin
                </span>
                <span className="truncate text-[11px] font-medium text-slate-400">
                  Super Admin Console
                </span>
              </div>
            )}
          </Link>

          {/* Desktop Collapse Toggle */}
          <button
            onClick={onToggleCollapse}
            className="hidden h-7 w-7 items-center justify-center rounded border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors md:flex"
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Status Pill */}
        {!isCollapsed && (
          <div className="mx-3 mt-3 rounded-md border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium text-slate-300">System Healthy</span>
              </div>
              <Badge variant="outline" className="border-slate-700 bg-slate-800 text-[10px] text-slate-300 font-mono">
                v2.4
              </Badge>
            </div>
          </div>
        )}

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5 custom-scrollbar">
          {navSections.map((section, idx) => (
            <div key={idx} className="space-y-1">
              {!isCollapsed && (
                <h4 className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {section.title}
                </h4>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.id}
                      to={item.to}
                      onClick={onCloseMobile}
                      title={isCollapsed ? item.label : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors',
                        item.isActive
                          ? 'bg-indigo-600 text-white font-semibold'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', item.isActive ? 'text-white' : 'text-slate-400')} />
                      {!isCollapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer Quick Actions */}
        <div className="border-t border-slate-800 p-2.5 space-y-2 bg-slate-950/40">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/dashboard')}
            className={cn(
              'w-full justify-start gap-2 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white text-xs h-8',
              isCollapsed && 'px-0 justify-center'
            )}
            title="Return to Workspace Dashboard"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {!isCollapsed && <span className="truncate">Workspace Panel</span>}
          </Button>

          {/* User profile card */}
          <div className={cn('flex items-center gap-2.5 rounded-md bg-slate-800/80 p-2', isCollapsed && 'justify-center p-1.5')}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-indigo-600 font-bold text-white text-xs">
              {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'A'}
            </div>
            {!isCollapsed && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <span className="truncate text-xs font-medium text-white">
                  {user?.name || 'Super Admin'}
                </span>
                <span className="truncate text-[10px] text-slate-400">
                  {user?.email || 'admin@saas.com'}
                </span>
              </div>
            )}
            {!isCollapsed && (
              <button
                onClick={logout}
                className="text-slate-400 hover:text-rose-400 transition-colors p-1"
                title="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
