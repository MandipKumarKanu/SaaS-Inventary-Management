import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Plus } from 'lucide-react';
import { Field, FormError } from '@/components/common/FormField';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export function CreateRoleModal({ onClose, onRoleCreated }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [availablePermissions, setAvailablePermissions] = useState([]);
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchPermissions() {
      try {
        const res = await api.get('/permissions');
        setAvailablePermissions(res.data || []);
      } catch (err) {
        console.error('Failed to load system permissions:', err);
      }
    }
    fetchPermissions();
  }, []);

  const togglePermission = (code) => {
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name) return;
    setIsLoading(true);
    setError(null);

    try {
      await api.post(`/workspaces/${activeWorkspace.id}/roles`, {
        name,
        description,
        permissionCodes: selectedCodes,
      });

      if (onRoleCreated) onRoleCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Custom Role</DialogTitle>
          <DialogDescription>Define granular permission policy for workspace</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Role Name" htmlFor="role-name" required>
            <Input
              id="role-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Inventory Manager"
            />
          </Field>

          <Field label="Description (Optional)" htmlFor="role-description">
            <Input
              id="role-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Full access to manage stock and view reports"
            />
          </Field>

          <div className="mt-1 flex flex-col gap-2.5">
            <Label>Select Permissions ({selectedCodes.length} selected)</Label>
            <div className="grid max-h-60 gap-2 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 md:grid-cols-2">
              {availablePermissions.map((perm) => {
                const isChecked = selectedCodes.includes(perm.code);
                return (
                  <Label
                    key={perm.id || perm.code}
                    htmlFor={`perm-${perm.code}`}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2.5 text-sm transition-colors ${
                      isChecked ? 'border-primary bg-primary/10' : 'border-border bg-card'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Checkbox
                        id={`perm-${perm.code}`}
                        checked={isChecked}
                        onCheckedChange={() => togglePermission(perm.code)}
                      />
                      <span>
                        <span className={`block text-xs font-semibold ${isChecked ? 'text-primary' : ''}`}>
                          {perm.code}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {perm.description || perm.group_name}
                        </span>
                      </span>
                    </span>
                  </Label>
                );
              })}
            </div>
          </div>

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
                  Create Role
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
