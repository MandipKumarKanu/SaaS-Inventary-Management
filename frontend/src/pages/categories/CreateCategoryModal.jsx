import { useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError } from '@/components/common/FormField';
import { toast } from '@/components/ui/sonner';

export function CreateCategoryModal({ onClose, onCategoryCreated }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
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
      await api.post(`/workspaces/${activeWorkspace.id}/categories`, {
        name,
        slug,
        description,
      });

      if (onCategoryCreated) onCategoryCreated();
      toast.success('Category created');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Category</DialogTitle>
          <DialogDescription>Organize products into hierarchical categories</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Category Name" htmlFor="category-name" required>
            <Input
              id="category-name"
              type="text"
              required
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Electronics & Gadgets"
            />
          </Field>

          <Field label="Slug" htmlFor="category-slug" required>
            <Input
              id="category-slug"
              type="text"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="electronics-gadgets"
            />
          </Field>

          <Field label="Description (Optional)" htmlFor="category-description">
            <Input
              id="category-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Laptops, smartphones, audio gear"
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>{isLoading ? 'Saving...' : 'Create Category'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
