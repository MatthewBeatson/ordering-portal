import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ordersApi } from '@/lib/api';
import { useMyStores } from '@/lib/useStores';
import { dateTime } from '@/lib/format';
import { OrderStatusBadge } from '@/components/OrderStatusBadge';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { OrderStatus } from '@/lib/types';

const STATUS_TABS: { label: string; value: OrderStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Shipped', value: 'shipped' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Rejected', value: 'rejected' },
];

export default function Orders() {
  const [status, setStatus] = React.useState<OrderStatus | 'all'>('all');
  const { data: stores } = useMyStores();
  const storeName = (id: string) => stores?.find((s) => s.id === id)?.name ?? id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', status],
    queryFn: () => ordersApi.list({ status: status === 'all' ? undefined : status, limit: 100 }),
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">My orders</h1>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatus(tab.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              status === tab.value ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border-strong)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      )}

      {error && <Card className="p-6 text-sm text-[var(--danger)]">Couldn't load orders: {(error as Error).message}</Card>}

      {data && data.orders.length === 0 && <Card className="p-6 text-sm text-[var(--muted-foreground)]">No orders here yet.</Card>}

      {data && data.orders.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)] text-left text-xs text-[var(--muted-foreground)]">
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-2 py-2 font-medium">Store</th>
                <th className="px-2 py-2 font-medium">Lines</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/50">
                  <td className="px-4 py-2">
                    <Link to={`/orders/${order.id}`} className="font-medium text-[var(--accent)] hover:underline">
                      {order.reference || order.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{storeName(order.store_id)}</td>
                  <td className="px-2 py-2">{order.order_lines?.length ?? '—'}</td>
                  <td className="px-2 py-2">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="px-2 py-2 text-[var(--muted-foreground)]">{dateTime(order.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
