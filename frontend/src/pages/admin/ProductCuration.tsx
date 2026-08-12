import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { productsApi } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import type { Client, DisplaySystem, Product, ProductType } from '@/lib/types';
import { RefreshCw, Search } from 'lucide-react';

type ProductRow = Product & {
  product_types: Pick<ProductType, 'id' | 'name'> | null;
  display_systems: Pick<DisplaySystem, 'id' | 'name'> | null;
};

type PortalFilter = 'all' | 'in_portal' | 'not_in_portal';

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;

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

  // Reset pagination whenever the search term changes.
  React.useEffect(() => {
    setPage(0);
    setRows([]);
  }, [search]);

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

  const { data: portalProductIds } = useQuery({
    queryKey: ['client-portal-products', selectedClientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_portal_products').select('product_id').eq('client_id', selectedClientId!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.product_id as string));
    },
    enabled: !!selectedClientId,
  });

  const {
    data: page_,
    isLoading: productsLoading,
    error: productsError,
    isFetching,
  } = useQuery({
    queryKey: ['admin-products-search', search, page],
    queryFn: async () => {
      let query = supabase
        .from('products')
        .select('*, product_types(id, name), display_systems(id, name)')
        .order('name')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const q = sanitizeSearch(search);
      if (q) {
        query = query.or(`sku.ilike.%${q}%,name.ilike.%${q}%,category.ilike.%${q}%,brand.ilike.%${q}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ProductRow[];
    },
  });

  React.useEffect(() => {
    if (!page_) return;
    setRows((prev) => (page === 0 ? page_ : [...prev, ...page_]));
    setHasMore(page_.length === PAGE_SIZE);
  }, [page_, page]);

  const filtered = React.useMemo(() => {
    if (!portalProductIds) return rows;
    return rows.filter((p) => {
      if (portalFilter === 'in_portal') return portalProductIds.has(p.id);
      if (portalFilter === 'not_in_portal') return !portalProductIds.has(p.id);
      return true;
    });
  }, [rows, portalProductIds, portalFilter]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['client-portal-products', selectedClientId] });
  };

  const toggleOne = useMutation({
    mutationFn: (p: ProductRow) => {
      const onPortal = portalProductIds?.has(p.id) ?? false;
      return onPortal ? productsApi.removeFromPortal(p.id, selectedClientId!) : productsApi.addToPortal(p.id, selectedClientId!);
    },
    onSuccess: invalidate,
    onError: (err: Error) => setActionError(err.message),
  });

  const bulkAdd = useMutation({
    mutationFn: () => productsApi.bulkAddToPortal([...selected], selectedClientId!),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Product curation</h1>
        <Button variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          Sync from Cin7
        </Button>
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm text-[var(--muted-foreground)]">Curating portal for</span>
        <select
          className="h-9 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
          value={selectedClientId ?? ''}
          onChange={(e) => {
            setSelectedClientId(e.target.value);
            setSelected(new Set());
          }}
        >
          {(clients ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {selectedClient && <span className="text-xs text-[var(--muted-foreground)]">Products added here only show up for this client.</span>}
      </Card>

      {syncResult && <p className="text-sm text-[var(--success)]">{syncResult}</p>}
      {actionError && <p className="text-sm text-[var(--danger)]">{actionError}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search all ~5,000 Cin7 products by SKU, name, category..."
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
          <Button variant="primary" onClick={() => bulkAdd.mutate()} disabled={bulkAdd.isPending || !selectedClientId}>
            {bulkAdd.isPending ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : `Add ${selected.size} to this client's portal`}
          </Button>
        )}

        <span className="text-xs text-[var(--muted-foreground)]">
          {filtered.length} shown{isFetching && ' — searching...'}
        </span>
      </div>

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
                  <th className="px-2 py-2 font-medium">SKU</th>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-2 py-2 font-medium">Display system</th>
                  <th className="px-2 py-2 font-medium">Product type</th>
                  <th className="px-2 py-2 font-medium">Portal</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const onPortal = portalProductIds?.has(p.id) ?? false;
                  return (
                    <tr key={p.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/50">
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelected(p.id)} />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{p.sku}</td>
                      <td className="px-2 py-2">{p.name}</td>
                      <td className="px-2 py-2 text-[var(--muted-foreground)]">{p.category ?? '—'}</td>
                      <td className="px-2 py-2 text-[var(--muted-foreground)]">{p.display_systems?.name ?? '—'}</td>
                      <td className="px-2 py-2 text-[var(--muted-foreground)]">{p.product_types?.name ?? '—'}</td>
                      <td className="px-2 py-2">
                        <Badge tone={onPortal ? 'success' : 'muted'}>{onPortal ? 'On portal' : 'Off'}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => toggleOne.mutate(p)} disabled={toggleOne.isPending || !selectedClientId}>
                          {onPortal ? 'Remove' : 'Add'}
                        </Button>
                      </td>
                    </tr>
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
