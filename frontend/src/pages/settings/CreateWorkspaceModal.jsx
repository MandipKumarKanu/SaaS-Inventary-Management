import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Plus, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { Field, FormError } from '@/components/common/FormField';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { formatSlugInput, sanitizeSlug } from '@/lib/utils';
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

export function CreateWorkspaceModal({ onClose }) {
  const navigate = useNavigate();
  const { createWorkspace, workspaces } = useWorkspaceStore();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [currency, setCurrency] = useState('NPR');
  const [isUserEditedSlug, setIsUserEditedSlug] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Slug validation & availability states
  const [slugStatus, setSlugStatus] = useState(null); // { type: 'checking' | 'available' | 'taken' | 'invalid', message: string }

  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);
    if (!isUserEditedSlug) {
      const generated = sanitizeSlug(val);
      setSlug(generated);
    }
  };

  const notifySlugSanitization = () => {
    toast.info('Spaces and special characters were automatically converted to hyphens.', {
      id: 'slug-sanitization-toast',
      duration: 3000,
    });
  };

  const handleSlugChange = (e) => {
    setIsUserEditedSlug(true);
    const rawValue = e.target.value;
    const formatted = formatSlugInput(rawValue, notifySlugSanitization);
    setSlug(formatted);
  };

  // Real-time slug validation & availability checking effect
  useEffect(() => {
    if (!slug) {
      setSlugStatus(null);
      return;
    }

    // Check slug format
    const isValidFormat = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
    if (!isValidFormat) {
      setSlugStatus({
        type: 'invalid',
        message: 'Slug must be lowercase alphanumeric with hyphens (e.g. acme-corp)',
      });
      return;
    }

    // Check local workspace store first
    const isTakenLocally = workspaces.some((w) => w.slug === slug);
    if (isTakenLocally) {
      setSlugStatus({
        type: 'taken',
        message: 'This workspace slug is already taken',
      });
      return;
    }

    // Check backend API with debounce
    setSlugStatus({ type: 'checking', message: 'Checking availability...' });
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/workspaces/check-slug?slug=${encodeURIComponent(slug)}`);
        if (cancelled) return;
        if (res?.data?.available) {
          setSlugStatus({ type: 'available', message: 'Slug is available!' });
        } else {
          setSlugStatus({
            type: 'taken',
            message: res?.data?.message || 'This workspace slug is already taken',
          });
        }
      } catch {
        if (!cancelled) {
          // If check-slug endpoint fails or is unreachable, fallback to format check
          setSlugStatus({ type: 'available', message: 'Slug format is valid' });
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, workspaces]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !slug) return;

    if (slugStatus?.type === 'invalid' || slugStatus?.type === 'taken') {
      toast.error(slugStatus.message, { id: 'slug-submit-error' });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const cleanSlug = sanitizeSlug(slug);
      const newWs = await createWorkspace(name, cleanSlug, currency);
      toast.success('Workspace created successfully!');
      if (newWs?.slug) {
        navigate(`/app/${newWs.slug}/dashboard`);
      }
      onClose();
    } catch (err) {
      setError(err.message);
      toast.error(err.message || 'Failed to create workspace', { id: 'create-ws-err' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create New Workspace</DialogTitle>
          <DialogDescription>Set up an isolated tenant organization for your business</DialogDescription>
        </DialogHeader>

        <FormError error={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <Field label="Workspace Name" htmlFor="new-workspace-name" required>
            <Input
              id="new-workspace-name"
              type="text"
              required
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Acme Global Logistics"
              className="w-full"
            />
          </Field>

          <Field
            label="URL Slug"
            htmlFor="new-workspace-slug"
            required
            hint="Unique identifier for your workspace domain (e.g. acme-global)"
          >
            <div className="space-y-1.5">
              <div className="relative">
                <Input
                  id="new-workspace-slug"
                  type="text"
                  required
                  value={slug}
                  onChange={handleSlugChange}
                  placeholder="acme-global"
                  className={
                    slugStatus?.type === 'taken' || slugStatus?.type === 'invalid'
                      ? 'border-destructive focus-visible:ring-destructive'
                      : slugStatus?.type === 'available'
                      ? 'border-emerald-500 focus-visible:ring-emerald-500'
                      : ''
                  }
                />
              </div>

              {/* Real-time status feedback badge */}
              {slugStatus && (
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  {slugStatus.type === 'checking' && (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground">{slugStatus.message}</span>
                    </>
                  )}
                  {slugStatus.type === 'available' && (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-emerald-600 dark:text-emerald-400">{slugStatus.message}</span>
                    </>
                  )}
                  {slugStatus.type === 'taken' && (
                    <>
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                      <span className="text-destructive">{slugStatus.message}</span>
                    </>
                  )}
                  {slugStatus.type === 'invalid' && (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      <span className="text-amber-600 dark:text-amber-400">{slugStatus.message}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </Field>

          <Field
            label="Default Currency"
            htmlFor="new-workspace-currency"
            required
            hint="Primary base currency used for pricing, inventory valuation, and orders"
          >
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="new-workspace-currency" className="w-full">
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

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || slugStatus?.type === 'taken' || slugStatus?.type === 'invalid'}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Workspace
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
