import { usePermission, useAllPermissions } from '../../hooks/usePermission';

/**
 * Phase 9 (PRD §11/§13): conditional render by permission.
 *
 *   <Can permission="products.create">
 *     <Button>Add product</Button>
 *   </Can>
 *
 * Array = anyOf by default; pass requireAll for allOf. Renders nothing when
 * denied unless `fallback` is provided (element or render-prop).
 */
export function Can({
  permission,
  requireAll = false,
  fallback = null,
  children,
}) {
  const allowed = requireAll
    ? useAllPermissions(Array.isArray(permission) ? permission : [permission])
    : usePermission(permission);

  if (allowed) return <>{children}</>;
  return typeof fallback === 'function' ? fallback() : fallback;
}
