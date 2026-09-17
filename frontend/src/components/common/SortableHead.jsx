import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * §68 sortable table header. Click cycles: none → desc → asc → none.
 *
 *   <SortableHead label="Amount" field="amount"
 *     sort={{ by: 'amount', dir: 'desc' }}
 *     onSort={(by, dir) => ...} />
 *
 * `field` must be a backend-whitelisted sort key for the list endpoint.
 */
export function SortableHead({ label, field, sort, onSort, className }) {
  const active = sort?.by === field;
  const dir = active ? sort.dir : null;

  const cycle = () => {
    if (!active) return onSort(field, 'desc');
    if (dir === 'desc') return onSort(field, 'asc');
    return onSort(null, null); // back to default ordering
  };

  return (
    <TableHead className={cn('cursor-pointer select-none hover:text-foreground', className)} onClick={cycle} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); } }}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />
        )}
      </span>
    </TableHead>
  );
}
