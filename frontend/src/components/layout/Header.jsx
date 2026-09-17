import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { Search, Bell, Plus, Menu } from 'lucide-react';
import { GlobalSearchModal } from './GlobalSearchModal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/common/ThemeToggle';

export function Header({ onOpenInviteModal, onOpenMobileNav }) {
  const { activeWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md md:px-7">
        <div className="flex min-w-0 items-center gap-2">
          {onOpenMobileNav && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
                  <Menu className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open navigation</TooltipContent>
            </Tooltip>
          )}
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="flex h-9 w-full max-w-[200px] items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-[13px] text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground sm:max-w-[340px]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Search className="h-4 w-4 shrink-0" />
              <span className="hidden truncate sm:inline">Search products, orders, SKUs…</span>
              <span className="truncate sm:hidden">Search…</span>
            </span>
            <kbd className="hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline">⌘K</kbd>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {activeWorkspace && (
            <Badge variant="default" className="hidden h-7 md:inline-flex">
              {activeWorkspace.name}
            </Badge>
          )}

          <ThemeToggle />

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
                    <Bell className="h-[18px] w-[18px]" />
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Notifications</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate(`/app/${activeWorkspace?.slug || ''}/notifications`)}>View notification center</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/app/${activeWorkspace?.slug || ''}/reorder`)}>View reorder alerts</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {onOpenInviteModal && (
            <Button size="sm" onClick={onOpenInviteModal} className="hidden sm:inline-flex">
              <Plus className="h-3.5 w-3.5" />
              <span>Invite Member</span>
            </Button>
          )}
        </div>
      </header>

      <GlobalSearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </>
  );
}
