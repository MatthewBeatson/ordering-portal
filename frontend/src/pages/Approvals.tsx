import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { useMyStores } from '@/lib/useStores';
import { dateTime } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

export default function Approvals() {
  const { canApprove } = useAuth();
  const { data: stores } = useMyStores();
  const queryClient = useQueryClient();
  const storeName = (id: string) => stores?.find((s) => s.id === id)?.name ?? id;
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = React.useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', 'pending-approvals'],
    queryFn: () => ordersApi.list({ status: 'pending', limit: 100 }),
  });

  const pendingApprovals = (data?.orders ?? []).filter((o) => canApprove(o.store_id));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['orders'] });
  const confirm = useMutation({ mutationFn: (id: string) => ordersApi.confirm(id), onSuccess: invalidate });
  const reject = useMutation({
    mutationFn: (id: string) => ordersApi.reject(id, window.prompt('Reason for rejecting (optional):') || undefined),
    onSuccess: invalidate,
  });
  const bulkConfirm = useMutation({
    mutationFn: () => ordersApi.bulkConfirm([...selected]),
    onSuccess: (result) => {
      setSelected(new Set());
      const parts = [`${result.confirmed.length} confirmed`];
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);
      setBulkResult(parts.join(', ') + '.');
      invalidate();
    },
  });

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === pendingApprovals.length ? new Set() : new Set(pendingApprovals.map((o) => o.id))));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Approvals</h1>
        {selected.size > 0 && (
          <Button variant="primary" onClick={() => bulkConfirm.mutate()} disabled={bulkConfirm.isPending}>
            {bulkConfirm.isPending ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : `Confirm ${selected.size} selected`}
          </Button>
        )}
      </div>

      {bulkResult && <p className="text-sm text-[var(--muted-foreground)]">{bulkResult}</p>}

      {isLoading && (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      )}

      {error && <Card className="p-6 text-sm text-[var(--danger)]">Couldn't load approvals: {(error as Error).message}</Card>}

      {data && pendingApprovals.length === 0 && !isLoading && (
        <Card className="p-6 text-sm text-[var(--muted-foreground)]">Nothing waiting on your approval right now.</Card>
      )}

      {pendingApprovals.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)] text-left text-xs text-[var(--muted-foreground)]">
                <th className="w-10 px-4 py-2">
                  <input type="checkbox" checked={selected.size === pendingApprovals.length} onChange={toggleSelectAll} />
                </th>
                <th className="px-2 py-2 font-medium">Reference</th>
                <th className="px-2 py-2 font-medium">Store</th>
                <th className="px-2 py-2 font-medium">Lines</th>
                <th className="px-2 py-2 font-medium">Submitted</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {pendingApprovals.map((order) => (
                <tr key={order.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/50">
                  <td className="px-4 py-2">
                    <input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleSelected(order.id)} />
                  </td>
                  <td className="px-2 py-2">
                    <Link to={`/orders/${order.id}`} className="font-medium text-[var(--accent)] hover:underline">
                      {order.reference || order.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{storeName(order.store_id)}</td>
                  <td className="px-2 py-2">{order.order_lines?.length ?? '—'}</td>
                  <td className="px-2 py-2 text-[var(--muted-foreground)]">{dateTime(order.created_at)}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="danger" onClick={() => reject.mutate(order.id)} disabled={reject.isPending || confirm.isPending}>
                        Reject
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => confirm.mutate(order.id)} disabled={reject.isPending || confirm.isPending}>
                        Confirm
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
