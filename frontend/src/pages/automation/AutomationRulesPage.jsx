import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Field } from '@/components/common/FormField';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';

const TRIGGER_OPTIONS = [
  { value: 'LOW_STOCK', label: 'Trigger: Stock ≤ Reorder Point' },
  { value: 'EXPIRING_BATCH', label: 'Trigger: Batch Nearing Expiry' },
  { value: 'SUPPLIER_DELAY', label: 'Trigger: PO Receiving Delayed' },
];

const ACTION_OPTIONS = [
  { value: 'AUTO_CREATE_PO', label: 'Action: Auto-Create Draft PO' },
  { value: 'SEND_NOTIFICATION', label: 'Action: Send Critical Alert' },
  { value: 'DISPATCH_WEBHOOK', label: 'Action: Dispatch External Webhook' },
];

export function AutomationRulesPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [rules, setRules] = useState([]);
  const [name, setName] = useState('');
  const [triggerEvent, setTriggerEvent] = useState('LOW_STOCK');
  const [actionType, setActionType] = useState('AUTO_CREATE_PO');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const loadRules = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/automation`);
      setRules(res.data || []);
    } catch (err) {
      console.error('Failed to load automation rules:', err);
      setError(err.message || 'Failed to load automation rules');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, [activeWorkspace]);

  const resetForm = () => {
    setName('');
    setTriggerEvent('LOW_STOCK');
    setActionType('AUTO_CREATE_PO');
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleCreateRule = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/automation`, {
        name,
        triggerEvent,
        actionType,
        conditions: { threshold_percentage: 100 },
      });
      toast.success('Automation rule created');
      resetForm();
      setIsDialogOpen(false);
      loadRules();
    } catch (err) {
      toast.error(err.message || 'Failed to create rule');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleRule = async (ruleId, currentStatus) => {
    try {
      await api.patch(`/workspaces/${activeWorkspace.id}/automation/${ruleId}/toggle`, {
        isActive: !currentStatus,
      });
      loadRules();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    try {
      await api.delete(`/workspaces/${activeWorkspace.id}/automation/${ruleId}`);
      toast.success('Automation rule deleted');
      loadRules();
    } catch (err) {
      toast.error(err.message || 'Failed to delete rule');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="PO Auto-Pilot & Workflow Automation"
        description="Set up automated trigger rules to auto-generate Purchase Orders, send notifications, and dispatch webhooks when stock hits reorder thresholds"
        actions={
          <Button onClick={handleOpenCreate}>
            <Plus />
            New rule
          </Button>
        }
      />

      <DataTable
        head={
          <>
            <TableHead>Rule name</TableHead>
            <TableHead>Trigger event</TableHead>
            <TableHead>Action executed</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </>
        }
        columns={6}
        colSpan={6}
        isLoading={isLoading}
        loadingMessage="Loading automation rules…"
        error={error}
        onRetry={loadRules}
        errorTitle="Couldn't load automation rules"
        isEmpty={rules.length === 0}
        emptyTitle="No automation rules configured"
        emptyDescription="Create your first auto-pilot workflow rule to automate purchase orders, alerts, and webhooks."
        emptyAction={
          <Button size="sm" onClick={handleOpenCreate}>
            <Plus />
            Create rule
          </Button>
        }
      >
        {rules.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-semibold">{r.name}</TableCell>
            <TableCell>
              <code className="font-mono text-xs text-warning">{r.trigger_event}</code>
            </TableCell>
            <TableCell>
              <code className="font-mono text-xs text-success">{r.action_type}</code>
            </TableCell>
            <TableCell>
              <StatusBadge status={r.is_active ? 'active' : 'paused'}>{r.is_active ? 'Active' : 'Paused'}</StatusBadge>
            </TableCell>
            <TableCell>
              <Switch
                checked={r.is_active}
                onCheckedChange={() => handleToggleRule(r.id, r.is_active)}
                aria-label={r.is_active ? `Pause ${r.name}` : `Activate ${r.name}`}
              />
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">
                <ConfirmDialog
                  title="Delete automation rule?"
                  description={`"${r.name}" will be permanently removed. This action cannot be undone.`}
                  confirmLabel="Delete"
                  onConfirm={() => handleDeleteRule(r.id)}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${r.name}`}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  }
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create automation rule</DialogTitle>
            <DialogDescription>
              Auto-generate purchase orders, alerts, or webhooks when stock hits reorder thresholds.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateRule} className="grid gap-4">
            <Field label="Rule name" htmlFor="rule-name" required>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Auto-Reorder Critical Laptops"
              />
            </Field>
            <Field label="Trigger event" htmlFor="rule-trigger">
              <RadioGroup value={triggerEvent} onValueChange={setTriggerEvent} className="grid gap-2">
                {TRIGGER_OPTIONS.map((o) => (
                  <div key={o.value} className="flex items-center gap-2">
                    <RadioGroupItem value={o.value} id={`rule-trigger-${o.value}`} />
                    <Label htmlFor={`rule-trigger-${o.value}`}>{o.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </Field>
            <Field label="Action" htmlFor="rule-action">
              <RadioGroup value={actionType} onValueChange={setActionType} className="grid gap-2">
                {ACTION_OPTIONS.map((o) => (
                  <div key={o.value} className="flex items-center gap-2">
                    <RadioGroupItem value={o.value} id={`rule-action-${o.value}`} />
                    <Label htmlFor={`rule-action-${o.value}`}>{o.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? 'Creating…' : 'Create rule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
