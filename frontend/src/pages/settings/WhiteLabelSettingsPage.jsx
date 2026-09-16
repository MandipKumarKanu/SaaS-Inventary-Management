import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Palette, Image, Save } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Field, FormSection } from '@/components/common/FormField';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';

export function WhiteLabelSettingsPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [branding, setBranding] = useState({
    company_name: '',
    logo_url: '',
    primary_color: '#6366f1',
    accent_color: '#10b981',
    company_address: '',
    tax_id: '',
    invoice_footer_text: 'Thank you for your business!',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadBranding = async () => {
    if (!activeWorkspace) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/branding`);
      if (res.data) {
        setBranding(res.data);
      }
    } catch (err) {
      console.error('Failed to load branding:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBranding();
  }, [activeWorkspace]);

  const handleSaveBranding = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await api.post(`/workspaces/${activeWorkspace.id}/branding`, branding);
      toast.success('White-label branding settings saved successfully!');
    } catch (err) {
      toast.error(err.message || 'Failed to update branding');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="White-Label Custom Branding"
        description="Customize your company logo, primary theme colors, tax ID, and purchase/sales invoice header branding"
      />

      <form onSubmit={handleSaveBranding} className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-[18px] w-[18px] text-primary" />
              Theme Palette & Colors
            </CardTitle>
            <CardDescription>Brand colors applied to invoices and shared documents.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSection>
              <Field label="Primary Accent Color" htmlFor="primary-color">
                <div className="flex items-center gap-2.5">
                  <Input
                    id="primary-color"
                    type="color"
                    value={branding.primary_color}
                    onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                    className="h-10 w-12 cursor-pointer p-1"
                  />
                  <Input
                    type="text"
                    value={branding.primary_color}
                    onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </Field>
              <Field label="Secondary Highlight Color" htmlFor="accent-color">
                <div className="flex items-center gap-2.5">
                  <Input
                    id="accent-color"
                    type="color"
                    value={branding.accent_color}
                    onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })}
                    className="h-10 w-12 cursor-pointer p-1"
                  />
                  <Input
                    type="text"
                    value={branding.accent_color}
                    onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </Field>
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Image className="h-[18px] w-[18px] text-success" />
              Logo & Organization Identity
            </CardTitle>
            <CardDescription>Company details shown on invoice headers.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSection>
              <Field label="Company Name" htmlFor="company-name">
                <Input
                  id="company-name"
                  type="text"
                  placeholder="e.g. Acme Global Logistics Corp"
                  value={branding.company_name || ''}
                  onChange={(e) => setBranding({ ...branding, company_name: e.target.value })}
                />
              </Field>
              <Field label="Custom Logo URL" htmlFor="logo-url">
                <Input
                  id="logo-url"
                  type="url"
                  placeholder="https://example.com/logo.png"
                  value={branding.logo_url || ''}
                  onChange={(e) => setBranding({ ...branding, logo_url: e.target.value })}
                />
              </Field>
              <Field label="Tax ID / VAT Number" htmlFor="tax-id">
                <Input
                  id="tax-id"
                  type="text"
                  placeholder="e.g. US-8910284912"
                  value={branding.tax_id || ''}
                  onChange={(e) => setBranding({ ...branding, tax_id: e.target.value })}
                />
              </Field>
              <Field label="Company Registered Address" htmlFor="company-address">
                <Input
                  id="company-address"
                  type="text"
                  placeholder="100 Enterprise Blvd, Suite 400, NY"
                  value={branding.company_address || ''}
                  onChange={(e) => setBranding({ ...branding, company_address: e.target.value })}
                />
              </Field>
            </FormSection>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={isSaving || isLoading}>
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving Settings...' : 'Save Custom Branding'}
          </Button>
        </div>
      </form>
    </div>
  );
}
