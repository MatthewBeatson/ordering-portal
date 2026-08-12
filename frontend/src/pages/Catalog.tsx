import * as React from 'react';
import { productImageUrl } from '@/lib/supabase';
import { useCart } from '@/lib/CartContext';
import { useMyStores } from '@/lib/useStores';
import { useClientCatalog, type ProductRow } from '@/lib/useClientCatalog';
import { tierPrice } from '@/lib/pricing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { QuickOrderBar } from '@/components/QuickOrderBar';
import type { DisplaySystem } from '@/lib/types';
import { Search, ShoppingCart } from 'lucide-react';

type GroupMode = 'type' | 'display';

export default function Catalog() {
  const cart = useCart();
  const { data: stores, isLoading: storesLoading } = useMyStores();

  // Default to the user's only/first store once loaded.
  React.useEffect(() => {
    if (!cart.storeId && stores && stores.length > 0) {
      cart.setStore(stores[0].id);
    }
  }, [stores, cart]);

  const currentStore = stores?.find((s) => s.id === cart.storeId) ?? null;
  const { tierNumber, clientSkuByProduct, products, productsLoading, productsError } = useClientCatalog(currentStore?.client_id);

  const [search, setSearch] = React.useState('');
  const [groupMode, setGroupMode] = React.useState<GroupMode>('display');
  const [selectedDisplaySystemId, setSelectedDisplaySystemId] = React.useState<string | null>(null);
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [justAdded, setJustAdded] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    if (!products) return [];
    const q = search.trim().toLowerCase();
    let rows = products;
    if (q) {
      rows = rows.filter((p) => {
        const clientSku = clientSkuByProduct.get(p.id) ?? '';
        const haystack = [p.sku, clientSku, p.name, p.description ?? '', p.product_types?.name ?? '', p.display_systems?.name ?? ''].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }
    if (groupMode === 'display' && selectedDisplaySystemId) {
      rows = rows.filter((p) => p.display_system_id === selectedDisplaySystemId);
    }
    return rows;
  }, [products, search, clientSkuByProduct, groupMode, selectedDisplaySystemId]);

  const displaySystemChips = React.useMemo(() => {
    if (!products) return [];
    const map = new Map<string, DisplaySystem>();
    for (const p of products) {
      if (p.display_systems) map.set(p.display_systems.id, p.display_systems as DisplaySystem);
    }
    return [...map.values()].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
  }, [products]);

  // Two-level grouping for "by display system": display system -> product type.
  // For "by product type": a single level, product type only.
  const groups = React.useMemo(() => {
    if (groupMode === 'type') {
      const byType = new Map<string, { label: string; order: number; rows: ProductRow[] }>();
      for (const p of filtered) {
        const key = p.product_types?.id ?? '__none';
        if (!byType.has(key)) {
          byType.set(key, { label: p.product_types?.name ?? 'Ungrouped', order: p.product_types?.display_order ?? 9999, rows: [] });
        }
        byType.get(key)!.rows.push(p);
      }
      return [...byType.entries()]
        .sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label))
        .map(([key, g]) => ({ key, subgroups: [{ key: 'flat', label: null as string | null, rows: g.rows }], label: g.label, order: g.order }));
    }

    const byDisplay = new Map<string, { label: string; order: number; rows: ProductRow[] }>();
    for (const p of filtered) {
      const key = p.display_systems?.id ?? '__none';
      if (!byDisplay.has(key)) {
        byDisplay.set(key, { label: p.display_systems?.name ?? 'Ungrouped', order: p.display_systems?.display_order ?? 9999, rows: [] });
      }
      byDisplay.get(key)!.rows.push(p);
    }
    return [...byDisplay.entries()]
      .sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label))
      .map(([key, g]) => {
        const byType = new Map<string, { label: string; order: number; rows: ProductRow[] }>();
        for (const p of g.rows) {
          const tKey = p.product_types?.id ?? '__none';
          if (!byType.has(tKey)) {
            byType.set(tKey, { label: p.product_types?.name ?? 'Ungrouped', order: p.product_types?.display_order ?? 9999, rows: [] });
          }
          byType.get(tKey)!.rows.push(p);
        }
        const subgroups = [...byType.entries()]
          .sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label))
          .map(([tKey, t]) => ({ key: tKey, label: t.label, rows: t.rows }));
        return { key, label: g.label, order: g.order, subgroups };
      });
  }, [filtered, groupMode]);

  function handleAdd(p: ProductRow) {
    const quantity = quantities[p.id] ?? 1;
    if (quantity < 1) return;
    const clientSku = clientSkuByProduct.get(p.id);
    cart.addLine({
      sku: p.sku,
      description: clientSku ? `${p.name} (${clientSku})` : p.name,
      quantity,
      unit_price: tierPrice(p, tierNumber) ?? undefined,
    });
    setQuantities((prev) => ({ ...prev, [p.id]: 1 }));
    setJustAdded(p.id);
    window.setTimeout(() => setJustAdded((cur) => (cur === p.id ? null : cur)), 1200);
  }

  if (storesLoading || productsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!stores || stores.length === 0) {
    return (
      <Card className="p-6 text-sm text-[var(--muted-foreground)]">
        Your account isn't linked to any store yet. Contact Shonrei to get set up.
      </Card>
    );
  }

  if (productsError) {
    return <Card className="p-6 text-sm text-[var(--danger)]">Couldn't load the catalog: {(productsError as Error).message}</Card>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Catalog</h1>

        {stores.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-[var(--muted-foreground)]">Ordering for</span>
            <select
              className="h-9 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
              value={cart.storeId ?? ''}
              onChange={(e) => {
                if (cart.lines.length > 0 && e.target.value !== cart.storeId) {
                  const ok = window.confirm('Switching store will clear your current cart. Continue?');
                  if (!ok) return;
                  cart.clear();
                }
                cart.setStore(e.target.value);
              }}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Two clearly separate sections: browse/search on the left, the
          rapid-entry quick-add bar on the right -- deliberately not
          styled the same way as each other so they don't get confused
          for one search box. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Browse &amp; search</div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search SKU, name, description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex overflow-hidden rounded-[var(--radius)] border border-[var(--border-strong)]">
              <button
                onClick={() => setGroupMode('display')}
                className={`px-3 py-1.5 text-sm font-medium ${groupMode === 'display' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] hover:bg-[var(--muted)]'}`}
              >
                By display system
              </button>
              <button
                onClick={() => setGroupMode('type')}
                className={`border-l border-[var(--border-strong)] px-3 py-1.5 text-sm font-medium ${groupMode === 'type' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] hover:bg-[var(--muted)]'}`}
              >
                By product type
              </button>
            </div>
          </div>

          {groupMode === 'display' && displaySystemChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setSelectedDisplaySystemId(null)}>
                <Badge tone={selectedDisplaySystemId === null ? 'accent' : 'muted'}>All</Badge>
              </button>
              {displaySystemChips.map((ds) => (
                <button key={ds.id} onClick={() => setSelectedDisplaySystemId(ds.id)}>
                  <Badge tone={selectedDisplaySystemId === ds.id ? 'accent' : 'muted'}>{ds.name}</Badge>
                </button>
              ))}
            </div>
          )}
        </div>

        {products && products.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Quick add</div>
            <QuickOrderBar products={products} clientSkuByProduct={clientSkuByProduct} tierNumber={tierNumber} />
          </div>
        )}
      </div>

      {groups.length === 0 && (
        <Card className="p-6 text-sm text-[var(--muted-foreground)]">No products match your search.</Card>
      )}

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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)] text-left text-xs text-[var(--muted-foreground)]">
                      <th className="w-24 px-4 py-2 font-medium"></th>
                      <th className="px-2 py-2 font-medium">Our SKU</th>
                      <th className="px-2 py-2 font-medium">Client SKU</th>
                      <th className="px-2 py-2 font-medium">Product</th>
                      {tierNumber && <th className="px-2 py-2 text-right font-medium">Price</th>}
                      <th className="px-2 py-2 font-medium">Qty</th>
                      <th className="px-4 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.rows.map((p) => {
                      const thumb = [...p.product_images].sort((a, b) => a.display_order - b.display_order)[0];
                      const price = tierPrice(p, tierNumber);
                      const clientSku = clientSkuByProduct.get(p.id);
                      return (
                        <tr key={p.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/50">
                          <td className="px-4 py-2">
                            {thumb ? (
                              <img
                                src={productImageUrl(thumb.storage_path) ?? undefined}
                                alt={thumb.alt_text ?? p.name}
                                className="h-20 w-20 rounded object-cover"
                              />
                            ) : (
                              <div className="h-20 w-20 rounded bg-[var(--muted)]" />
                            )}
                          </td>
                          <td className="px-2 py-2 font-mono text-xs">{p.sku}</td>
                          <td className="px-2 py-2 font-mono text-xs">{clientSku ?? <span className="text-[var(--muted-foreground)]">—</span>}</td>
                          <td className="px-2 py-2">
                            <div className="font-medium">{p.name}</div>
                            {p.description && <div className="text-xs text-[var(--muted-foreground)] line-clamp-1">{p.description}</div>}
                          </td>
                          {tierNumber && (
                            <td className="px-2 py-2 text-right tabular-nums">{price != null ? `$${price.toFixed(2)}` : '—'}</td>
                          )}
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={1}
                              value={quantities[p.id] ?? 1}
                              onChange={(e) => setQuantities((prev) => ({ ...prev, [p.id]: Math.max(1, Number(e.target.value) || 1) }))}
                              className="h-8 w-16 px-2"
                            />
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button size="sm" variant={justAdded === p.id ? 'primary' : 'secondary'} onClick={() => handleAdd(p)}>
                              <ShoppingCart className="h-3.5 w-3.5" />
                              {justAdded === p.id ? 'Added' : 'Add'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
