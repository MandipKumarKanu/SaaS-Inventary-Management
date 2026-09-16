import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function SearchFilterBar({ searchValue, onSearchChange, searchPlaceholder = 'Search…', children, className }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchValue ?? ''}
          onChange={(e) => onSearchChange?.(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 pl-9 text-[13px]"
          aria-label={searchPlaceholder}
        />
      </div>
      {children}
    </div>
  );
}
