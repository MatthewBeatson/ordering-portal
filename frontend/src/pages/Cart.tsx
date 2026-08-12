import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useCart } from '@/lib/CartContext';
import { useMyStores } from '@/lib/useStores';
import { useProductThumbnails } from '@/lib/useProductThumbnails';
import { ordersApi } from '@/lib/api';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { ImageSizeToggle, IMAGE_SIZE_CLASS, IMAGE_COL_CLASS, type ImageSize } from '@/components/ImageSizeToggle';
import { Trash2 } from 'lucide-react';

export default function Cart() {
  const cart = useCart();
  const { data: stores } = useMyStores();
  const navigate = useNavigate();
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [imageSize, setImageSize] = React.useState<ImageSize>('hide');
  const showImages = imageSize !== 'hide';
  const { data: thumbnails } = useProductThumbnails(showImages ? cart.lines.map((l) => l.sku) : []);

  const currentStore = stores?.find((s) => s.id === cart.storeId);

  const submit = useMutation({
    mutationFn: () => {
      if (!cart.storeId) throw new Error('No store selected.');
      return ordersApi.create({
        store_id: cart.storeId,
        notes: notes || undefined,
        lines: cart.lines.map((l) => ({ sku: l.sku, description: l.description, quantity: l.quantity, unit_price: l.unit_price })),
      });
    },
    onSuccess: (order) => {
      cart.clear();
      navigate(`/orders/${order.id}`);
    },
    onError: (err: Error) => setError(err.message),
  });

  const total = cart.lines.reduce((sum, l) => sum + (l.unit_price ?? 0) * l.quantity, 0);
  const hasPricing = cart.lines.some((l) => l.unit_price != null);

  if (cart.lines.length === 0) {
    return (
      <Card className="p-6 text-sm text-[var(--muted-foreground)]">
        Your cart is empty. Add products from the <a href="/" className="text-[var(--accent)] hover:underline">catalog</a>.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Cart</h1>
        <div className="flex items-center gap-3">
          {currentStore && <span className="text-sm text-[var(--muted-foreground)]">Ordering for {currentStore.name}</span>}
          <ImageSizeToggle value={imageSize} onChange={setImageSize} />
        </div>
      </div>

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
          Clear cart
        </Button>
        <Button variant="primary" onClick={() => submit.mutate()} disabled={submit.isPending || !cart.storeId}>
          {submit.isPending ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : 'Submit order'}
        </Button>
      </div>
    </div>
  );
}
