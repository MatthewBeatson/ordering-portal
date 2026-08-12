import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';
import type { Store } from './types';

// Stores the signed-in user can place/view orders for. Backed by RLS
// (stores' own SELECT policy already scopes this), filtered to the same
// accessibleStoreIds the AuthContext already resolved so admins/non-admins
// see a consistent list without a second round of role logic here.
export function useMyStores() {
  const { session, accessibleStoreIds, loading: authLoading } = useAuth();
  const ids = Array.from(accessibleStoreIds).sort();

  return useQuery({
    queryKey: ['my-stores', session?.user.id, ids.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('stores').select('id, name, client_id, store_number').in('id', ids).order('name');
      if (error) throw error;
      return data as Store[];
    },
    enabled: !authLoading && !!session && ids.length > 0,
  });
}
