import { useCallback, useState } from 'react';

export const DEFAULT_PAGE_SIZE = 25;

/**
 * usePagination — server-side pagination state.
 * Backend pages return `{ data, meta: { page, pageSize, total, totalPages } }`
 * (see products/inventory/members routes). Feed `res.meta` into `applyMeta`.
 */
export function usePagination(initialPageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(initialPageSize);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const resetPage = useCallback(() => setPage(1), []);

  const applyMeta = useCallback((meta) => {
    if (!meta) return;
    setTotal(meta.total ?? 0);
    setTotalPages(meta.totalPages ?? 0);
  }, []);

  return { page, setPage, pageSize, total, totalPages, resetPage, applyMeta };
}
