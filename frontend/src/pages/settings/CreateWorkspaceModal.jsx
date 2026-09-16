import { useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { Plus } from 'lucide-react';
import { Field, FormError } from '@/components/common/FormField';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function CreateWorkspaceModal({ onClose }) {
  const { createWorkspace } = useWorkspaceStore();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);
    setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !slug) return;
    setIsLoading(true);
    setError(null);

    try {
      await createWorkspace(name, slug);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Workspace</DialogTitle>
          <DialogDescription>Set up an isolated tenant organization</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Workspace Name" htmlFor="new-workspace-name" required>
            <Input
              id="new-workspace-name"
              type="text"
              required
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Acme Global Logistics"
            />
          </Field>

          <Field
            label="URL Slug"
            htmlFor="new-workspace-slug"
            required
            hint="Unique identifier for your workspace domain"
          >
            <Input
              id="new-workspace-slug"
              type="text"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-global"
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                'Creating...'
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create Workspace
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
