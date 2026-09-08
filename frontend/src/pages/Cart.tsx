import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCart } from '@/lib/CartContext';
import { useAuth } from '@/lib/AuthContext';
import { useMyStores } from '@/lib/useStores';
import { useProductThumbnails } from '@/lib/useProductThumbnails';
import { useClientCatalog } from '@/lib/useClientCatalog';
import { useResolvedLines } from '@/lib/useResolvedLines';
import { groupProducts } from '@/lib/groupProducts';
import { useCustomGroupRules } from '@/lib/useCustomGroupRules';
import { supabase } from '@/lib/supabase';
import { ordersApi } from '@/lib/api';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { ImageSizeToggle, IMAGE_SIZE_CLASS, IMAGE_COL_CLASS } from '@/components/ImageSizeToggle';
import { GroupModeToggle } from '@/components/GroupModeToggle';
import { QuickOrderBar } from '@/components/QuickOrderBar';
import type { ClientAddress } from '@/lib/types';
import { Trash2, MapPin, Pencil, X } from 'lucide-react';

export default function Cart() {
  const cart = useCart();
  const { data: stores } = useMyStores();
  const navigate = useNavigate();
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  // Shared, per-user-persisted preference (see AuthContext) -- same
  // full hide/small/large cycle as Catalog/Order Detail now.
  const {
    session,
    imageSizePreference: imageSize,
    setImageSizePreference: setImageSize,
    cartGroupMode: groupMode,
    setCartGroupMode: setGroupMode,
  } = useAuth();
  const showImages = imageSize !== 'hide';
  const { data: thumbnails } = useProductThumbnails(showImages ? cart.lines.map((l) => l.sku) : []);

  const currentStore = stores?.find((s) => s.id === cart.storeId);
  // tierNumber stays real regardless of showPricing -- see Catalog.tsx's
  // note; it's what QuickOrderBar computes unit_price from on add.
  const { tierNumber, showPricing, currency, clientSkuByProduct, products } = useClientCatalog(currentStore?.client_id);
  const { bySku } = useResolvedLines(cart.lines.map((l) => l.sku), currentStore?.client_id);
  const customRules = useCustomGroupRules();
  const groups = React.useMemo(
    () =>
      groupProducts(cart.lines, groupMode, (l) => bySku.get(l.sku)?.display_systems ?? [], (l) => bySku.get(l.sku)?.product_types, {
        getId: (l) => bySku.get(l.sku)?.id,
        getLabel: (l) => l.description ?? l.sku,
        rules: customRules,
      }),
    [cart.lines, groupMode, bySku, customRules]
  );

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
    if (editingOrder.shipping_client_address_id) setSelectedAddressId(editingOrder.shipping_client_address_id);
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
  // Self-service read (own row only) -- the per-LOGIN default shipping
  // address (032), staff-assigned (see clients.js's
  // setUserDefaultShippingAddress). Confirmed with the client
  // 2026-09-09: this wins over a store's own assignment, since in
  // practice one login often orders on behalf of many different store
  // numbers, all wanting the same head-office destination.
  const { data: userDefaultAddressId } = useQuery({
    queryKey: ['user-default-shipping-address', session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('default_shipping_address_id')
        .eq('user_id', session!.user.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.default_shipping_address_id as string | null) ?? null;
    },
    enabled: !!session,
  });
  // A store's own assigned address (027, set in Account) is the next
  // fallback -- Cin7 has no "store" concept, so this was previously the
  // only way an order could ship somewhere other than the client's
  // default. Falls back further to the client's own Cin7-flagged
  // default address, same as before 027/032.
  const userDefaultAddress = userDefaultAddressId ? addresses?.find((a) => a.id === userDefaultAddressId) : undefined;
  const assignedAddress = currentStore?.client_address_id ? addresses?.find((a) => a.id === currentStore.client_address_id) : undefined;
  const resolvedDefaultAddress = userDefaultAddress ?? assignedAddress ?? addresses?.find((a) => a.is_default) ?? addresses?.[0];

  // Per-order override (032) -- pre-selected from the resolved default,
  // but the buyer can pick any of this client's synced addresses
  // instead for one specific order without changing their standing
  // default. Resets to the (possibly newly loaded) resolved default
  // whenever the store changes or that resolution itself changes;
  // otherwise left alone so a manual pick isn't clobbered by unrelated
  // re-renders.
  const [selectedAddressId, setSelectedAddressId] = React.useState<string | null>(null);
  const resolvedDefaultId = resolvedDefaultAddress?.id ?? null;
  React.useEffect(() => {
    setSelectedAddressId(resolvedDefaultId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStore?.id, resolvedDefaultId]);
  const selectedAddress = addresses?.find((a) => a.id === selectedAddressId);

  const submit = useMutation({
    mutationFn: () => {
      if (!cart.storeId) throw new Error('No store selected.');
      const lines = cart.lines.map((l) => ({ sku: l.sku, description: l.description, quantity: l.quantity, unit_price: l.unit_price }));
      if (cart.editingOrderId) {
        return ordersApi.update(cart.editingOrderId, { notes: notes || undefined, lines, shipping_client_address_id: selectedAddressId });
      }
      return ordersApi.create({ store_id: cart.storeId, notes: notes || undefined, lines, shipping_client_address_id: selectedAddressId });
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
  const hasPricing = cart.lines.some((l) => l.unit_price != null) && showPricing;
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
          {!isEmpty && <GroupModeToggle value={groupMode} onChange={setGroupMode} />}
          {!isEmpty && <ImageSizeToggle value={imageSize} onChange={setImageSize} />}
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
          <QuickOrderBar products={products} clientSkuByProduct={clientSkuByProduct} tierNumber={tierNumber} showPricing={showPricing} currency={currency} />
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
                    <th className="px-2 py-2 font-medium">Client SKU</th>
                    <th className="px-2 py-2 font-medium">Description</th>
                    <th className="px-2 py-2 font-medium">Qty</th>
                    {hasPricing && <th className="px-2 py-2 text-right font-medium">Unit price ({currency})</th>}
                    {hasPricing && <th className="px-2 py-2 text-right font-medium">Line total ({currency})</th>}
                    <th className="w-10 px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sub.rows.map((line) => {
                    const thumb = thumbnails?.get(line.sku);
                    return (
                      <tr key={line.sku} className="border-b border-[var(--border)] last:border-0">
                        {showImages && (
                          <td className="px-4 py-2">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={line.description ?? line.sku}
                                className={`${IMAGE_SIZE_CLASS[imageSize]} rounded bg-[var(--muted)] object-contain`}
                              />
                            ) : (
                              <div className={`${IMAGE_SIZE_CLASS[imageSize]} rounded bg-[var(--muted)]`} />
                            )}
                          </td>
                        )}
                        <td className="px-2 py-2 font-mono text-xs">{line.sku}</td>
                        <td className="px-2 py-2 font-mono text-xs">
                          {clientSkuByProduct.get(bySku.get(line.sku)?.id ?? '') ?? <span className="text-[var(--muted-foreground)]">—</span>}
                        </td>
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
                        {hasPricing && <td className="px-2 py-2 text-right tabular-nums">{money(line.unit_price, currency)}</td>}
                        {hasPricing && <td className="px-2 py-2 text-right tabular-nums">{money(line.unit_price != null ? line.unit_price * line.quantity : null, currency)}</td>}
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => cart.removeLine(line.sku)} className="text-[var(--muted-foreground)] hover:text-[var(--danger)]">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
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
          <span className="text-sm font-medium">Total ({currency})</span>
          <span className="text-sm font-semibold tabular-nums">{money(total, currency)}</span>
        </Card>
      )}

      {addresses && addresses.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <MapPin className="h-4 w-4 text-[var(--muted-foreground)]" />
            Delivery address
          </div>
          <select
            className="w-full max-w-md rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
            value={selectedAddressId ?? ''}
            onChange={(e) => setSelectedAddressId(e.target.value || null)}
          >
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {[a.line1, a.line2, a.city, a.state, a.postcode, a.country].filter(Boolean).join(', ')}
                {a.id === resolvedDefaultId ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {selectedAddress?.id === userDefaultAddress?.id && userDefaultAddress
              ? 'Your own default shipping address.'
              : selectedAddress?.id === assignedAddress?.id && assignedAddress
                ? "This store's assigned address (set in Account)."
                : selectedAddress?.id === resolvedDefaultId
                  ? "This client's default address."
                  : 'Overriding the default for this order only.'}
          </p>
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
