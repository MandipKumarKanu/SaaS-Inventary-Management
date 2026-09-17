import { useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Save, Copy, Check } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Field } from '@/components/common/FormField';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const CURRENCY_OPTIONS = [
  { code: 'NPR', label: 'NPR – Nepalese Rupee (रू)' },
  { code: 'INR', label: 'INR – Indian Rupee (₹)' },
  { code: 'USD', label: 'USD – US Dollar ($)' },
  { code: 'EUR', label: 'EUR – Euro (€)' },
  { code: 'GBP', label: 'GBP – British Pound (£)' },
  { code: 'AUD', label: 'AUD – Australian Dollar (A$)' },
  { code: 'CAD', label: 'CAD – Canadian Dollar (C$)' },
  { code: 'AED', label: 'AED – UAE Dirham (AED)' },
  { code: 'SGD', label: 'SGD – Singapore Dollar (S$)' },
  { code: 'JPY', label: 'JPY – Japanese Yen (¥)' },
];

export function WorkspaceSettingsPage() {
  const { activeWorkspace, fetchWorkspaces } = useWorkspaceStore();
  const [name, setName] = useState(activeWorkspace?.name || '');
  const [currency, setCurrency] = useState(
    activeWorkspace?.settings?.currency || activeWorkspace?.settings?.default_currency || 'NPR'
  );
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);

  if (!activeWorkspace) return null;

  const handleCopyId = () => {
    navigator.clipboard.writeText(activeWorkspace.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      const updatedSettings = {
        ...(activeWorkspace.settings || {}),
        currency: currency.toUpperCase(),
        default_currency: currency.toUpperCase(),
      };
      await api.patch(`/workspaces/${activeWorkspace.id}`, {
        name,
        settings: updatedSettings,
      });
      setMessage({ type: 'success', text: 'Workspace details updated successfully!' });
      fetchWorkspaces();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Workspace Settings"
        description={`Manage preferences and configuration for ${activeWorkspace.name}`}
      />

      {message && (
        <Alert variant={message.type === 'success' ? 'success' : 'destructive'}>
          {message.type === 'success' ? <Check className="h-4 w-4" /> : null}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>General Details</CardTitle>
          <CardDescription>Update workspace name, default currency, and view identifiers.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field label="Workspace Name" htmlFor="workspace-name" required>
              <Input
                id="workspace-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field
              label="Default Base Currency"
              htmlFor="workspace-currency"
              hint="Primary currency used for inventory pricing and valuation reports"
            >
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="workspace-currency" className="w-full">
                  <SelectValue placeholder="Select primary currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="URL Slug" htmlFor="workspace-slug" hint="Slug cannot be changed after creation.">
              <Input
                id="workspace-slug"
                type="text"
                disabled
                value={activeWorkspace.slug}
                className="cursor-not-allowed opacity-70"
              />
            </Field>

            <Field label="Workspace ID" htmlFor="workspace-id">
              <div className="flex gap-2">
                <Input
                  id="workspace-id"
                  type="text"
                  readOnly
                  value={activeWorkspace.id}
                  className="font-mono text-xs opacity-70"
                />
                <Button type="button" variant="outline" size="icon" onClick={handleCopyId} aria-label="Copy workspace ID">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </Field>

            <div className="mt-2">
              <Button type="submit" disabled={isLoading}>
                <Save className="h-4 w-4" />
                {isLoading ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
