import { useQuery } from '@tanstack/react-query';
import { supabase, productImageUrl } from './supabase';

// Cart lines and order_lines only carry sku/description/quantity/
// unit_price -- no product_id -- so showing an image for either means
// resolving sku -> product -> its first image on demand. Returns a
// Map<sku, url | null> keyed by the exact skus asked for.
export function useProductThumbnails(skus: string[]) {
  const uniqueSkus = [...new Set(skus)].sort();
  const key = uniqueSkus.join(',');

  return useQuery({
    queryKey: ['product-thumbnails', key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('sku, product_images(storage_path, display_order)')
        .in('sku', uniqueSkus);
      if (error) throw error;

      const map = new Map<string, string | null>();
      for (const row of data ?? []) {
        const images = (row.product_images ?? []) as { storage_path: string; display_order: number }[];
        const thumb = [...images].sort((a, b) => a.display_order - b.display_order)[0];
        map.set(row.sku as string, thumb ? productImageUrl(thumb.storage_path) : null);
      }
      return map;
    },
    enabled: uniqueSkus.length > 0,
  });
}
