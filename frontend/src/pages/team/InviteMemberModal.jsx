import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Send } from 'lucide-react';
import { Field, FormError } from '@/components/common/FormField';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DEFAULT_ROLE_VALUE = 'default';

export function InviteMemberModal({ onClose, onInvitationCreated }) {
  const { activeWorkspace } = useWorkspaceStore();
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roles, setRoles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!activeWorkspace) return;
    async function loadRoles() {
      try {
        const res = await api.get(`/workspaces/${activeWorkspace.id}/roles`);
        setRoles(res.data || []);
      } catch (err) {
        console.error('Failed to load roles for invitation:', err);
      }
    }
    loadRoles();
  }, [activeWorkspace]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    setError(null);
    setSuccessMsg('');

    try {
      await api.post(`/workspaces/${activeWorkspace.id}/invitations`, {
        email,
        roleId: roleId || undefined,
      });

      setSuccessMsg(`Invitation sent to ${email}`);
      setEmail('');
      if (onInvitationCreated) onInvitationCreated();
      setTimeout(() => {
        onClose();
      }, 1500);
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
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>Send invitation to join {activeWorkspace?.name}</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        {successMsg && (
          <Alert variant="success">
            <AlertDescription>{successMsg}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Email Address" htmlFor="invite-email" required>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
            />
          </Field>

          <Field label="Assign Role (Optional)" htmlFor="invite-role">
            <Select
              value={roleId || DEFAULT_ROLE_VALUE}
              onValueChange={(v) => setRoleId(v === DEFAULT_ROLE_VALUE ? '' : v)}
            >
              <SelectTrigger id="invite-role">
                <SelectValue placeholder="Default Member Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_ROLE_VALUE}>Default Member Role</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} {r.is_system ? '(System)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                'Sending...'
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send Invitation
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
