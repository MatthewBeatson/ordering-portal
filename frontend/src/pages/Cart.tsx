import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCart } from '@/lib/CartContext';
import { useAuth } from '@/lib/AuthContext';
import { useMyStores } from '@/lib/useStores';
import { useProductThumbnails } from '@/lib/useProductThumbnails';
import { useClientCatalog } from '@/lib/useClientCatalog';
import { supabase } from '@/lib/supabase';
import { ordersApi } from '@/lib/api';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { ImageSizeToggle, IMAGE_SIZE_CLASS, IMAGE_COL_CLASS } from '@/components/ImageSizeToggle';
import { QuickOrderBar } from '@/components/QuickOrderBar';
import type { ClientAddress } from '@/lib/types';
import { Trash2, MapPin, Pencil, X } from 'lucide-react';

export default function Cart() {
  const cart = useCart();
  const { data: stores } = useMyStores();
  const navigate = useNavigate();
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  // Shared, per-user-persisted preference (see AuthContext) -- but no
  // "hide" option on Cart, deliberately, regardless of what it's set to
  // elsewhere: a buyer should never be able to lose sight of what
  // they're actually about to submit vs. what they think they're
  // ordering. Clamped to "small" here rather than writing that back to
  // the shared preference, so Catalog/OrderDetail aren't affected by
  // just having visited Cart.
  const { imageSizePreference, setImageSizePreference } = useAuth();
  const imageSize = imageSizePreference === 'hide' ? 'small' : imageSizePreference;
  const showImages = true;
  const { data: thumbnails } = useProductThumbnails(showImages ? cart.lines.map((l) => l.sku) : []);

  const currentStore = stores?.find((s) => s.id === cart.storeId);
  const { tierNumber, clientSkuByProduct, products } = useClientCatalog(currentStore?.client_id);

  // Editing an existing pending order: fetch it once and hydrate the
  // (already-cleared, see CartContext.startEditingOrder) cart lines +
  // notes from it. hydratedRef guards against re-populating on every
  // refetch/re-render -- after the first load this cart is just a
  // normal editable cart, same as building a fresh one.
  const { data: editingOrder } = useQuery({
    queryKey: ['order', cart.editingOrderId],
    queryFn: () => ordersApi.get(cart.editingOrderId!),
    enabled: !!cart.editingOrderId,
  });
  const hydratedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!editingOrder || hydratedRef.current === editingOrder.id) return;
    hydratedRef.current = editingOrder.id;
    setNotes(editingOrder.notes ?? '');
    for (const line of editingOrder.order_lines ?? []) {
      cart.addLine({ sku: line.sku, description: line.description ?? undefined, quantity: line.quantity, unit_price: line.unit_price ?? undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingOrder]);

  const { data: addresses } = useQuery({
    queryKey: ['client-addresses', currentStore?.client_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_addresses').select('*').eq('client_id', currentStore!.client_id).order('is_default', { ascending: false });
      if (error) throw error;
      return data as ClientAddress[];
    },
    enabled: !!currentStore,
  });
  const defaultAddress = addresses?.find((a) => a.is_default) ?? addresses?.[0];
  const alternateAddresses = (addresses ?? []).filter((a) => a.id !== defaultAddress?.id);

  const submit = useMutation({
    mutationFn: () => {
      if (!cart.storeId) throw new Error('No store selected.');
      const lines = cart.lines.map((l) => ({ sku: l.sku, description: l.description, quantity: l.quantity, unit_price: l.unit_price }));
      if (cart.editingOrderId) {
        return ordersApi.update(cart.editingOrderId, { notes: notes || undefined, lines });
      }
      return ordersApi.create({ store_id: cart.storeId, notes: notes || undefined, lines });
    },
    onSuccess: (order) => {
      const wasEditing = !!cart.editingOrderId;
      cart.stopEditing();
      cart.clear();
      navigate(`/orders/${order.id}`, wasEditing ? { replace: true } : undefined);
    },
    onError: (err: Error) => setError(err.message),
  });

  function cancelEdit() {
    cart.stopEditing();
    cart.clear();
    if (editingOrder) navigate(`/orders/${editingOrder.id}`);
  }

  const total = cart.lines.reduce((sum, l) => sum + (l.unit_price ?? 0) * l.quantity, 0);
  const hasPricing = cart.lines.some((l) => l.unit_price != null);
  const isEmpty = cart.lines.length === 0;
  const isEditing = !!cart.editingOrderId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            {isEditing ? (
              <>
                <Pencil className="h-4 w-4 text-[var(--muted-foreground)]" />
                Editing {editingOrder?.reference || `order ${cart.editingOrderId?.slice(0, 8)}`}
              </>
            ) : (
              'Cart'
            )}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {currentStore && <span className="text-sm text-[var(--muted-foreground)]">Ordering for {currentStore.name}</span>}
          {!isEmpty && <ImageSizeToggle value={imageSize} onChange={setImageSizePreference} allowHide={false} />}
          {isEditing && (
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              <X className="h-3.5 w-3.5" />
              Cancel edit
            </Button>
          )}
        </div>
      </div>

      {products && products.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Quick add</div>
          <QuickOrderBar products={products} clientSkuByProduct={clientSkuByProduct} tierNumber={tierNumber} />
        </div>
      )}

      {isEmpty ? (
        <Card className="p-6 text-sm text-[var(--muted-foreground)]">
          {isEditing
            ? 'No lines left in this order. Add products above, or cancel to leave the order unchanged.'
            : (
              <>
                Your cart is empty. Add products above, or from the <a href="/" className="text-[var(--accent)] hover:underline">catalog</a>.
              </>
            )}
        </Card>
      ) : (
        <>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)] text-left text-xs text-[var(--muted-foreground)]">
              {showImages && <th className={`${IMAGE_COL_CLASS[imageSize]} px-4 py-2 font-medium`}></th>}
              <th className="px-2 py-2 font-medium">SKU</th>
              <th className="px-2 py-2 font-medium">Description</th>
              <th className="px-2 py-2 font-medium">Qty</th>
              {hasPricing && <th className="px-2 py-2 text-right font-medium">Unit price</th>}
              {hasPricing && <th className="px-2 py-2 text-right font-medium">Line total</th>}
              <th className="w-10 px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {cart.lines.map((line) => {
              const thumb = thumbnails?.get(line.sku);
              return (
                <tr key={line.sku} className="border-b border-[var(--border)] last:border-0">
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
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => cart.setQuantity(line.sku, Math.max(1, Number(e.target.value) || 1))}
                      className="h-8 w-16 px-2"
                    />
                  </td>
                  {hasPricing && <td className="px-2 py-2 text-right tabular-nums">{money(line.unit_price)}</td>}
                  {hasPricing && <td className="px-2 py-2 text-right tabular-nums">{money(line.unit_price != null ? line.unit_price * line.quantity : null)}</td>}
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => cart.removeLine(line.sku)} className="text-[var(--muted-foreground)] hover:text-[var(--danger)]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {hasPricing && (
            <tfoot>
              <tr>
                <td colSpan={showImages ? 5 : 4} className="px-4 py-2 text-right text-sm font-medium">
                  Total
                </td>
                <td className="px-2 py-2 text-right text-sm font-semibold tabular-nums">{money(total)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </Card>

      {defaultAddress && (
        <Card className="p-4">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
            <MapPin className="h-4 w-4 text-[var(--muted-foreground)]" />
            Delivery address
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {[defaultAddress.line1, defaultAddress.line2, defaultAddress.city, defaultAddress.state, defaultAddress.postcode, defaultAddress.country]
              .filter(Boolean)
              .join(', ')}
          </p>
          {alternateAddresses.length > 0 && (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {alternateAddresses.length} other address{alternateAddresses.length === 1 ? '' : 'es'} on file for this client — picking a
              different one per order isn't available yet.
            </p>
          )}
        </Card>
      )}

      <Card className="p-4">
        <label htmlFor="notes" className="mb-1 block text-sm font-medium">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="Anything the approver or Shonrei should know about this order"
        />
      </Card>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => cart.clear()} disabled={submit.isPending}>
          Clear {isEditing ? 'lines' : 'cart'}
        </Button>
        <Button variant="primary" onClick={() => submit.mutate()} disabled={submit.isPending || !cart.storeId}>
          {submit.isPending ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : isEditing ? 'Save changes' : 'Submit order'}
        </Button>
      </div>
        </>
      )}
    </div>
  );
}
