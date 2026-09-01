import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

type Ref = { id: string; name: string; display_order: number } | null;

export interface ResolvedLine {
  id: string;
  display_systems: Ref;
  product_types: Ref;
}

// Cart lines and order_lines carry only sku/description/quantity/
// unit_price -- no product_id (same fact useProductThumbnails.ts
// already documents) -- so grouping either by display system/product
// type means resolving sku -> product on demand, same as thumbnails
// do. Also applies the per-client product_type override (024), so
// Cart/OrderDetail's grouping stays consistent with Catalog's.
// showPricing isn't resolved here -- callers already have (or can get)
// it from useClientCatalog for the same clientId; no need to fetch
// clients.show_pricing a second time.
export function useResolvedLines(skus: string[], clientId: string | undefined) {
  const uniqueSkus = [...new Set(skus)].sort();
  const skuKey = uniqueSkus.join(',');

  const { data: productsBySku } = useQuery({
    queryKey: ['resolved-lines-products', skuKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, display_systems(id, name, display_order), product_types(id, name, display_order)')
        .in('sku', uniqueSkus);
      if (error) throw error;
      const map = new Map<string, { id: string; display_systems: Ref; product_types: Ref }>();
      for (const row of data ?? []) {
        map.set(row.sku as string, {
          id: row.id as string,
          display_systems: row.display_systems as unknown as Ref,
          product_types: row.product_types as unknown as Ref,
        });
      }
      return map;
    },
    enabled: uniqueSkus.length > 0,
  });

  const productIds = React.useMemo(() => [...(productsBySku?.values() ?? [])].map((p) => p.id), [productsBySku]);
  const productIdsKey = productIds.join(',');

  const { data: overrideByProduct } = useQuery({
    queryKey: ['resolved-lines-overrides', clientId, productIdsKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_product_attributes')
        .select('product_id, product_type_id, product_types(id, name, display_order)')
        .eq('client_id', clientId!)
        .in('product_id', productIds);
      if (error) throw error;
      const map = new Map<string, { product_type_id: string | null; product_types: Ref }>();
      for (const row of data ?? []) {
        map.set(row.product_id as string, { product_type_id: row.product_type_id as string | null, product_types: row.product_types as unknown as Ref });
      }
      return map;
    },
    enabled: !!clientId && productIds.length > 0,
  });

  const bySku = React.useMemo(() => {
    const map = new Map<string, ResolvedLine | undefined>();
    for (const sku of uniqueSkus) {
      const p = productsBySku?.get(sku);
      if (!p) {
        map.set(sku, undefined);
        continue;
      }
      const override = overrideByProduct?.get(p.id);
      map.set(sku, {
        id: p.id,
        display_systems: p.display_systems,
        product_types: override?.product_type_id ? override.product_types : p.product_types,
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuKey, productsBySku, overrideByProduct]);

  return { bySku };
}
