import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { parseTierNumber } from './pricing';
import type { Client, ClientProductSku, DisplaySystem, Product, ProductType } from './types';

export type ProductRow = Product & {
  product_images: { storage_path: string; display_order: number; alt_text: string | null }[];
  product_types: Pick<ProductType, 'id' | 'name' | 'display_order'> | null;
  display_systems: Pick<DisplaySystem, 'id' | 'name' | 'display_order'> | null;
};

// Shared by every page that needs a client's curated products + price
// tier + client-SKU labels (Catalog for browsing, Cart for the quick-
// add bar) so there's one query implementation, not one per page.
export function useClientCatalog(clientId: string | undefined) {
  const { data: client } = useQuery({
    queryKey: ['client', clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name, cin7_price_tier').eq('id', clientId!).single();
      if (error) throw error;
      return data as Client;
    },
    enabled: !!clientId,
  });
  const tierNumber = parseTierNumber(client?.cin7_price_tier);

  const { data: clientSkus } = useQuery({
    queryKey: ['client-product-skus', clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_product_skus').select('client_id, product_id, client_sku').eq('client_id', clientId!);
      if (error) throw error;
      return data as ClientProductSku[];
    },
    enabled: !!clientId,
  });
  const clientSkuByProduct = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of clientSkus ?? []) map.set(row.product_id, row.client_sku);
    return map;
  }, [clientSkus]);

  const {
    data: products,
    isLoading: productsLoading,
    error: productsError,
  } = useQuery({
    queryKey: ['catalog-products', clientId],
    queryFn: async () => {
      // Deliberately queried FROM client_portal_products, not products
      // filtered by RLS -- the products RLS policy lets is_portal_admin
      // see the entire uncurated Cin7 mirror (needed for the curation
      // screen's search), and that bypass must never leak into any
      // buyer-facing page. A staff member testing as a given store must
      // see exactly what's curated for that store's client, same as a
      // real buyer would -- never "everything in Cin7."
      const { data, error } = await supabase
        .from('client_portal_products')
        .select(
          'product_id, products(*, product_images(storage_path, display_order, alt_text), product_types(id, name, display_order), display_systems(id, name, display_order))'
        )
        .eq('client_id', clientId!);
      if (error) throw error;
      return (data ?? [])
        .map((row) => row.products as unknown as ProductRow)
        .filter((p): p is ProductRow => !!p && p.is_active)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!clientId,
  });

  return { client, tierNumber, clientSkuByProduct, products, productsLoading, productsError };
}
