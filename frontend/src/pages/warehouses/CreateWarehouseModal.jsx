import { useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError } from '@/components/common/FormField';
import { toast } from '@/components/ui/sonner';

export function CreateWarehouseModal({ onClose, onWarehouseCreated }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);
    if (!code) {
      setCode('WH-' + val.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 6));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !code) return;
    setIsLoading(true);
    setError(null);

    try {
      await api.post(`/workspaces/${activeWorkspace.id}/warehouses`, {
        name,
        code,
        address: address || undefined,
        contactNumber: contactNumber || undefined,
      });

      if (onWarehouseCreated) onWarehouseCreated();
      toast.success('Warehouse created');
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
          <DialogTitle>Add Warehouse</DialogTitle>
          <DialogDescription>Set up new storage facility in {activeWorkspace?.name}</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Warehouse Name" htmlFor="warehouse-name" required>
            <Input
              id="warehouse-name"
              type="text"
              required
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Main Distribution Center"
            />
          </Field>

          <Field label="Warehouse Code (Unique)" htmlFor="warehouse-code" required>
            <Input
              id="warehouse-code"
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="WH-MAIN"
            />
          </Field>

          <Field label="Address (Optional)" htmlFor="warehouse-address">
            <Input
              id="warehouse-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 100 Logistics Blvd, Industrial Zone"
            />
          </Field>

          <Field label="Contact Number (Optional)" htmlFor="warehouse-contact">
            <Input
              id="warehouse-contact"
              type="text"
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              placeholder="+1 (555) 019-2834"
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>{isLoading ? 'Creating...' : 'Create Warehouse'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
