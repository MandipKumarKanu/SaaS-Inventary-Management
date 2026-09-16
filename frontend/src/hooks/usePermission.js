import { useWorkspaceStore } from '../store/useWorkspaceStore';

/**
 * Phase 9 (PRD §11/§13): permission hooks.
 *
 * Permissions come from GET /members/me (effective = roles + direct grants),
 * already loaded into useWorkspaceStore by fetchCurrentMember. The backend
 * remains the authority — this only shapes what the UI shows.
 */
export function usePermissions() {
  return useWorkspaceStore((s) => s.permissions);
}

/** anyOf semantics when passed an array. */
export function usePermission(code) {
  const permissions = usePermissions();
  const codes = Array.isArray(code) ? code : [code];
  if (codes.length === 0) return true;
  return codes.some((c) => permissions.includes(c));
}

/** allOf semantics. */
export function useAllPermissions(codes) {
  const permissions = usePermissions();
  if (!codes || codes.length === 0) return true;
  return codes.every((c) => permissions.includes(c));
}
