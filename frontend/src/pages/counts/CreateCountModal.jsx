import React, { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Field, FormError } from '@/components/common/FormField';
import { toast } from '@/components/ui/sonner';

export function CreateCountModal({ isOpen, onClose, onSuccess }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !activeWorkspace) return;
    async function loadWarehouses() {
      try {
        const res = await api.get(`/workspaces/${activeWorkspace.id}/warehouses`);
        setWarehouses(res.data || []);
        if (res.data?.length > 0) setWarehouseId(res.data[0].id);
      } catch (err) {
        console.error('Failed to load warehouses for count modal:', err);
      }
    }
    loadWarehouses();
  }, [isOpen, activeWorkspace]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!warehouseId) {
      setError('Please select a target warehouse for cycle count audit.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/counts`, {
        warehouseId,
        notes,
      });
      toast.success('Cycle count started');
      onSuccess();
      onClose();
    } catch (err) {
      const message = err.message || 'Failed to create count sheet';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>New Cycle Count Sheet</DialogTitle>
          <DialogDescription>Snapshot system inventory and start a physical audit</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Target Warehouse" required>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="Select Warehouse..." />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Audit Purpose / Notes">
            <Input
              type="text"
              placeholder="e.g. Monthly Physical Count Audit"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating Snapshot...' : 'Start Cycle Count'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
