import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { useMyStores } from '@/lib/useStores';
import { dateTime } from '@/lib/format';
import { OrderStatusBadge, ORDER_STATUS_LABELS, ORDER_STATUS_TONES, type BadgeTone } from '@/components/OrderStatusBadge';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { RefreshCw } from 'lucide-react';
import type { OrderStatus } from '@/lib/types';

// Staff-only extra tab: orders a client has asked to cancel that staff haven't
// resolved yet (not an order status, a filter on cancellation_status).
const CANCELLATION_REQUESTS = 'cancellation_requests';
type Tab = OrderStatus | 'all' | typeof CANCELLATION_REQUESTS;

const STATUS_TABS: { label: string; value: OrderStatus | 'all'; tone: BadgeTone }[] = [
  { label: 'All', value: 'all', tone: 'default' },
  ...(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((value) => ({
    label: ORDER_STATUS_LABELS[value],
    value,
    tone: ORDER_STATUS_TONES[value],
  })),
];

export default function Orders() {
  const [status, setStatus] = React.useState<Tab>('all');
  const { isPortalAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { data: stores } = useMyStores();
  const tabs: { label: string; value: Tab; tone: BadgeTone }[] = isPortalAdmin
    ? [...STATUS_TABS, { label: 'Cancellation requests', value: CANCELLATION_REQUESTS, tone: 'warning' }]
    : STATUS_TABS;

  const checkCin7 = useMutation({
    mutationFn: () => ordersApi.syncCancellations(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });
  const storeName = (id: string) => stores?.find((s) => s.id === id)?.name ?? id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', status],
    queryFn: () =>
      status === CANCELLATION_REQUESTS
        ? ordersApi.list({ cancellation: 'requested', limit: 100 })
        : ordersApi.list({ status: status === 'all' ? undefined : status, limit: 100 }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">My orders</h1>
        {isPortalAdmin && (
          <Button size="sm" variant="ghost" onClick={() => checkCin7.mutate()} disabled={checkCin7.isPending} title="Look in Cin7 for orders that have been voided there">
            {checkCin7.isPending ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Check Cin7 now
          </Button>
        )}
      </div>

      {checkCin7.isSuccess && (
        <p className="text-sm text-[var(--muted-foreground)]">
          {checkCin7.data.skipped
            ? 'Cin7 is not configured on the server.'
            : checkCin7.data.cancelled.length > 0
              ? `Checked ${checkCin7.data.checked} synced order(s): ${checkCin7.data.cancelled.length} voided in Cin7 and marked Cancelled.`
              : `Checked ${checkCin7.data.checked} synced order(s): none voided in Cin7.`}
        </p>
      )}
      {checkCin7.isError && <p className="text-sm text-[var(--danger)]">Couldn't check Cin7: {(checkCin7.error as Error).message}</p>}

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => (
          <button key={tab.value} onClick={() => setStatus(tab.value)} className="transition-opacity hover:opacity-100">
            <Badge tone={tab.tone} className={status === tab.value ? 'ring-1 ring-current' : 'opacity-55'}>
              {tab.label}
            </Badge>
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
