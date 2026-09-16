import { useNavigate, useLocation } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { Building2, Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ChevronDown } from 'lucide-react';

export function WorkspaceSwitcher({ onOpenCreateModal }) {
  const { workspaces, activeWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const location = useLocation();

  // Phase 9 (PRD §6): switching preserves the destination path —
  // /app/alpha/products → /app/beta/products. Access is re-checked by
  // AppLayout (membership) and RouteGuard (permissions) after the swap.
  const switchTo = (ws) => {
    const sectionMatch = location.pathname.match(/^\/app\/[^/]+(\/.*)?$/);
    const rest = sectionMatch?.[1] || '/dashboard';
    navigate(`/app/${ws.slug}${rest}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-11 w-full justify-between px-3.5">
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar className="h-7 w-7 shrink-0 rounded-md">
              <AvatarFallback className="rounded-md bg-primary text-xs font-bold text-primary-foreground">
                {activeWorkspace?.name?.charAt(0).toUpperCase() || 'W'}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm font-semibold">{activeWorkspace?.name || 'Select Workspace'}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((ws) => {
          const active = activeWorkspace?.id === ws.id;
          return (
            <DropdownMenuItem key={ws.id} onSelect={() => switchTo(ws)}>
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="truncate text-[13px] font-medium">{ws.name}</span>
              {active && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenCreateModal} className="text-primary focus:text-primary">
          {/* create flow returns to the current workspace */}
          <Plus className="h-4 w-4" />
          <span className="text-[13px]">Create Workspace</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
