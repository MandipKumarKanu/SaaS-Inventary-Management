import { Outlet } from 'react-router';
import { Boxes } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-[440px]">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Boxes className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            Inventory <span className="text-primary">SaaS Engine</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Multi-Tenant Warehouse &amp; Inventory Management</p>
        </div>

        <Card>
          <CardContent className="p-8">
            <Outlet />
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          General inventory management system
        </p>
      </div>
    </div>
  );
}
