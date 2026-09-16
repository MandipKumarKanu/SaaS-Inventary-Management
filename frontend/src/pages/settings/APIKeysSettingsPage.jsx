import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Key, Plus, Trash2, Copy, Check } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { PaginationBar } from '@/components/common/PaginationBar';
import { usePagination } from '@/hooks/usePagination';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { toast } from '@/components/ui/sonner';

export function APIKeysSettingsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState('');
  const [newRawSecret, setNewRawSecret] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);
  const { page, setPage, pageSize, total, totalPages, applyMeta } = usePagination();

  const loadKeys = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/api-keys?page=${page}&pageSize=${pageSize}`);
      setKeys(res.data || []);
      applyMeta(res.meta);
    } catch (err) {
      console.error('Failed to load API keys:', err);
      setError(err.message || 'Failed to load API keys');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, [activeWorkspace, page]);

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      const res = await api.post(`/workspaces/${activeWorkspace.id}/api-keys`, { name });
      setNewRawSecret(res.data.rawSecret);
      setName('');
      loadKeys();
    } catch (err) {
      toast.error(err.message || 'Failed to generate API key');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (id) => {
    try {
      await api.delete(`/workspaces/${activeWorkspace.id}/api-keys/${id}`);
      loadKeys();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCopy = () => {
    if (!newRawSecret) return;
    navigator.clipboard.writeText(newRawSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Developer API Keys"
        description="Manage REST API tokens for external ERP, eCommerce, and WMS integrations"
      />

      {newRawSecret && (
        <Alert variant="success">
          <Key className="h-4 w-4" />
          <AlertTitle>API Key Generated Successfully!</AlertTitle>
          <AlertDescription>
            <span className="mb-3 block">
              Please copy your secret key now. <strong>You will not be able to see it again!</strong>
            </span>
            <span className="flex items-center gap-2">
              <Input type="text" readOnly value={newRawSecret} className="font-mono font-bold" />
              <Button type="button" onClick={handleCopy} className="shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied!' : 'Copy Key'}
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Generate Scoped API Key</CardTitle>
          <CardDescription>Create a new token for an external integration.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateKey} className="flex gap-3">
            <Input
              type="text"
              placeholder="Key Name e.g. Shopify Store Production"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="flex-1"
            />
            <Button type="submit" disabled={isCreating} className="shrink-0">
              <Plus className="h-4 w-4" />
              {isCreating ? 'Generating...' : 'Generate Secret Key'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <DataTable
          head={
            <>
              <TableHead>Key Name</TableHead>
              <TableHead>Token Prefix</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </>
          }
          isLoading={isLoading}
          isEmpty={!isLoading && keys.length === 0}
          error={error}
          onRetry={loadKeys}
          errorTitle="Couldn't load API keys"
          colSpan={5}
          columns={5}
          emptyTitle="No developer API keys active."
        >
          {keys.map((k) => (
            <TableRow key={k.id}>
              <TableCell className="font-bold">{k.name}</TableCell>
              <TableCell className="font-mono text-primary">{k.key_prefix}...</TableCell>
              <TableCell>
                <Badge>read:write</Badge>
              </TableCell>
              <TableCell className="text-[13px] text-muted-foreground">
                {new Date(k.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                <ConfirmDialog
                  title="Revoke this API key?"
                  description="External systems using it will lose access immediately."
                  confirmLabel="Revoke"
                  onConfirm={() => handleRevoke(k.id)}
                  trigger={
                    <Button variant="outline" size="sm" className="text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                      Revoke
                    </Button>
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </Card>

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
