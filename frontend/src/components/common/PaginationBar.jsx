import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

function pageItems(page, totalPages) {
  const pages = new Set([1, 2, totalPages - 1, totalPages, page - 1, page, page + 1]);
  return [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
}

/**
 * PaginationBar — "Showing X–Y of Z" + windowed page controls.
 * Renders nothing when there is a single page. Pair with `usePagination`.
 */
export function PaginationBar({ page, totalPages, total, pageSize, onPageChange }) {
  if (!totalPages || totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total ?? 0);
  const items = pageItems(page, totalPages);

  const go = (p) => (e) => {
    e.preventDefault();
    if (p >= 1 && p <= totalPages && p !== page) onPageChange(p);
  };

  let prev = 0;
  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-[13px] text-muted-foreground" aria-live="polite">
        Showing {start}–{end} of {total ?? 0}
      </p>
      <Pagination className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={go(page - 1)}
              aria-disabled={page <= 1}
              className={page <= 1 ? 'pointer-events-none opacity-50' : undefined}
            />
          </PaginationItem>
          {items.map((p) => {
            const gap = prev !== 0 && p - prev > 1;
            prev = p;
            return (
              <PaginationItem key={p}>
                {gap ? <PaginationEllipsis /> : null}
                <PaginationLink href="#" isActive={p === page} onClick={go(p)}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            );
          })}
          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={go(page + 1)}
              aria-disabled={page >= totalPages}
              className={page >= totalPages ? 'pointer-events-none opacity-50' : undefined}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
