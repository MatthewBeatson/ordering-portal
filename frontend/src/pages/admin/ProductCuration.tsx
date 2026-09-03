import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, productImageUrl } from '@/lib/supabase';
import { productsApi, productTaxonomyApi, clientProductAttributesApi, clientProductSkusApi, type TaxonomyRow } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import type {
  Client,
  ClientProductAttributeOverride,
  ClientProductSku,
  DisplaySystem,
  Product,
  ProductColour,
  ProductImage,
  ProductJewelleryType,
  ProductType,
} from '@/lib/types';
import { RefreshCw, Search, SlidersHorizontal, Upload, X } from 'lucide-react';

type ProductRow = Product & {
  product_types: Pick<ProductType, 'id' | 'name'> | null;
  product_jewellery_types: Pick<ProductJewelleryType, 'id' | 'name'> | null;
  product_colours: Pick<ProductColour, 'id' | 'name'> | null;
  display_systems: Pick<DisplaySystem, 'id' | 'name'> | null;
  product_images: Pick<ProductImage, 'id' | 'storage_path' | 'display_order'>[];
};

type PortalFilter = 'all' | 'in_portal' | 'not_in_portal';

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;

// Deterministic colour per client (hashed from its id) -- reuses the
// app's existing tone palette (same CSS vars Badge draws from) rather
// than inventing new colours, so a client's "identity colour" here
// stays visually consistent with everything else. The point is purely
// perceptual: staff curating several clients in a row should notice a
// colour CHANGE even before reading the name, making it harder to keep
// working under the wrong client after a switch.
const CLIENT_COLOR_PALETTE = [
  { bg: 'bg-[var(--accent-muted)]', text: 'text-[var(--accent)]', border: 'border-[var(--accent)]' },
  { bg: 'bg-[var(--success-muted)]', text: 'text-[var(--success)]', border: 'border-[var(--success)]' },
  { bg: 'bg-[var(--warning-muted)]', text: 'text-[var(--warning)]', border: 'border-[var(--warning)]' },
  { bg: 'bg-[var(--purple-muted)]', text: 'text-[var(--purple)]', border: 'border-[var(--purple)]' },
  { bg: 'bg-[var(--teal-muted)]', text: 'text-[var(--teal)]', border: 'border-[var(--teal)]' },
  { bg: 'bg-[var(--danger-muted)]', text: 'text-[var(--danger)]', border: 'border-[var(--danger)]' },
];

function clientColor(clientId: string) {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) hash = (hash * 31 + clientId.charCodeAt(i)) | 0;
  return CLIENT_COLOR_PALETTE[Math.abs(hash) % CLIENT_COLOR_PALETTE.length];
}

// Sanitize for embedding in a PostgREST .or() filter string -- commas
// and parentheses have syntax meaning there.
function sanitizeSearch(q: string) {
  return q.replace(/[,()]/g, '').trim();
}

export default function ProductCuration() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [portalFilter, setPortalFilter] = React.useState<PortalFilter>('all');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [expandedProductId, setExpandedProductId] = React.useState<string | null>(null);
  // Bulk classification -- each field has its own enable checkbox so a
  // staff member can choose to touch only some fields across the
  // selection, same "one field at a time" contract as the per-product
  // editors. Global (products.*), not per-client -- deliberately
  // independent of selectedClientId/client-mistake concerns.
  const [bulkTypeEnabled, setBulkTypeEnabled] = React.useState(false);
  const [bulkTypeId, setBulkTypeId] = React.useState('');
  const [bulkJewelleryTypeEnabled, setBulkJewelleryTypeEnabled] = React.useState(false);
  const [bulkJewelleryTypeId, setBulkJewelleryTypeId] = React.useState('');
  const [bulkColourEnabled, setBulkColourEnabled] = React.useState(false);
  const [bulkColourId, setBulkColourId] = React.useState('');
  const [bulkCountEnabled, setBulkCountEnabled] = React.useState(false);
  const [bulkCountText, setBulkCountText] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [rows, setRows] = React.useState<ProductRow[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [syncResult, setSyncResult] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Debounce: the DB does the filtering (this is a ~5,000-product Cin7
  // mirror -- only 500-1000 of which will ever be curated onto any
  // portal), so we don't want to fire a query on every keystroke.
  React.useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const { data: clients } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name, cin7_price_tier').order('name');
      if (error) throw error;
      return data as Client[];
    },
  });
  const [selectedClientId, setSelectedClientId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!selectedClientId && clients && clients.length > 0) setSelectedClientId(clients[0].id);
  }, [clients, selectedClientId]);

  // Reset pagination whenever the query's shape changes -- search term,
  // portal filter, or which client's curation the filter is scoped to.
  React.useEffect(() => {
    setPage(0);
    setRows([]);
  }, [search, portalFilter, selectedClientId]);

  const { data: portalProductIds } = useQuery({
    queryKey: ['client-portal-products', selectedClientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_portal_products').select('product_id').eq('client_id', selectedClientId!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.product_id as string));
    },
    enabled: !!selectedClientId,
  });

  // Taxonomy lists for the per-client attribute override selects below
  // -- staff pick from the same portal-native types/jewellery-held/
  // colours managed on the Product taxonomy screen.
  const { data: taxonomyTypes } = useQuery({ queryKey: ['product-taxonomy', 'types'], queryFn: () => productTaxonomyApi.list('types') });
  const { data: taxonomyJewelleryTypes } = useQuery({
    queryKey: ['product-taxonomy', 'jewellery-types'],
    queryFn: () => productTaxonomyApi.list('jewellery-types'),
  });
  const { data: taxonomyColours } = useQuery({ queryKey: ['product-taxonomy', 'colours'], queryFn: () => productTaxonomyApi.list('colours') });

  // Per-client overrides (024) for the currently-selected client --
  // jewellery_count, plus the rarely-used product_type/jewellery_type/
  // colour overrides.
  const { data: attributeOverrides } = useQuery({
    queryKey: ['client-product-attributes', selectedClientId],
    queryFn: () => clientProductAttributesApi.list(selectedClientId!),
    enabled: !!selectedClientId,
  });
  const overrideByProduct = React.useMemo(() => {
    const map = new Map<string, ClientProductAttributeOverride>();
    for (const row of attributeOverrides ?? []) map.set(row.product_id, row);
    return map;
  }, [attributeOverrides]);

  // Client SKU (010) -- a client's own reference code for a shared
  // product. Same per-(client, product) shape as the attribute
  // overrides above, but its own table -- lives in the same
  // per-client editor for a single place staff manage this.
  const { data: clientSkus } = useQuery({
    queryKey: ['client-product-skus', selectedClientId],
    queryFn: () => clientProductSkusApi.list(selectedClientId!),
    enabled: !!selectedClientId,
  });
  const clientSkuByProduct = React.useMemo(() => {
    const map = new Map<string, ClientProductSku>();
    for (const row of clientSkus ?? []) map.set(row.product_id, row);
    return map;
  }, [clientSkus]);

  const {
    data: page_,
    isLoading: productsLoading,
    error: productsError,
    isFetching,
  } = useQuery({
    // portalFilter/selectedClientId are part of the key -- this query's
    // shape genuinely changes with them now (see below), not just a
    // client-side re-filter of whatever page happened to be loaded.
    queryKey: ['admin-products-search', search, page, portalFilter, selectedClientId],
    queryFn: async () => {
      // "On this portal" / "Not on this portal" must filter the whole
      // ~7,000-product catalog server-side, not just whatever page is
      // already loaded -- with a catalog this size, a curated product
      // is essentially never on the first alphabetical page. Filtering
      // `rows` client-side (the old approach) only ever "worked" by
      // accident when the catalog was small enough that pagination
      // barely mattered.
      if (portalFilter === 'in_portal' && (!portalProductIds || portalProductIds.size === 0)) {
        return [];
      }

      let query = supabase
        .from('products')
        .select(
          '*, product_types(id, name), product_jewellery_types(id, name), product_colours(id, name), display_systems(id, name), product_images(id, storage_path, display_order)'
        )
        .order('name')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const q = sanitizeSearch(search);
      if (q) {
        query = query.or(`sku.ilike.%${q}%,name.ilike.%${q}%,category.ilike.%${q}%,brand.ilike.%${q}%`);
      }

      if (portalFilter === 'in_portal') {
        query = query.in('id', [...portalProductIds!]);
      } else if (portalFilter === 'not_in_portal' && portalProductIds && portalProductIds.size > 0) {
        query = query.not('id', 'in', `(${[...portalProductIds].join(',')})`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ProductRow[];
    },
    // Wait for portalProductIds before running an in_portal/not_in_portal
    // query keyed off it -- otherwise the first render would fire the
    // "all products" shape and immediately refetch once it arrives.
    enabled: portalFilter === 'all' || !!portalProductIds,
  });

  React.useEffect(() => {
    if (!page_) return;
    setRows((prev) => (page === 0 ? page_ : [...prev, ...page_]));
    setHasMore(page_.length === PAGE_SIZE);
  }, [page_, page]);

  // The portal-status filter is now applied server-side (see the query
  // above) -- `rows` already reflects it, nothing left to filter here.
  const filtered = rows;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['client-portal-products', selectedClientId] });
    // Also refresh the product list itself -- when filtered to "on
    // portal" / "not on portal", adding or removing a product changes
    // which rows should even be showing, not just their badge.
    queryClient.invalidateQueries({ queryKey: ['admin-products-search'] });
  };

  const toggleOne = useMutation({
    mutationFn: (p: ProductRow) => {
      const onPortal = portalProductIds?.has(p.id) ?? false;
      return onPortal ? productsApi.removeFromPortal(p.id, selectedClientId!) : productsApi.addToPortal(p.id, selectedClientId!);
    },
    onSuccess: invalidate,
    onError: (err: Error) => setActionError(err.message),
  });

  // Removing always confirms (naming the client, since a wrong-client
  // mistake here silently hides a product from a real buyer's
  // catalog) -- adding stays instant, low blast radius, easy to undo.
  function requestToggle(p: ProductRow) {
    const onPortal = portalProductIds?.has(p.id) ?? false;
    if (onPortal) {
      const ok = window.confirm(`Remove "${p.name}" from ${selectedClient?.name ?? 'this client'}'s portal? Their buyers will no longer see it.`);
      if (!ok) return;
    }
    toggleOne.mutate(p);
  }

  const bulkAdd = useMutation({
    mutationFn: () => productsApi.bulkAddToPortal([...selected], selectedClientId!),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const bulkUpdateTaxonomy = useMutation({
    mutationFn: (input: Parameters<typeof productsApi.bulkUpdateTaxonomy>[1]) => productsApi.bulkUpdateTaxonomy([...selected], input),
    onSuccess: () => {
      setSelected(new Set());
      setBulkTypeEnabled(false);
      setBulkTypeId('');
      setBulkJewelleryTypeEnabled(false);
      setBulkJewelleryTypeId('');
      setBulkColourEnabled(false);
      setBulkColourId('');
      setBulkCountEnabled(false);
      setBulkCountText('');
      queryClient.invalidateQueries({ queryKey: ['admin-products-search'] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  // Builds a human-readable summary for the confirm dialog and only
  // sends fields staff actually enabled. Explicitly warns this is
  // GLOBAL -- easy to assume it's scoped to the currently-curated
  // client, like everything else on this page, but product_type/
  // jewellery_held/colour/jewellery_count are all global fields.
  function applyBulkTaxonomy() {
    const input: Parameters<typeof productsApi.bulkUpdateTaxonomy>[1] = {};
    const changes: string[] = [];
    if (bulkTypeEnabled) {
      input.product_type_id = bulkTypeId || null;
      changes.push(`Product type = ${taxonomyTypes?.find((t) => t.id === bulkTypeId)?.name ?? '(none)'}`);
    }
    if (bulkJewelleryTypeEnabled) {
      input.jewellery_type_id = bulkJewelleryTypeId || null;
      changes.push(`Jewellery held = ${taxonomyJewelleryTypes?.find((t) => t.id === bulkJewelleryTypeId)?.name ?? '(none)'}`);
    }
    if (bulkColourEnabled) {
      input.colour_id = bulkColourId || null;
      changes.push(`Colour = ${taxonomyColours?.find((t) => t.id === bulkColourId)?.name ?? '(none)'}`);
    }
    if (bulkCountEnabled) {
      const count = bulkCountText.trim() === '' ? null : Math.max(0, Number(bulkCountText) || 0);
      input.jewellery_count = count;
      changes.push(`Jewellery count = ${count ?? '(none)'}`);
    }
    if (changes.length === 0) return;

    const ok = window.confirm(
      `Set ${changes.join(', ')} for ${selected.size} product${selected.size === 1 ? '' : 's'}?\n\nThis is global -- it changes these products for every client, not just ${selectedClient?.name ?? 'the one currently selected'}.`
    );
    if (ok) bulkUpdateTaxonomy.mutate(input);
  }

  const saveOverride = useMutation({
    mutationFn: ({ productId, input }: { productId: string; input: Parameters<typeof clientProductAttributesApi.upsert>[2] }) =>
      clientProductAttributesApi.upsert(selectedClientId!, productId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-product-attributes', selectedClientId] }),
    onError: (err: Error) => setActionError(err.message),
  });

  const clearOverride = useMutation({
    mutationFn: (productId: string) => clientProductAttributesApi.remove(selectedClientId!, productId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-product-attributes', selectedClientId] }),
    onError: (err: Error) => setActionError(err.message),
  });

  const saveClientSku = useMutation({
    mutationFn: ({ productId, clientSku }: { productId: string; clientSku: string }) =>
      clientProductSkusApi.upsert(selectedClientId!, productId, clientSku),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-product-skus', selectedClientId] }),
    onError: (err: Error) => setActionError(err.message),
  });

  const clearClientSku = useMutation({
    mutationFn: (productId: string) => clientProductSkusApi.remove(selectedClientId!, productId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-product-skus', selectedClientId] }),
    onError: (err: Error) => setActionError(err.message),
  });

  // Product type/jewellery held/colour are portal-native (023) -- this
  // is the only way a product's own GLOBAL classification ever gets
  // set now (distinct from the per-client override above). Same
  // local-state-patch reasoning as uploadImage/deleteImage below --
  // avoids re-appending a page > 0 refetch.
  const updateTaxonomy = useMutation({
    mutationFn: ({ productId, field, value }: { productId: string; field: 'product_type_id' | 'jewellery_type_id' | 'colour_id'; value: string }) =>
      productsApi.updateTaxonomy(productId, { [field]: value || null }),
    onSuccess: (_result, { productId, field, value }) => {
      const nestedKey = field === 'product_type_id' ? 'product_types' : field === 'jewellery_type_id' ? 'product_jewellery_types' : 'product_colours';
      const list = field === 'product_type_id' ? taxonomyTypes : field === 'jewellery_type_id' ? taxonomyJewelleryTypes : taxonomyColours;
      const chosen = (list ?? []).find((t) => t.id === value) ?? null;
      setRows((prev) => prev.map((p) => (p.id === productId ? { ...p, [field]: value || null, [nestedKey]: chosen ? { id: chosen.id, name: chosen.name } : null } : p)));
    },
    onError: (err: Error) => setActionError(err.message),
  });

  // jewellery_count is a plain number, not a taxonomy-table FK, so it
  // gets its own mutation rather than overloading updateTaxonomy's
  // field union -- same endpoint (products/:id/taxonomy), simpler local
  // state patch (no nested taxonomy object to resolve).
  const updateJewelleryCount = useMutation({
    mutationFn: ({ productId, value }: { productId: string; value: number | null }) =>
      productsApi.updateTaxonomy(productId, { jewellery_count: value }),
    onSuccess: (_result, { productId, value }) => {
      setRows((prev) => prev.map((p) => (p.id === productId ? { ...p, jewellery_count: value } : p)));
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const sync = useMutation({
    mutationFn: () => productsApi.sync(),
    onSuccess: (result) => {
      setSyncResult(`Synced ${result.synced}/${result.total} product(s)${result.failed ? `, ${result.failed} failed` : ''}.`);
      queryClient.invalidateQueries({ queryKey: ['admin-products-search'] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  // Updates local `rows` state directly rather than invalidating the
  // paginated search query -- that query's pages get concatenated into
  // `rows` by page number (see the effect above), so invalidating a
  // page > 0 would re-append instead of replace and duplicate rows.
  // We already know the exact result of an upload/delete, so there's
  // no need to round-trip through a refetch anyway.
  const uploadImage = useMutation({
    mutationFn: ({ productId, file }: { productId: string; file: File }) => productsApi.uploadImage(productId, file),
    onSuccess: (image) => {
      setRows((prev) => prev.map((p) => (p.id === image.product_id ? { ...p, product_images: [...p.product_images, image] } : p)));
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const deleteImage = useMutation({
    mutationFn: ({ imageId }: { productId: string; imageId: string }) => productsApi.deleteImage(imageId),
    onSuccess: (_data, { productId, imageId }) => {
      setRows((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, product_images: p.product_images.filter((img) => img.id !== imageId) } : p))
      );
    },
    onError: (err: Error) => setActionError(err.message),
  });

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const allSelected = filtered.length > 0 && filtered.every((p) => prev.has(p.id));
      if (allSelected) return new Set();
      return new Set(filtered.map((p) => p.id));
    });
  }

  const selectedClient = clients?.find((c) => c.id === selectedClientId);
  const color = selectedClientId ? clientColor(selectedClientId) : null;

  // Switching client mid-edit is the highest-risk moment for a wrong-
  // client mistake -- warn (naming both clients) whenever there's
  // pending, about-to-be-discarded work: a bulk selection in progress,
  // or the per-product attributes editor open. Same pattern Catalog
  // already uses for "switching store clears your cart."
  function handleClientChange(newClientId: string) {
    const hasPendingWork = selected.size > 0 || expandedProductId !== null;
    if (hasPendingWork && newClientId !== selectedClientId) {
      const fromName = selectedClient?.name ?? 'the current client';
      const ok = window.confirm(
        `Switching from ${fromName} will clear your current selection${expandedProductId ? ' and close the open attributes editor' : ''}. Continue?`
      );
      if (!ok) return;
    }
    setSelectedClientId(newClientId);
    setSelected(new Set());
    setExpandedProductId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Product curation</h1>
        <Button variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          Sync from Cin7
        </Button>
      </div>

      {/* Sticky + colour-coded so which client is active stays
          impossible to miss even after scrolling through a long
          product list -- the colour itself is a perceptual check: a
          staff member curating several clients in a row should notice
          a colour CHANGE even before reading the name. */}
      <Card
        className={`sticky top-0 z-20 flex flex-wrap items-center gap-2 border-2 p-3 ${color ? `${color.bg} ${color.border}` : ''}`}
      >
        <span className={`text-xs font-semibold uppercase tracking-wide ${color ? color.text : 'text-[var(--muted-foreground)]'}`}>
          Curating for
        </span>
        <select
          className="h-9 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] px-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-[var(--accent)]"
          value={selectedClientId ?? ''}
          onChange={(e) => handleClientChange(e.target.value)}
        >
          {(clients ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {selectedClient && (
          <span className="text-xs text-[var(--muted-foreground)]">Products added/removed here only affect this client.</span>
        )}
      </Card>

      {syncResult && <p className="text-sm text-[var(--success)]">{syncResult}</p>}
      {actionError && <p className="text-sm text-[var(--danger)]">{actionError}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search all ~7,000 Cin7 products by SKU, name, category..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex overflow-hidden rounded-[var(--radius)] border border-[var(--border-strong)]">
          {(['all', 'in_portal', 'not_in_portal'] as PortalFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setPortalFilter(f)}
              className={`border-l border-[var(--border-strong)] px-3 py-1.5 text-sm font-medium first:border-l-0 ${
                portalFilter === f ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] hover:bg-[var(--muted)]'
              }`}
            >
              {f === 'all' ? 'All' : f === 'in_portal' ? 'On this portal' : 'Not on this portal'}
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <Button
            variant="primary"
            onClick={() => {
              const ok = window.confirm(
                `Add ${selected.size} product${selected.size === 1 ? '' : 's'} to ${selectedClient?.name ?? 'this client'}'s portal? This makes them visible to their buyers immediately.`
              );
              if (ok) bulkAdd.mutate();
            }}
            disabled={bulkAdd.isPending || !selectedClientId}
          >
            {bulkAdd.isPending ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : `Add ${selected.size} to this client's portal`}
          </Button>
        )}

        <span className="text-xs text-[var(--muted-foreground)]">
          {filtered.length} shown{isFetching && ' — searching...'}
        </span>
      </div>

      {selected.size > 0 && (
        <Card className="flex flex-wrap items-end gap-4 p-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Bulk edit {selected.size} selected
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">Global -- applies for every client, not just {selectedClient?.name ?? 'the one selected above'}</span>
          </div>

          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={bulkTypeEnabled} onChange={(e) => setBulkTypeEnabled(e.target.checked)} />
            Product type
            <TaxonomySelect value={bulkTypeId || null} options={taxonomyTypes ?? []} onChange={setBulkTypeId} disabled={!bulkTypeEnabled} />
          </label>

          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={bulkJewelleryTypeEnabled}
              onChange={(e) => setBulkJewelleryTypeEnabled(e.target.checked)}
            />
            Jewellery held
            <TaxonomySelect
              value={bulkJewelleryTypeId || null}
              options={taxonomyJewelleryTypes ?? []}
              onChange={setBulkJewelleryTypeId}
              disabled={!bulkJewelleryTypeEnabled}
            />
          </label>

          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={bulkColourEnabled} onChange={(e) => setBulkColourEnabled(e.target.checked)} />
            Colour
            <TaxonomySelect value={bulkColourId || null} options={taxonomyColours ?? []} onChange={setBulkColourId} disabled={!bulkColourEnabled} />
          </label>

          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={bulkCountEnabled} onChange={(e) => setBulkCountEnabled(e.target.checked)} />
            Jewellery count
            <Input
              type="number"
              min={0}
              value={bulkCountText}
              onChange={(e) => setBulkCountText(e.target.value)}
              disabled={!bulkCountEnabled}
              className="h-8 w-20 px-2 text-xs disabled:opacity-50"
            />
          </label>

          <Button
            size="sm"
            variant="primary"
            disabled={
              bulkUpdateTaxonomy.isPending || !(bulkTypeEnabled || bulkJewelleryTypeEnabled || bulkColourEnabled || bulkCountEnabled)
            }
            onClick={applyBulkTaxonomy}
          >
            {bulkUpdateTaxonomy.isPending ? <Spinner className="h-3.5 w-3.5 border-white/30 border-t-white" /> : `Apply to ${selected.size}`}
          </Button>
        </Card>
      )}

      {productsLoading && page === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : productsError ? (
        <Card className="p-6 text-sm text-[var(--danger)]">Couldn't load products: {(productsError as Error).message}</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)] text-left text-xs text-[var(--muted-foreground)]">
                  <th className="w-10 px-4 py-2">
                    <input type="checkbox" checked={filtered.length > 0 && filtered.every((p) => selected.has(p.id))} onChange={toggleSelectAllVisible} />
                  </th>
                  <th className="w-16 px-2 py-2 font-medium"></th>
                  <th className="px-2 py-2 font-medium">SKU</th>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-2 py-2 font-medium">Display system</th>
                  <th className="px-2 py-2 font-medium">Product type</th>
                  <th className="px-2 py-2 font-medium">Jewellery held</th>
                  <th className="px-2 py-2 font-medium">Colour</th>
                  <th className="px-2 py-2 font-medium">Jewellery count</th>
                  <th className="px-2 py-2 font-medium">Portal</th>
                  <th className="px-2 py-2 font-medium">Attributes</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const onPortal = portalProductIds?.has(p.id) ?? false;
                  const override = overrideByProduct.get(p.id);
                  const hasOverride =
                    !!override &&
                    (override.jewellery_count != null ||
                      override.product_type_id != null ||
                      override.jewellery_type_id != null ||
                      override.colour_id != null);
                  const expanded = expandedProductId === p.id;
                  return (
                    <React.Fragment key={p.id}>
                      <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/50">
                        <td className="px-4 py-2">
                          <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelected(p.id)} />
                        </td>
                        <td className="px-2 py-2">
                          <ProductImageCell
                            product={p}
                            uploading={uploadImage.isPending && uploadImage.variables?.productId === p.id}
                            onUpload={(file) => uploadImage.mutate({ productId: p.id, file })}
                            onDelete={(imageId) => deleteImage.mutate({ productId: p.id, imageId })}
                          />
                        </td>
                        <td className="px-2 py-2 font-mono text-xs">{p.sku}</td>
                        <td className="px-2 py-2">{p.name}</td>
                        <td className="px-2 py-2 text-[var(--muted-foreground)]">{p.category ?? '—'}</td>
                        <td className="px-2 py-2 text-[var(--muted-foreground)]">{p.display_systems?.name ?? '—'}</td>
                        <td className="px-2 py-2">
                          <TaxonomySelect
                            value={p.product_type_id}
                            options={taxonomyTypes ?? []}
                            onChange={(value) => updateTaxonomy.mutate({ productId: p.id, field: 'product_type_id', value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <TaxonomySelect
                            value={p.jewellery_type_id}
                            options={taxonomyJewelleryTypes ?? []}
                            onChange={(value) => updateTaxonomy.mutate({ productId: p.id, field: 'jewellery_type_id', value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <TaxonomySelect
                            value={p.colour_id}
                            options={taxonomyColours ?? []}
                            onChange={(value) => updateTaxonomy.mutate({ productId: p.id, field: 'colour_id', value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <JewelleryCountInput
                            value={p.jewellery_count}
                            onSave={(value) => updateJewelleryCount.mutate({ productId: p.id, value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Badge tone={onPortal ? 'success' : 'muted'}>{onPortal ? 'On portal' : 'Off'}</Badge>
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!selectedClientId}
                            onClick={() => setExpandedProductId(expanded ? null : p.id)}
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            {hasOverride ? 'Override set' : 'Set for client'}
                          </Button>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button size="sm" variant="ghost" onClick={() => requestToggle(p)} disabled={toggleOne.isPending || !selectedClientId}>
                            {onPortal ? 'Remove' : 'Add'}
                          </Button>
                        </td>
                      </tr>
                      {expanded && selectedClientId && (
                        <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30 last:border-0">
                          <td colSpan={13} className="px-4 py-3">
                            <AttributesEditor
                              product={p}
                              override={override}
                              taxonomyTypes={taxonomyTypes ?? []}
                              taxonomyJewelleryTypes={taxonomyJewelleryTypes ?? []}
                              taxonomyColours={taxonomyColours ?? []}
                              saving={saveOverride.isPending && saveOverride.variables?.productId === p.id}
                              clearing={clearOverride.isPending && clearOverride.variables === p.id}
                              onSave={(input) => saveOverride.mutate({ productId: p.id, input })}
                              onClear={() => clearOverride.mutate(p.id)}
                              clientSku={clientSkuByProduct.get(p.id)?.client_sku ?? ''}
                              savingSku={saveClientSku.isPending && saveClientSku.variables?.productId === p.id}
                              clearingSku={clearClientSku.isPending && clearClientSku.variables === p.id}
                              onSaveSku={(clientSku) => saveClientSku.mutate({ productId: p.id, clientSku })}
                              onClearSku={() => clearClientSku.mutate(p.id)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && !productsLoading && (
            <p className="p-6 text-center text-sm text-[var(--muted-foreground)]">
              {search ? 'No products match your search.' : 'No products found.'}
            </p>
          )}

          {hasMore && (
            <div className="flex justify-center border-t border-[var(--border)] p-3">
              <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)} disabled={isFetching}>
                {isFetching ? <Spinner className="h-4 w-4" /> : 'Load more'}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// Inline editable select for a product's own GLOBAL classification
// (product_type_id/jewellery_type_id/colour_id, portal-native as of
// 023) -- plain <select>, same style as the "Curating portal for"
// dropdown above. A blank option always exists (unclassified is valid
// -- not every product needs every facet set).
function TaxonomySelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string | null;
  options: TaxonomyRow[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="h-8 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] px-2 text-xs outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

// Inline editable number input for a product's own GLOBAL
// jewellery_count (026) -- commits on blur/Enter rather than every
// keystroke, same reasoning as ProductTaxonomy.tsx's display_order
// field.
function JewelleryCountInput({ value, onSave }: { value: number | null; onSave: (value: number | null) => void }) {
  const [text, setText] = React.useState(value?.toString() ?? '');
  React.useEffect(() => setText(value?.toString() ?? ''), [value]);

  function commit() {
    const next = text.trim() === '' ? null : Math.max(0, Number(text) || 0);
    if (next !== value) onSave(next);
  }

  return (
    <Input
      type="number"
      min={0}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="h-8 w-20 px-2 text-xs"
    />
  );
}

// Per-client override editor for one product -- product type/
// jewellery held/colour (blank = "use the product's global value",
// rarely changed in practice) plus jewellery count (no global
// fallback -- always client-set, same as it's always been). Mirrors
// client_product_attributes (022, extended by 024) field for field.
function AttributesEditor({
  product,
  override,
  taxonomyTypes,
  taxonomyJewelleryTypes,
  taxonomyColours,
  saving,
  clearing,
  onSave,
  onClear,
  clientSku,
  savingSku,
  clearingSku,
  onSaveSku,
  onClearSku,
}: {
  product: ProductRow;
  override: ClientProductAttributeOverride | undefined;
  taxonomyTypes: TaxonomyRow[];
  taxonomyJewelleryTypes: TaxonomyRow[];
  taxonomyColours: TaxonomyRow[];
  saving: boolean;
  clearing: boolean;
  onSave: (input: { jewellery_count: number | null; product_type_id: string | null; jewellery_type_id: string | null; colour_id: string | null }) => void;
  onClear: () => void;
  clientSku: string;
  savingSku: boolean;
  clearingSku: boolean;
  onSaveSku: (clientSku: string) => void;
  onClearSku: () => void;
}) {
  const [jewelleryCount, setJewelleryCount] = React.useState(override?.jewellery_count?.toString() ?? '');
  const [productTypeId, setProductTypeId] = React.useState(override?.product_type_id ?? '');
  const [jewelleryTypeId, setJewelleryTypeId] = React.useState(override?.jewellery_type_id ?? '');
  const [colourId, setColourId] = React.useState(override?.colour_id ?? '');
  const [skuText, setSkuText] = React.useState(clientSku);

  React.useEffect(() => {
    setJewelleryCount(override?.jewellery_count?.toString() ?? '');
    setProductTypeId(override?.product_type_id ?? '');
    setJewelleryTypeId(override?.jewellery_type_id ?? '');
    setColourId(override?.colour_id ?? '');
  }, [override]);

  React.useEffect(() => setSkuText(clientSku), [clientSku]);

  const selectClass =
    'h-8 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]';

  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
        Client SKU
        <span className="text-[10px]">This client's own code -- no global equivalent</span>
        <div className="flex items-center gap-1">
          <Input
            value={skuText}
            onChange={(e) => setSkuText(e.target.value)}
            placeholder="e.g. PR#346-A"
            className="h-8 w-32"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={savingSku || !skuText.trim() || skuText.trim() === clientSku}
            onClick={() => onSaveSku(skuText.trim())}
          >
            {savingSku ? <Spinner className="h-3.5 w-3.5" /> : 'Save'}
          </Button>
          {clientSku && (
            <Button size="sm" variant="ghost" disabled={clearingSku} onClick={onClearSku}>
              {clearingSku ? <Spinner className="h-3.5 w-3.5" /> : 'Clear'}
            </Button>
          )}
        </div>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
        Product type override
        <span className="text-[10px]">Global: {product.product_types?.name ?? '—'}</span>
        <select className={selectClass} value={productTypeId} onChange={(e) => setProductTypeId(e.target.value)}>
          <option value="">Use global</option>
          {taxonomyTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
        Jewellery held override
        <span className="text-[10px]">Global: {product.product_jewellery_types?.name ?? '—'}</span>
        <select className={selectClass} value={jewelleryTypeId} onChange={(e) => setJewelleryTypeId(e.target.value)}>
          <option value="">Use global</option>
          {taxonomyJewelleryTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
        Colour override
        <span className="text-[10px]">Global: {product.product_colours?.name ?? '—'}</span>
        <select className={selectClass} value={colourId} onChange={(e) => setColourId(e.target.value)}>
          <option value="">Use global</option>
          {taxonomyColours.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
        Jewellery count override
        <span className="text-[10px]">Global: {product.jewellery_count ?? '—'}</span>
        <Input
          type="number"
          min={0}
          value={jewelleryCount}
          onChange={(e) => setJewelleryCount(e.target.value)}
          className="h-8 w-24"
        />
      </label>

      <Button
        size="sm"
        variant="primary"
        disabled={saving}
        onClick={() =>
          onSave({
            jewellery_count: jewelleryCount.trim() === '' ? null : Math.max(0, Number(jewelleryCount) || 0),
            product_type_id: productTypeId || null,
            jewellery_type_id: jewelleryTypeId || null,
            colour_id: colourId || null,
          })
        }
      >
        {saving ? <Spinner className="h-3.5 w-3.5 border-white/30 border-t-white" /> : 'Save'}
      </Button>
      {override && (
        <Button size="sm" variant="ghost" disabled={clearing} onClick={onClear}>
          {clearing ? <Spinner className="h-3.5 w-3.5" /> : 'Clear all overrides'}
        </Button>
      )}
    </div>
  );
}

// Click-to-upload thumbnail, same pattern as an avatar picker: click
// the image (or the placeholder box if there isn't one yet) to open a
// file picker; a small x overlay removes the current image. Only ever
// shows/manages the first image by display_order -- a product having
// several images is supported by the schema but not exposed in this
// UI yet, one photo is enough for curation purposes.
function ProductImageCell({
  product,
  uploading,
  onUpload,
  onDelete,
}: {
  product: ProductRow;
  uploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (imageId: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const thumb = [...product.product_images].sort((a, b) => a.display_order - b.display_order)[0];
  const url = thumb ? productImageUrl(thumb.storage_path) : null;

  return (
    <div className="relative h-12 w-12">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="group relative flex h-12 w-12 items-center justify-center overflow-hidden rounded bg-[var(--muted)]"
        title={url ? 'Replace image' : 'Upload image'}
      >
        {url ? (
          <img src={url} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <Upload className="h-4 w-4 text-[var(--muted-foreground)]" />
        )}
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Spinner className="h-4 w-4 border-white/30 border-t-white" />
          </div>
        )}
        {!uploading && (
          <div className="absolute inset-0 hidden items-center justify-center bg-black/40 group-hover:flex">
            <Upload className="h-4 w-4 text-white" />
          </div>
        )}
      </button>
      {url && thumb && !uploading && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(thumb.id);
          }}
          title="Remove image"
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--danger)] text-white"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}
