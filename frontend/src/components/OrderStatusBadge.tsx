import { Badge } from '@/components/ui/badge';
import type { OrderStatus } from '@/lib/types';

export type BadgeTone = 'default' | 'accent' | 'success' | 'danger' | 'muted' | 'warning' | 'purple' | 'teal';

// Exported so other places that reference order status (e.g. the My
// Orders filter tabs) use the exact same label/color mapping instead
// of a second hand-kept copy that could drift out of sync.
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  shipped: 'Shipped',
  delivered: 'Delivered',
  rejected: 'Rejected',
};

export const ORDER_STATUS_TONES: Record<OrderStatus, BadgeTone> = {
  pending: 'warning',
  confirmed: 'accent',
  in_progress: 'purple',
  shipped: 'success',
  delivered: 'teal',
  rejected: 'danger',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_STATUS_TONES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}
