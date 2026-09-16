import { useState } from 'react';
import { NavLink } from 'react-router';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { InteractiveTourModal } from '../tour/InteractiveTourModal';
import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { usePlanFeature } from '../../store/usePlanStore';
import { Lock } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Package,
  Tag,
  Warehouse,
  SlidersHorizontal,
  History,
  Users,
  ShieldCheck,
  Settings,
  Boxes,
  LogOut,
  ArrowLeftRight,
  ClipboardList,
  Barcode,
  Calendar,
  Truck,
  ShoppingBag,
  ShoppingCart,
  RotateCcw,
  AlertOctagon,
  Layers,
  TrendingUp,
  FileText,
  UploadCloud,
  Bell,
  Key,
  Webhook,
  CreditCard,
  Globe,
  Share2,
  Code,
  Activity,
  Database,
  ShieldAlert,
  Palette,
  Sparkles,
  Bot,
  MapPin,
  Zap,
  ChevronDown,
} from 'lucide-react';

// Phase 9 (PRD §11/§13): every item carries the permission that gates it.
// `null` = available to every member of the workspace. The Sidebar filters
// by the member's effective permissions; RouteGuard enforces on navigation.
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: 'dashboard', icon: LayoutDashboard, permission: null },
      { label: 'AI Copilot', path: 'ai-copilot', icon: Bot, permission: null },
      { label: 'Notifications', path: 'notifications', icon: Bell, permission: null },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { label: 'Products', path: 'products', icon: Package, permission: 'products.view' },
      { label: 'Categories', path: 'categories', icon: Tag, permission: 'products.view' },
      { label: 'Suppliers', path: 'suppliers', icon: Truck, permission: 'purchases.view' },
      { label: 'Customers', path: 'customers', icon: Users, permission: 'sales.view' },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Stock Balances', path: 'inventory', icon: SlidersHorizontal, permission: 'inventory.view' },
      { label: 'Stock Ledger', path: 'ledger', icon: History, permission: 'inventory.view' },
      { label: 'Stock Transfers', path: 'transfers', icon: ArrowLeftRight, permission: 'transfers.view' },
      { label: 'Cycle Counting', path: 'counts', icon: ClipboardList, permission: 'inventory.count' },
      { label: 'Barcode Scanner', path: 'scanner', icon: Barcode, permission: 'products.view' },
      { label: 'FEFO Batches', path: 'batches', icon: Calendar, permission: 'inventory.view' },
      { label: 'Warehouses', path: 'warehouses', icon: Warehouse, permission: 'warehouses.view' },
    ],
  },
  {
    label: 'Orders',
    items: [
      { label: 'Purchase Orders', path: 'purchases', icon: ShoppingBag, permission: 'purchases.view' },
      { label: 'Sales Orders', path: 'sales', icon: ShoppingCart, permission: 'sales.view' },
      { label: 'Customer Returns', path: 'returns', icon: RotateCcw, permission: 'returns.view' },
      { label: 'Reorder Alerts', path: 'reorder', icon: AlertOctagon, permission: 'purchases.view' },
      { label: 'PO Auto-Pilot', path: 'automation', icon: Zap, permission: 'settings.view' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { label: 'ABC Analysis', path: 'abc-analysis', icon: Layers, permission: 'reports.view' },
      { label: 'Demand Forecast', path: 'forecast', icon: TrendingUp, permission: 'reports.view' },
      { label: 'Reports Center', path: 'reports', icon: FileText, permission: 'reports.view' },
      { label: 'Bulk CSV Import', path: 'import', icon: UploadCloud, permission: 'products.create' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'App Marketplace', path: 'integrations', icon: Share2, permission: 'settings.view' },
      { label: 'Shipping Carriers', path: 'shipping', icon: Truck, permission: 'sales.view' },
      { label: '3PL Routing', path: 'settings/3pl-routing', icon: MapPin, permission: 'warehouses.view' },
      { label: 'Backup & Recovery', path: 'settings/backup', icon: Database, permission: 'settings.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Team Members', path: 'team', icon: Users, permission: 'team.view' },
      { label: 'Roles & Permissions', path: 'roles', icon: ShieldCheck, permission: 'roles.view' },
      { label: 'Workspace Settings', path: 'settings', icon: Settings, permission: 'settings.view' },
      { label: 'Developer API Keys', path: 'settings/api-keys', icon: Key, permission: 'settings.view' },
      { label: 'Webhooks Engine', path: 'settings/webhooks', icon: Webhook, permission: 'settings.view' },
      { label: 'Stripe Billing', path: 'settings/billing', icon: CreditCard, permission: 'billing.view' },
      { label: 'Multi-Currency', path: 'settings/currencies', icon: Globe, permission: 'settings.view' },
      { label: 'Security Audit Log', path: 'settings/security-audit', icon: ShieldAlert, permission: 'settings.view' },
      { label: 'Custom Branding', path: 'settings/branding', icon: Palette, permission: 'settings.view' },
      { label: 'Seed Demo Data', path: 'settings/demo-data', icon: Sparkles, permission: 'settings.manage' },
      { label: 'Public API Docs', path: 'api-docs', icon: Code, permission: null },
    ],
  },
];

export function Sidebar({ onOpenCreateWorkspaceModal, onNavigate }) {
  const { user, logout } = useAuthStore();
  const { activeWorkspace, permissions } = useWorkspaceStore();
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [openSections, setOpenSections] = useState(() => Object.fromEntries(NAV_SECTIONS.map((s) => [s.label, true])));

  const toggleSection = (label) => setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }));

  // Phase 9: permission-filtered navigation — items the member can't use
  // disappear entirely; empty sections collapse away.
  const canSee = (permission) => !permission || permissions.includes(permission);
  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSee(item.permission)),
  })).filter((section) => section.items.length > 0);

  // Plan-gated items (PRD §16): server enforces; we show a lock affordance.
  // forecasting gates the AI Copilot; api_access gates the public API docs.
  const forecasting = usePlanFeature('forecasting');
  const planLockFor = (item) => {
    if (item.path === 'ai-copilot' && forecasting.loaded && !forecasting.enabled) {
      return forecasting.summary?.plan_display_name || 'your plan';
    }
    return null;
  };

  return (
    <div className="flex h-full w-[260px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Boxes className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-bold tracking-tight">
            {activeWorkspace?.name || 'Inventory SaaS'}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">Multi-Tenant Warehouse Engine</div>
        </div>
      </div>

      {/* Workspace switcher */}
      <div className="px-4 pb-4">
        <WorkspaceSwitcher onOpenCreateModal={onOpenCreateWorkspaceModal} />
      </div>

      <Separator />

      {/* Nav */}
      <ScrollArea className="flex-1 px-3 py-3">
        <nav className="flex flex-col gap-4 pb-4" aria-label="Primary">
          {visibleSections.map((section) => {
            const open = openSections[section.label] ?? true;
            return (
              <div key={section.label}>
                <button
                  type="button"
                  onClick={() => toggleSection(section.label)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between rounded-md px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  <span>{section.label}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
                </button>
                {open && (
                  <div className="flex flex-col gap-0.5">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const lockedBy = planLockFor(item);
                      return (
                        <NavLink
                          key={item.path}
                          to={`/app/${activeWorkspace?.slug || ''}/${item.path}`.replace(/\/+$/, '')}
                          onClick={onNavigate}
                          title={lockedBy ? `${item.label} requires a plan upgrade (currently ${lockedBy})` : undefined}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium no-underline transition-colors',
                              isActive
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'
                            )
                          }
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                          {lockedBy && (
                            <Lock className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" aria-label="Requires plan upgrade" />
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Role-Gated Platform Super Admin Switcher */}
      {user?.is_platform_admin && (
        <div className="border-t border-sidebar-border p-3 bg-purple-500/5">
          <NavLink
            to="/admin-portal"
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-semibold transition-colors',
                isActive
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20'
              )
            }
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span className="truncate">SaaS Platform Admin</span>
          </NavLink>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-sidebar-border bg-muted/40 p-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-muted text-xs font-semibold text-foreground">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{user?.name || user?.email?.split('@')[0] || 'User'}</div>
            <div className="truncate text-[11px] text-muted-foreground">{user?.email}</div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Account actions">
              <LogOut className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setIsTourOpen(true)}>
              <Sparkles className="h-4 w-4" />
              Take a tour
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={logout}>
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <InteractiveTourModal isOpen={isTourOpen} onClose={() => setIsTourOpen(false)} />

      <div className="border-t border-sidebar-border px-4 py-2 text-center text-[11px] text-muted-foreground">
        General inventory management system
      </div>
    </div>
  );
}
