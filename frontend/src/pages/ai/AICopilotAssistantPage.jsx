import { useState } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { api } from '../../lib/api';
import { Sparkles, Send, Bot, User, ShoppingBag, ArrowRight, Search, DollarSign, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';

const QUICK_PROMPTS = [
  { icon: Search, label: 'Which SKUs are low stock?', prompt: 'Which SKUs are low stock and should I reorder this week?' },
  { icon: DollarSign, label: 'Total inventory asset valuation', prompt: 'What is my total inventory asset valuation?' },
  { icon: TriangleAlert, label: 'Identify stockout risks', prompt: 'Identify potential stockout risks across warehouses' },
];

const ERROR_REPLY_PREFIX = 'Sorry, I encountered an issue';

export function AICopilotAssistantPage() {
  const { activeWorkspace } = useWorkspaceStore();
  const [messages, setMessages] = useState([
    {
      sender: 'ai',
      text: 'Hello! I am your AI Stockflow Copilot. How can I assist you with stock analytics, reorder recommendations, or asset valuation today?',
      actions: [],
    },
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const handleSend = async (textToSend) => {
    const query = textToSend || input;
    if (!query.trim() || !activeWorkspace) return;

    const userMsg = { sender: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput('');
    setIsThinking(true);

    try {
      const res = await api.post(`/workspaces/${activeWorkspace.id}/ai/chat`, { message: query });
      const aiMsg = {
        sender: 'ai',
        text: res.data.reply,
        actions: res.data.suggested_actions || [],
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error('AI Copilot chat failed:', err);
      setMessages((prev) => [
        ...prev,
        { sender: 'ai', text: 'Sorry, I encountered an issue analyzing your workspace data. Please try again.', actions: [] },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  // Resolve the AI suggestion against live catalog data and create a real
  // purchase order (no fake success toasts).
  const handleDraftPOAction = async (action) => {
    if (!activeWorkspace || pendingAction) return;
    setPendingAction(action.sku);
    try {
      const [lookupRes, suppliersRes, warehousesRes] = await Promise.all([
        api.get(
          `/workspaces/${activeWorkspace.id}/products/lookup?code=${encodeURIComponent(action.sku)}`
        ),
        api.get(`/workspaces/${activeWorkspace.id}/suppliers?pageSize=1`),
        api.get(`/workspaces/${activeWorkspace.id}/warehouses?pageSize=1`),
      ]);

      const product = lookupRes.data?.product;
      const supplier = (suppliersRes.data || [])[0];
      const warehouse = (warehousesRes.data || [])[0];

      if (!product) throw new Error(`Product ${action.sku} no longer exists in the catalog`);
      if (!supplier) throw new Error('No suppliers found — create a supplier before drafting purchase orders');
      if (!warehouse) throw new Error('No warehouses found — create a warehouse before drafting purchase orders');

      const poRes = await api.post(`/workspaces/${activeWorkspace.id}/purchases`, {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        notes: `Drafted by AI Copilot for ${action.sku}`,
        items: [
          {
            productId: product.id,
            orderedQty: Math.max(1, Math.round(Number(action.recommended_qty) || 1)),
            unitCost: Number(product.cost_price) || 0,
          },
        ],
      });

      const poNumber = poRes.data?.po_number || poRes.data?.id || '';
      toast.success(`Purchase order ${poNumber} drafted for ${action.sku} (${supplier.name} → ${warehouse.name})`);
    } catch (err) {
      toast.error(err.message || 'Failed to draft purchase order');
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-6">
      <PageHeader
        title="AI Inventory Intelligence Copilot"
        description="Ask natural language questions about your inventory balances, depletion trajectories, stockout risks, and draft automated purchase orders"
        actions={
          <Badge>
            <Sparkles className="h-3 w-3" />
            AI Copilot
          </Badge>
        }
      />

      {!activeWorkspace && (
        <Alert variant="destructive">
          <AlertDescription>Select a workspace to start chatting with the AI Copilot.</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((qp) => {
          const PromptIcon = qp.icon;
          return (
            <Button key={qp.prompt} variant="outline" size="sm" onClick={() => handleSend(qp.prompt)}>
              <PromptIcon />
              {qp.label}
            </Button>
          );
        })}
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          {messages.map((m, idx) => {
            const isUser = m.sender === 'user';
            const isError = !isUser && m.text.startsWith(ERROR_REPLY_PREFIX);
            return (
              <div key={idx} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <Avatar className="h-9 w-9 shrink-0 rounded-xl bg-primary text-primary-foreground">
                    <AvatarFallback className="rounded-xl bg-primary text-primary-foreground">
                      <Bot className="h-5 w-5" />
                    </AvatarFallback>
                  </Avatar>
                )}

                <div className="flex max-w-[80%] flex-col gap-2">
                  {isError ? (
                    <Alert variant="destructive">
                      <AlertDescription className="whitespace-pre-line">{m.text}</AlertDescription>
                    </Alert>
                  ) : (
                    <div
                      className={`whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        isUser ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted text-foreground'
                      }`}
                    >
                      {m.text}
                    </div>
                  )}

                  {m.actions && m.actions.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {m.actions.map((act, i) => (
                        <Button
                          key={i}
                          size="sm"
                          disabled={pendingAction !== null}
                          onClick={() => handleDraftPOAction(act)}
                          className="justify-between"
                        >
                          <span className="flex items-center gap-1.5">
                            <ShoppingBag className="h-3.5 w-3.5" />
                            {pendingAction === act.sku ? 'Drafting purchase order…' : act.label}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                {isUser && (
                  <Avatar className="h-9 w-9 shrink-0 rounded-xl bg-muted text-muted-foreground">
                    <AvatarFallback className="rounded-xl bg-muted text-muted-foreground">
                      <User className="h-5 w-5" />
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            );
          })}

          {isThinking && (
            <div className="flex items-start gap-3">
              <Avatar className="h-9 w-9 shrink-0 rounded-xl bg-primary text-primary-foreground">
                <AvatarFallback className="rounded-xl bg-primary text-primary-foreground">
                  <Bot className="h-5 w-5" />
                </AvatarFallback>
              </Avatar>
              <div className="flex max-w-[80%] flex-1 flex-col gap-2 pt-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <p className="text-[13px] text-muted-foreground">AI Copilot is analyzing workspace stock balances...</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex gap-3"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask AI Copilot e.g. 'Draft PO for items below reorder point'…"
          aria-label="Ask AI Copilot"
          className="h-11 flex-1"
        />
        <Button type="submit" disabled={isThinking || !input.trim()} className="h-11 px-6">
          <Send />
          Send
        </Button>
      </form>
    </div>
  );
}
