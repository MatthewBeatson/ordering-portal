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

const TONES: Record<OrderStatus, 'default' | 'accent' | 'success' | 'danger' | 'muted'> = {
  pending: 'muted',
  confirmed: 'accent',
  in_progress: 'accent',
  shipped: 'success',
  delivered: 'success',
  rejected: 'danger',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={TONES[status]}>{LABELS[status]}</Badge>;
}
