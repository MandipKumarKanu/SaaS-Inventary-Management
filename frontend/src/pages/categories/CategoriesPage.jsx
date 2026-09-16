import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { CreateCategoryModal } from './CreateCategoryModal';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { Button } from '@/components/ui/button';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/sonner';

export function CategoriesPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [categories, setCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { page, setPage, pageSize, total, totalPages, applyMeta } = usePagination();

  const loadCategories = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/categories?page=${page}&pageSize=${pageSize}`);
      setCategories(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load categories:', err);
      setError(err.message || 'Failed to load categories');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, [activeWorkspace, page]);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/workspaces/${activeWorkspace.id}/categories/${id}`);
      loadCategories();
      toast.success('Category deleted');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Product Categories"
        description={`Organize inventory items into hierarchical taxonomy for ${activeWorkspace?.name}`}
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus />
            <span>Add Category</span>
          </Button>
        }
      />

      <DataTable
        head={
          <>
            <TableHead>Category Name</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </>
        }
        isLoading={isLoading}
        isEmpty={!isLoading && categories.length === 0}
        error={error}
        onRetry={loadCategories}
        errorTitle="Couldn't load categories"
        colSpan={5}
        columns={5}
        loadingMessage="Loading categories..."
        emptyTitle="No categories yet"
        emptyDescription="No categories created yet."
      >
        {categories.map((cat) => (
          <TableRow key={cat.id}>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <Tag className="h-4 w-4 text-primary" />
                <span className="font-semibold">{cat.name}</span>
              </div>
            </TableCell>
            <TableCell>
              <code className="text-xs">{cat.slug}</code>
            </TableCell>
            <TableCell className="text-[13px] text-muted-foreground">
              {cat.description || '—'}
            </TableCell>
            <TableCell className="text-[13px] text-muted-foreground">
              {new Date(cat.created_at).toLocaleDateString()}
            </TableCell>
            <TableCell className="text-right">
              <ConfirmDialog
                title="Delete category?"
                description="This action cannot be undone. Products in this category will become uncategorized."
                confirmLabel="Delete"
                onConfirm={() => handleDelete(cat.id)}
                trigger={
                  <Button variant="destructive" size="sm">
                    <Trash2 />
                  </Button>
                }
              />
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

      {isModalOpen && (
        <CreateCategoryModal
          onClose={() => setIsModalOpen(false)}
          onCategoryCreated={loadCategories}
        />
      )}
    </div>
  );
}
