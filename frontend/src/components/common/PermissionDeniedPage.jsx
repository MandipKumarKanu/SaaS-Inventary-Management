import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { ShieldAlert, ArrowRight, Building2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { CreateWorkspaceModal } from '../../pages/settings/CreateWorkspaceModal';

/**
 * Phase 9 (PRD §54): full-page permission denial.
 * Used by RouteGuard on gated routes and as <Can> fallback for page-level
 * denials. The server is the authority — this only explains the 403 the
 * member would otherwise hit.
 */
export function PermissionDeniedPage({ permission, title, description }) {
  const navigate = useNavigate();
  const { workspaces, activeWorkspace, setActiveWorkspace } = useWorkspaceStore();
  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);

  const otherWorkspaces = workspaces.filter((w) => w.id !== activeWorkspace?.id);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
        <ShieldAlert className="h-8 w-8 text-destructive" aria-hidden />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">
          {title || "You don't have access to this page"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {description ||
            (permission
              ? `This area requires the "${permission}" permission, which isn't part of your role in ${activeWorkspace?.name || 'this workspace'}. Ask a workspace admin if you need access.`
              : `This area isn't part of your role in ${activeWorkspace?.name || 'this workspace'}. Ask a workspace admin if you need access.`)}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => navigate(-1)} variant="outline">
          Go back
        </Button>
        {workspaces.length === 0 ? (
          <Button onClick={() => setIsCreateWsOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Create Workspace
          </Button>
        ) : (
          <Button asChild>
            <Link to="/app">
              Dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
      {otherWorkspaces.length > 0 && (
        <div className="mt-2 max-w-xs space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Or switch workspace
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {otherWorkspaces.slice(0, 4).map((w) => (
              <Button
                key={w.id}
                variant="secondary"
                size="sm"
                onClick={() => {
                  setActiveWorkspace(w);
                  navigate(`/app/${w.slug}`);
                }}
              >
                <Building2 className="h-3.5 w-3.5" />
                {w.name}
              </Button>
            ))}
          </div>
        </div>
      )}
      {isCreateWsOpen && (
        <CreateWorkspaceModal onClose={() => setIsCreateWsOpen(false)} />
      )}
    </div>
  );
}
