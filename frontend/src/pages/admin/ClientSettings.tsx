import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { clientsApi } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { Client } from '@/lib/types';

// Super-admin-only: per-client pricing visibility (025). Reads clients
// directly (existing staff RLS already permits it, same pattern
// ProductCuration.tsx's client dropdown uses) -- only the write lacks
// any client-side RLS, so that goes through the backend.
export default function ClientSettings() {
  const queryClient = useQueryClient();

  const { data: clients, isLoading, error } = useQuery({
    queryKey: ['admin-client-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name, cin7_price_tier, show_pricing').order('name');
      if (error) throw error;
      return data as Client[];
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, showPricing }: { id: string; showPricing: boolean }) => clientsApi.updateShowPricing(id, showPricing),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-client-settings'] }),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (error) {
    return <Card className="p-6 text-sm text-[var(--danger)]">Couldn't load clients: {(error as Error).message}</Card>;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Client settings</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Show or hide pricing (Catalog price column, quick-add prices, Cart/Order Detail totals) per client. This only
          controls what a client's buyers see -- unit prices still flow through to Cin7 for invoicing either way.
        </p>
      </div>

      {toggle.isError && <p className="text-sm text-[var(--danger)]">{(toggle.error as Error).message}</p>}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-2 py-2 font-medium">Pricing</th>
              <th className="w-40 px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(clients ?? []).map((client) => {
              const pending = toggle.isPending && toggle.variables?.id === client.id;
              return (
                <tr key={client.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 font-medium">{client.name}</td>
                  <td className="px-2 py-2">
                    <Badge tone={client.show_pricing ? 'success' : 'muted'}>{client.show_pricing ? 'Visible' : 'Hidden'}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => toggle.mutate({ id: client.id, showPricing: !client.show_pricing })}
                    >
                      {pending ? <Spinner className="h-3.5 w-3.5" /> : client.show_pricing ? 'Hide pricing' : 'Show pricing'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
