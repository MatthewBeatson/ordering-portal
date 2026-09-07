import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

// Read-only for buyer-facing pages -- goes straight through Supabase +
// RLS (custom_group_rules, 030, is select-only for any authenticated
// user, same convention as every other taxonomy table), not the
// staff-gated backend API used by the admin screen. Shared by Catalog,
// Cart, and Order Detail's "Custom" grouping mode -- one shared,
// global rule set, not per-client.
export type CustomGroupRules = Map<string, string[]>; // tray_product_id -> ordered insert_product_ids

export function useCustomGroupRules() {
  const { data } = useQuery({
    queryKey: ['custom-group-rules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('custom_group_rules').select('tray_product_id, insert_product_id, display_order').order('display_order');
      if (error) throw error;
      const map: CustomGroupRules = new Map();
      for (const row of data ?? []) {
        if (!map.has(row.tray_product_id)) map.set(row.tray_product_id, []);
        map.get(row.tray_product_id)!.push(row.insert_product_id);
      }
      return map;
    },
  });
  return data ?? (new Map() as CustomGroupRules);
}
