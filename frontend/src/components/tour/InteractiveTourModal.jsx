import { useState } from 'react';
import { Sparkles, Package, ArrowRight, ArrowLeft, Check, Barcode, SlidersHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const TOUR_STEPS = [
  {
    title: 'Welcome to StockFlow PRO',
    description: 'Your complete enterprise inventory management and warehouse logistics SaaS platform.',
    icon: Sparkles,
    iconClassName: 'bg-primary/10 text-primary',
  },
  {
    title: 'Central Inventory Engine',
    description: 'Atomic stock movements prevent negative balances and maintain an immutable transaction ledger.',
    icon: Package,
    iconClassName: 'bg-success/10 text-success',
  },
  {
    title: 'Barcode & FEFO Expiration Tracking',
    description: 'Track lot batches, FEFO expirations, and scan barcodes instantly using built-in camera integration.',
    icon: Barcode,
    iconClassName: 'bg-warning/10 text-warning',
  },
  {
    title: 'Commercial Workflows & Integrations',
    description: 'Manage Purchase Orders, Sales Orders, Customer Returns, and sync with Shopify, WooCommerce, and EasyPost.',
    icon: SlidersHorizontal,
    iconClassName: 'bg-destructive/10 text-destructive',
  },
];

export function InteractiveTourModal({ isOpen, onClose }) {
  const [currentStep, setCurrentStep] = useState(0);

  const step = TOUR_STEPS[currentStep];
  const Icon = step.icon;
  const isFirst = currentStep === 0;
  const isLast = currentStep === TOUR_STEPS.length - 1;

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      onClose();
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${step.iconClassName}`}>
            <Icon className="h-8 w-8" />
          </div>
          <DialogTitle className="text-xl font-extrabold">{step.title}</DialogTitle>
          <DialogDescription className="text-center text-sm leading-relaxed">{step.description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-2" aria-label="Tour progress">
          {TOUR_STEPS.map((s, i) => (
            <div
              key={s.title}
              aria-hidden
              className={
                i === currentStep
                  ? 'h-2 w-6 rounded-full bg-primary transition-all'
                  : 'h-2 w-2 rounded-full bg-muted-foreground/30 transition-all'
              }
            />
          ))}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={handleBack} disabled={isFirst}>
            <ArrowLeft />
            Back
          </Button>
          <Button type="button" onClick={handleNext}>
            {isLast ? (
              <>
                <Check />
                Get Started with StockFlow PRO
              </>
            ) : (
              <>
                Next
                <ArrowRight />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
