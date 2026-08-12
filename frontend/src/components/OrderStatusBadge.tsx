import { Badge } from '@/components/ui/badge';
import type { OrderStatus } from '@/lib/types';

const LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  shipped: 'Shipped',
  delivered: 'Delivered',
  rejected: 'Rejected',
};

const TONES: Record<OrderStatus, 'default' | 'accent' | 'success' | 'danger' | 'muted' | 'warning' | 'purple' | 'teal'> = {
  pending: 'warning',
  confirmed: 'accent',
  in_progress: 'purple',
  shipped: 'success',
  delivered: 'teal',
  rejected: 'danger',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={TONES[status]}>{LABELS[status]}</Badge>;
}
