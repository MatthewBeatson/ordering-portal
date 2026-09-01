import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { useCart } from '@/lib/CartContext';
import { useMyStores } from '@/lib/useStores';
import { useProductThumbnails } from '@/lib/useProductThumbnails';
import { useResolvedLines } from '@/lib/useResolvedLines';
import { useClientCatalog } from '@/lib/useClientCatalog';
import { groupProducts, type GroupMode } from '@/lib/groupProducts';
import { money, dateTime } from '@/lib/format';
import { OrderStatusBadge } from '@/components/OrderStatusBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { ImageSizeToggle, IMAGE_SIZE_CLASS, IMAGE_COL_CLASS } from '@/components/ImageSizeToggle';
import { GroupModeToggle } from '@/components/GroupModeToggle';
import { RefreshCw, Pencil } from 'lucide-react';

export default function OrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const { canApprove, isPortalAdmin, imageSizePreference: imageSize, setImageSizePreference: setImageSize } = useAuth();
  const cart = useCart();
  const { data: stores } = useMyStores();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = React.useState<string | null>(null);
  const showImages = imageSize !== 'hide';

  const { data: order, isLoading, error } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => ordersApi.get(orderId!),
    enabled: !!orderId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  const confirm = useMutation({
    mutationFn: () => ordersApi.confirm(orderId!),
    onSuccess: invalidate,
    onError: (err: Error) => setActionError(err.message),
  });
  const reject = useMutation({
    mutationFn: () => ordersApi.reject(orderId!, window.prompt('Reason for rejecting (optional):') || undefined),
    onSuccess: invalidate,
    onError: (err: Error) => setActionError(err.message),
  });
  const cancel = useMutation({
    mutationFn: () => ordersApi.remove(orderId!),
    onSuccess: () => navigate('/orders'),
    onError: (err: Error) => setActionError(err.message),
  });
  const requestCancellation = useMutation({
    mutationFn: () => ordersApi.requestCancellation(orderId!, window.prompt('Reason for requesting cancellation (optional):') || undefined),
    onSuccess: invalidate,
    onError: (err: Error) => setActionError(err.message),
  });
  const retrySync = useMutation({
    mutationFn: () => ordersApi.retrySync(orderId!),
    onSuccess: invalidate,
    onError: (err: Error) => setActionError(err.message),
  });

  const { data: thumbnails } = useProductThumbnails(showImages ? (order?.order_lines ?? []).map((l) => l.sku) : []);

  const clientId = stores?.find((s) => s.id === order?.store_id)?.client_id;
  const { showPricing } = useClientCatalog(clientId);
  const { bySku } = useResolvedLines((order?.order_lines ?? []).map((l) => l.sku), clientId);
  const [groupMode, setGroupMode] = React.useState<GroupMode>('display');
  const groups = React.useMemo(
    () =>
      groupProducts(
        order?.order_lines ?? [],
        groupMode,
        (l) => bySku.get(l.sku)?.display_systems,
        (l) => bySku.get(l.sku)?.product_types
      ),
    [order, groupMode, bySku]
  );

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (error || !order) {
    return <Card className="p-6 text-sm text-[var(--danger)]">Couldn't load this order: {(error as Error)?.message ?? 'not found'}</Card>;
  }

  const storeName = stores?.find((s) => s.id === order.store_id)?.name ?? order.store_id;
  const total = (order.order_lines ?? []).reduce((sum, l) => sum + (l.unit_price ?? 0) * l.quantity, 0);
  const hasPricing = (order.order_lines ?? []).some((l) => l.unit_price != null) && showPricing;

  const canCancelDirectly = order.status === 'pending' || order.status === 'confirmed';
  const canRequestCancellation = order.status === 'in_progress' || order.status === 'shipped';
  const canApproveThis = order.status === 'pending' && canApprove(order.store_id);
  const canEdit = order.status === 'pending';

  function startEdit() {
    cart.startEditingOrder(order!.id, order!.store_id);
    navigate('/cart');
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{order.reference || `Order ${order.id.slice(0, 8)}`}</h1>
          <p className="text-sm text-[var(--muted-foreground)]">{storeName}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      <Card className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Created</div>
          <div>{dateTime(order.created_at)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Last updated</div>
          <div>{dateTime(order.updated_at)}</div>
        </div>
        {order.shipped_at && (
          <div>
            <div className="text-xs text-[var(--muted-foreground)]">Shipped</div>
            <div>{dateTime(order.shipped_at)}</div>
          </div>
        )}
        {order.notes && (
          <div className="col-span-full">
            <div className="text-xs text-[var(--muted-foreground)]">Notes</div>
            <div>{order.notes}</div>
          </div>
        )}
      </Card>

      {isPortalAdmin && order.status !== 'pending' && order.status !== 'rejected' && (
        <Card className="p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Cin7 sync (staff only)</div>
          {order.inventory_sync?.status === 'synced' ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="success">Synced</Badge>
              <span className="text-[var(--muted-foreground)]">
                Cin7 Sale {order.inventory_sync.external_id} · {dateTime(order.inventory_sync.synced_at)}
              </span>
            </div>
          ) : order.inventory_sync?.status === 'failed' ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="danger">Sync failed</Badge>
                <span className="text-[var(--muted-foreground)]">Order stayed at "Confirmed" — Cin7 never received it.</span>
              </div>
              <p className="rounded-[var(--radius)] bg-[var(--danger-muted)] px-3 py-2 text-sm text-[var(--danger)]">{order.inventory_sync.error_message}</p>
              <div>
                <Button size="sm" variant="secondary" onClick={() => retrySync.mutate()} disabled={retrySync.isPending}>
                  {retrySync.isPending ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Retry sync
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="muted">Not yet synced</Badge>
              {order.status === 'confirmed' && (
                <Button size="sm" variant="secondary" onClick={() => retrySync.mutate()} disabled={retrySync.isPending}>
                  {retrySync.isPending ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Retry sync
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="flex items-center justify-end gap-3">
        <GroupModeToggle value={groupMode} onChange={setGroupMode} />
        <ImageSizeToggle value={imageSize} onChange={setImageSize} />
      </div>

      {groups.map((group) => (
        <Card key={group.key} className="overflow-hidden">
          <div className="border-b border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-sm font-semibold">{group.label}</div>
          {group.subgroups.map((sub) => (
            <div key={sub.key}>
              {sub.label && (
                <div className="border-b border-[var(--border)] px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  {sub.label}
                </div>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)] text-left text-xs text-[var(--muted-foreground)]">
                    {showImages && <th className={`${IMAGE_COL_CLASS[imageSize]} px-4 py-2 font-medium`}></th>}
                    <th className="px-2 py-2 font-medium">SKU</th>
                    <th className="px-2 py-2 font-medium">Description</th>
                    <th className="px-2 py-2 font-medium">Qty</th>
                    {hasPricing && <th className="px-2 py-2 text-right font-medium">Unit price</th>}
                    {hasPricing && <th className="px-4 py-2 text-right font-medium">Line total</th>}
                  </tr>
                </thead>
                <tbody>
                  {sub.rows.map((line) => {
                    const thumb = thumbnails?.get(line.sku);
                    return (
                      <tr key={line.id} className="border-b border-[var(--border)] last:border-0">
                        {showImages && (
                          <td className="px-4 py-2">
                            {thumb ? (
                              <img src={thumb} alt={line.description ?? line.sku} className={`${IMAGE_SIZE_CLASS[imageSize]} rounded object-cover`} />
                            ) : (
                              <div className={`${IMAGE_SIZE_CLASS[imageSize]} rounded bg-[var(--muted)]`} />
                            )}
                          </td>
                        )}
                        <td className="px-2 py-2 font-mono text-xs">{line.sku}</td>
                        <td className="px-2 py-2">{line.description ?? '—'}</td>
                        <td className="px-2 py-2">{line.quantity}</td>
                        {hasPricing && <td className="px-2 py-2 text-right tabular-nums">{money(line.unit_price)}</td>}
                        {hasPricing && <td className="px-4 py-2 text-right tabular-nums">{money(line.unit_price != null ? line.unit_price * line.quantity : null)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </Card>
      ))}

      {hasPricing && (
        <Card className="flex items-center justify-end gap-3 px-4 py-2">
          <span className="text-sm font-medium">Total</span>
          <span className="text-sm font-semibold tabular-nums">{money(total)}</span>
        </Card>
      )}

      {actionError && <p className="text-sm text-[var(--danger)]">{actionError}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        {canApproveThis && (
          <>
            <Button variant="danger" onClick={() => reject.mutate()} disabled={reject.isPending || confirm.isPending}>
              Reject
            </Button>
            <Button variant="primary" onClick={() => confirm.mutate()} disabled={reject.isPending || confirm.isPending}>
              Confirm
            </Button>
          </>
        )}
        {canEdit && (
          <Button variant="secondary" onClick={startEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit order
          </Button>
        )}
        {canCancelDirectly && (
          <Button
            variant="ghost"
            onClick={() => window.confirm('Cancel this order?') && cancel.mutate()}
            disabled={cancel.isPending}
          >
            Cancel order
          </Button>
        )}
        {canRequestCancellation && (
          <Button variant="ghost" onClick={() => requestCancellation.mutate()} disabled={requestCancellation.isPending}>
            Request cancellation
          </Button>
        )}
      </div>
    </div>
  );
}
