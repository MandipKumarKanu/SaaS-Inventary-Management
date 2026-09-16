import { Badge } from '@/components/ui/badge';

/**
 * StatusBadge — domain-aware status pill.
 * Maps the app's many ad-hoc status strings onto the 5 Badge variants.
 * Unknown values fall back to `secondary`.
 */
const STATUS_VARIANT_MAP = {
  // order / transfer / return lifecycles
  draft: 'secondary',
  pending: 'warning',
  awaiting: 'warning',
  submitted: 'warning',
  in_transit: 'warning',
  'in-transit': 'warning',
  partial: 'warning',
  low: 'warning',
  low_stock: 'warning',
  expiring: 'warning',
  expired: 'destructive',
  failed: 'destructive',
  cancelled: 'destructive',
  canceled: 'destructive',
  rejected: 'destructive',
  out_of_stock: 'destructive',
  overstock: 'destructive',
  quarantined: 'destructive',
  recalled: 'destructive',
  approved: 'success',
  completed: 'success',
  complete: 'success',
  received: 'success',
  fulfilled: 'success',
  active: 'success',
  healthy: 'success',
  in_stock: 'success',
  paid: 'success',
  synced: 'success',
  connected: 'success',
  enabled: 'success',
  verified: 'success',
  // info-ish states (map to default/primary tint)
  in_progress: 'default',
  counting: 'default',
  processing: 'default',
  shipped: 'default',
  published: 'default',
  scheduled: 'default',
  // neutral
  archived: 'secondary',
  inactive: 'secondary',
  idle: 'secondary',
  uncategorized: 'secondary',
};

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function statusVariantFor(status) {
  return STATUS_VARIANT_MAP[normalize(status)] ?? 'secondary';
}

export function formatStatus(status) {
  return String(status ?? '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status, variant, children, ...props }) {
  return (
    <Badge variant={variant ?? statusVariantFor(status)} {...props}>
      {children ?? formatStatus(status)}
    </Badge>
  );
}
