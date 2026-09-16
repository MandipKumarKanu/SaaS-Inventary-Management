import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { cn } from '@/lib/utils';

export function TableSkeleton({ columns = 4, rows = 5 }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {Array.from({ length: columns }).map((_, i) => (
            <TableHead key={i}>
              <Skeleton className="h-3 w-20" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }).map((_, r) => (
          <TableRow key={r}>
            {Array.from({ length: columns }).map((_, c) => (
              <TableCell key={c}>
                <Skeleton className="h-4 w-full max-w-[180px]" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function LoadingState({ message = 'Loading…', className }) {
  return (
    <div className={cn('flex items-center justify-center gap-3 px-6 py-12 text-sm text-muted-foreground', className)}>
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

/**
 * DataTable — single table pattern for the whole app.
 * Pass columns as <TableHead> cells via `head`, rows as children.
 */
export function DataTable({
  head,
  children,
  isLoading,
  isEmpty,
  error,
  onRetry,
  colSpan = 6,
  loadingMessage,
  emptyTitle,
  emptyDescription,
  emptyAction,
  errorTitle,
  columns = 4,
}) {
  if (isLoading) {
    return loadingMessage ? (
      <div className="rounded-xl border border-border bg-card">
        <LoadingState message={loadingMessage} />
      </div>
    ) : (
      <TableSkeleton columns={columns} />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>{head}</TableRow>
      </TableHeader>
      <TableBody>
        {error ? (
          <TableRow>
            <TableCell colSpan={colSpan} className="p-0">
              <ErrorState title={errorTitle} description={typeof error === 'string' ? error : undefined} onRetry={onRetry} />
            </TableCell>
          </TableRow>
        ) : isEmpty ? (
          <TableRow>
            <TableCell colSpan={colSpan} className="p-0">
              <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
            </TableCell>
          </TableRow>
        ) : (
          children
        )}
      </TableBody>
    </Table>
  );
}
