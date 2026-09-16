import { useState } from 'react';
import { Terminal, Copy, Check, Key } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

export function PublicAPIDocsPage() {
  const [apiKey, setApiKey] = useState('sk_live_demo_1234567890abcdef');
  const [copiedEndpoint, setCopiedEndpoint] = useState(null);

  const endpoints = [
    {
      method: 'GET',
      path: '/api/v1/external/products',
      title: 'List Catalog Products',
      description: 'Fetch paginated master products and SKUs for your active workspace.',
      curl: `curl -X GET "http://localhost:5000/api/v1/external/products?limit=10" \\
  -H "X-API-Key: ${apiKey}"`,
      response: `{
  "success": true,
  "data": [
    {
      "id": "c1f7a0...",
      "sku": "SKU-IPHONE-15",
      "name": "iPhone 15 Pro Max",
      "unit": "Pcs",
      "cost_price": 999.00,
      "selling_price": 1199.00
    }
  ],
  "pagination": { "total": 1, "limit": 10, "offset": 0 }
}`,
    },
    {
      method: 'GET',
      path: '/api/v1/external/inventory',
      title: 'Query Stock Balances',
      description: 'Get real-time available and reserved inventory balances across storage facilities.',
      curl: `curl -X GET "http://localhost:5000/api/v1/external/inventory" \\
  -H "X-API-Key: ${apiKey}"`,
      response: `{
  "success": true,
  "data": [
    {
      "quantity_on_hand": 150,
      "quantity_reserved": 12,
      "quantity_available": 138,
      "products": { "sku": "SKU-IPHONE-15", "name": "iPhone 15 Pro Max" },
      "warehouses": { "name": "Main Fulfillment Center", "code": "WH-MAIN" }
    }
  ]
}`,
    },
    {
      method: 'POST',
      path: '/api/v1/external/orders',
      title: 'Ingest E-Commerce Order',
      description: 'Post an external store order payload to create a Sales Order and deduct inventory automatically.',
      curl: `curl -X POST "http://localhost:5000/api/v1/external/orders" \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "external_order_id": "SHOPIFY-1092",
    "customer_name": "John Doe",
    "customer_email": "john@example.com",
    "items": [
      { "sku": "SKU-IPHONE-15", "quantity": 2, "unit_price": 1199.00 }
    ]
  }'`,
      response: `{
  "success": true,
  "data": {
    "order_id": "9a2b...",
    "order_number": "EXT-1092-4819",
    "status": "processing",
    "total_amount": 2398.00
  }
}`,
    },
  ];

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(idx);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Public REST API Documentation"
        description="Developer reference and live endpoint tester for external ERP, Shopify, WooCommerce, and custom POS integrations"
      />

      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Key className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <Label htmlFor="api-key">Your X-API-Key token for live cURL examples</Label>
            <Input
              id="api-key"
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="mt-1.5 font-mono"
            />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="0" className="w-full">
        <TabsList>
          {endpoints.map((ep, idx) => (
            <TabsTrigger key={idx} value={String(idx)}>
              {ep.title}
            </TabsTrigger>
          ))}
        </TabsList>

        {endpoints.map((ep, idx) => (
          <TabsContent key={idx} value={String(idx)}>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={ep.method === 'GET' ? 'default' : 'success'}>
                    {ep.method}
                  </Badge>
                  <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                    {ep.path}
                  </span>
                </div>
                <CardTitle className="mt-3">{ep.title}</CardTitle>
                <CardDescription>{ep.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <Separator />
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                      <Terminal className="h-3.5 w-3.5" /> Example cURL Request
                    </span>
                    <Button
                      onClick={() => handleCopy(ep.curl, `curl-${idx}`)}
                      variant="ghost"
                      size="sm"
                    >
                      {copiedEndpoint === `curl-${idx}` ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Copy cURL
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-4 font-mono text-[13px] text-foreground">
                    {ep.curl}
                  </pre>
                </div>
                <div>
                  <span className="mb-2 block text-xs font-bold text-muted-foreground">
                    Expected JSON Response (200 OK)
                  </span>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-4 font-mono text-xs text-foreground">
                    {ep.response}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
