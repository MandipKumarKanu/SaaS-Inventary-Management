import { useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError } from '@/components/common/FormField';
import { toast } from '@/components/ui/sonner';

export function CreateSupplierModal({ isOpen, onClose, onSuccess }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30');
  const [leadTimeDays, setLeadTimeDays] = useState(7);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/suppliers`, {
        name,
        contactName,
        email: email || undefined,
        phone,
        address,
        taxId,
        paymentTerms,
        leadTimeDays: Number(leadTimeDays),
      });
      onSuccess();
      toast.success('Supplier created');
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create supplier');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Add New Supplier</DialogTitle>
          <DialogDescription>Register a vendor profile in {activeWorkspace?.name}</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Supplier Company Name" htmlFor="supplier-name" required className="sm:col-span-2">
            <Input
              id="supplier-name"
              type="text"
              required
              placeholder="e.g. Acme Global Logistics"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Contact Person" htmlFor="supplier-contact">
            <Input
              id="supplier-contact"
              type="text"
              placeholder="John Doe"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </Field>

          <Field label="Email" htmlFor="supplier-email">
            <Input
              id="supplier-email"
              type="email"
              placeholder="john@acme.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Phone" htmlFor="supplier-phone">
            <Input
              id="supplier-phone"
              type="text"
              placeholder="+1 (555) 000-0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>

          <Field label="Lead Time (Days)" htmlFor="supplier-leadtime">
            <Input
              id="supplier-leadtime"
              type="number"
              min="1"
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(e.target.value)}
            />
          </Field>

          <Field label="Address" htmlFor="supplier-address" className="sm:col-span-2">
            <Input
              id="supplier-address"
              type="text"
              placeholder="123 Supply Chain Way, Suite 400"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Add Supplier'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
