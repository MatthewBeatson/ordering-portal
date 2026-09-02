import * as React from 'react';
import { productImageUrl } from '@/lib/supabase';
import { useCart } from '@/lib/CartContext';
import { useAuth } from '@/lib/AuthContext';
import { useMyStores } from '@/lib/useStores';
import { useClientCatalog, type ProductRow } from '@/lib/useClientCatalog';
import { tierPrice } from '@/lib/pricing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { QuickOrderBar } from '@/components/QuickOrderBar';
import { ImageSizeToggle, IMAGE_SIZE_CLASS, IMAGE_COL_CLASS } from '@/components/ImageSizeToggle';
import { GroupModeToggle } from '@/components/GroupModeToggle';
import { groupProducts, type GroupMode } from '@/lib/groupProducts';
import type { DisplaySystem } from '@/lib/types';
import { Search, ShoppingCart } from 'lucide-react';

// Three parallel facets under 'display' mode -- Type, Jewellery held,
// Colour -- sourced from Cin7 Additional Attributes 1/2/3. "Parallel"
// deliberately, not a fixed cascade: a user can pick any of the three
// in any order, and each facet's own available chips are computed from
// what's left after every OTHER active facet (search + display system
// + the other two facets), never resetting one when another changes.
// Only the top-level display-system selection resets all three, since
// that's a genuinely different product pool.
type FacetKey = 'productType' | 'jewelleryType' | 'colour';
type FacetRef = { id: string; name: string; display_order: number };

const FACETS: { key: FacetKey; label: string; getRef: (p: ProductRow) => FacetRef | null }[] = [
  { key: 'productType', label: 'Type', getRef: (p) => p.product_types },
  { key: 'jewelleryType', label: 'Jewellery held', getRef: (p) => p.product_jewellery_types },
  { key: 'colour', label: 'Colour', getRef: (p) => p.product_colours },
];

export default function Catalog() {
  const cart = useCart();
  const { data: stores, isLoading: storesLoading } = useMyStores();
  const { imageSizePreference: imageSize, setImageSizePreference: setImageSize } = useAuth();
  const showImages = imageSize !== 'hide';

  // Default to the user's only/first store once loaded.
  React.useEffect(() => {
    if (!cart.storeId && stores && stores.length > 0) {
      cart.setStore(stores[0].id);
    }
  }, [stores, cart]);

  const currentStore = stores?.find((s) => s.id === cart.storeId) ?? null;
  // tierNumber stays real (unaffected by showPricing) -- it's what
  // computes the unit_price actually attached to a cart line, and that
  // value still has to flow through to Cin7 for invoicing regardless
  // of whether this client's buyers can see prices in the portal.
  // showPricing only gates what gets *displayed*.
  const { tierNumber, showPricing, clientSkuByProduct, products, productsLoading, productsError } = useClientCatalog(currentStore?.client_id);

  const [search, setSearch] = React.useState('');
  const [groupMode, setGroupMode] = React.useState<GroupMode>('display');
  const [selectedDisplaySystemId, setSelectedDisplaySystemId] = React.useState<string | null>(null);
  const [facetSelections, setFacetSelections] = React.useState<Record<FacetKey, Set<string>>>({
    productType: new Set(),
    jewelleryType: new Set(),
    colour: new Set(),
  });
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [justAdded, setJustAdded] = React.useState<string | null>(null);

  // Reset all three facets whenever the display-system selection
  // changes -- the whole product pool shifts, so a stale facet
  // selection could silently filter everything out. The facets never
  // reset each other, only this higher-level change does.
  React.useEffect(() => {
    setFacetSelections({ productType: new Set(), jewelleryType: new Set(), colour: new Set() });
  }, [selectedDisplaySystemId]);

  const searchAndDisplayFiltered = React.useMemo(() => {
    if (!products) return [];
    const q = search.trim().toLowerCase();
    let rows = products;
    if (q) {
      rows = rows.filter((p) => {
        const clientSku = clientSkuByProduct.get(p.id) ?? '';
        const haystack = [
          p.sku,
          clientSku,
          p.name,
          p.description ?? '',
          p.product_types?.name ?? '',
          p.product_jewellery_types?.name ?? '',
          p.product_colours?.name ?? '',
          p.display_systems?.name ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    if (groupMode === 'display' && selectedDisplaySystemId) {
      rows = rows.filter((p) => p.display_system_id === selectedDisplaySystemId);
    }
    return rows;
  }, [products, search, clientSkuByProduct, groupMode, selectedDisplaySystemId]);

  // A row matches if it satisfies every active facet except the one
  // named in `excludeKey` (pass null to apply all three, used for the
  // final product list; pass a facet's own key when computing THAT
  // facet's chip options, so its own selection doesn't shrink its own
  // choices).
  const matchesFacets = React.useCallback(
    (p: ProductRow, excludeKey: FacetKey | null) =>
      FACETS.every((f) => {
        if (f.key === excludeKey) return true;
        const selected = facetSelections[f.key];
        if (selected.size === 0) return true;
        const ref = f.getRef(p);
        return !!ref && selected.has(ref.id);
      }),
    [facetSelections]
  );

  const filtered = React.useMemo(() => {
    if (groupMode !== 'display') return searchAndDisplayFiltered;
    return searchAndDisplayFiltered.filter((p) => matchesFacets(p, null));
  }, [searchAndDisplayFiltered, groupMode, matchesFacets]);

  const displaySystemChips = React.useMemo(() => {
    if (!products) return [];
    const map = new Map<string, DisplaySystem>();
    for (const p of products) {
      if (p.display_systems) map.set(p.display_systems.id, p.display_systems as DisplaySystem);
    }
    return [...map.values()].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
  }, [products]);

  // Each facet's own available chips, computed from what's left after
  // every OTHER active facet (search + display system + the other two
  // facets) -- never narrowed by the facet's own current selection, so
  // picking a chip never makes its siblings disappear. Always ordered
  // by display_order, the same canonical order used everywhere these
  // types appear (including 'by product type' mode's own grouping).
  const facetChips = React.useMemo(() => {
    const result = {} as Record<FacetKey, FacetRef[]>;
    for (const facet of FACETS) {
      const map = new Map<string, FacetRef>();
      for (const p of searchAndDisplayFiltered) {
        if (!matchesFacets(p, facet.key)) continue;
        const ref = facet.getRef(p);
        if (ref) map.set(ref.id, ref);
      }
      result[facet.key] = [...map.values()].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
    }
    return result;
  }, [searchAndDisplayFiltered, matchesFacets]);

  function toggleFacet(key: FacetKey, id: string) {
    setFacetSelections((prev) => {
      const next = new Set(prev[key]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [key]: next };
    });
  }

  // Two-level grouping for "by display system": display system -> product
  // type. For "by product type": a single level, product type only.
  // Shared with Cart/OrderDetail -- see lib/groupProducts.ts.
  const groups = React.useMemo(
    () => groupProducts(filtered, groupMode, (p) => p.display_systems, (p) => p.product_types),
    [filtered, groupMode]
  );

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

        <div className="flex items-center gap-3">
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
          <ImageSizeToggle value={imageSize} onChange={setImageSize} />
        </div>
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

            <GroupModeToggle value={groupMode} onChange={setGroupMode} />
          </div>

          {groupMode === 'display' && displaySystemChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setSelectedDisplaySystemId(null)}>
                <Badge tone={selectedDisplaySystemId === null ? 'accent' : 'muted'}>All</Badge>
              </button>
              {displaySystemChips.map((ds) => (
                <button key={ds.id} onClick={() => setSelectedDisplaySystemId(ds.id)}>
                  <Badge tone={selectedDisplaySystemId === ds.id ? 'accent' : 'muted'}>{ds.name}</Badge>
                </button>
              ))}
              {selectedDisplaySystemId !== null && (
                <button
                  onClick={() => setSelectedDisplaySystemId(null)}
                  className="text-xs font-medium text-[var(--muted-foreground)] underline hover:text-[var(--foreground)]"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {groupMode === 'display' &&
            FACETS.map((facet) =>
              facetChips[facet.key].length > 0 ? (
                <div key={facet.key} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-[var(--muted-foreground)]">{facet.label}:</span>
                  {facetChips[facet.key].map((ref) => (
                    <button key={ref.id} onClick={() => toggleFacet(facet.key, ref.id)}>
                      <Badge tone={facetSelections[facet.key].has(ref.id) ? 'accent' : 'muted'}>{ref.name}</Badge>
                    </button>
                  ))}
                  {facetSelections[facet.key].size > 0 && (
                    <button
                      onClick={() => setFacetSelections((prev) => ({ ...prev, [facet.key]: new Set<string>() }))}
                      className="text-xs font-medium text-[var(--muted-foreground)] underline hover:text-[var(--foreground)]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              ) : null
            )}
        </div>

        {products && products.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Quick add</div>
            <QuickOrderBar products={products} clientSkuByProduct={clientSkuByProduct} tierNumber={tierNumber} showPricing={showPricing} />
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
                      {showImages && <th className={`${IMAGE_COL_CLASS[imageSize]} px-4 py-2 font-medium`}></th>}
                      <th className="px-2 py-2 font-medium">Our SKU</th>
                      <th className="px-2 py-2 font-medium">Client SKU</th>
                      <th className="px-2 py-2 font-medium">Product</th>
                      {tierNumber && showPricing && <th className="px-2 py-2 text-right font-medium">Price</th>}
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
                          {showImages && (
                            <td className="px-4 py-2">
                              {thumb ? (
                                <img
                                  src={productImageUrl(thumb.storage_path) ?? undefined}
                                  alt={thumb.alt_text ?? p.name}
                                  className={`${IMAGE_SIZE_CLASS[imageSize]} rounded bg-[var(--muted)] object-contain`}
                                />
                              ) : (
                                <div className={`${IMAGE_SIZE_CLASS[imageSize]} rounded bg-[var(--muted)]`} />
                              )}
                            </td>
                          )}
                          <td className="px-2 py-2 font-mono text-xs">{p.sku}</td>
                          <td className="px-2 py-2 font-mono text-xs">{clientSku ?? <span className="text-[var(--muted-foreground)]">—</span>}</td>
                          <td className="px-2 py-2">
                            <div className="font-medium">{p.name}</div>
                            {p.description && <div className="text-xs text-[var(--muted-foreground)] line-clamp-1">{p.description}</div>}
                          </td>
                          {tierNumber && showPricing && (
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
