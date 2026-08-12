import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storesApi } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Check } from 'lucide-react';

// Client-admins and Shonrei staff can edit their store reference
// numbers directly here instead of needing Supabase dashboard access.
// Store numbers feed the (not-yet-built) auto reference-generation --
// see BACKLOG.md -- so this is where that per-client preset lives.
export default function Account() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['manageable-stores'],
    queryFn: () => storesApi.listManageable(),
  });
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [savedId, setSavedId] = React.useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({ id, storeNumber }: { id: string; storeNumber: string }) => storesApi.updateStoreNumber(id, storeNumber),
    onSuccess: (store) => {
      queryClient.invalidateQueries({ queryKey: ['manageable-stores'] });
      setSavedId(store.id);
      window.setTimeout(() => setSavedId((cur) => (cur === store.id ? null : cur)), 1500);
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (error) {
    return <Card className="p-6 text-sm text-[var(--danger)]">Couldn't load stores: {(error as Error).message}</Card>;
  }

  const stores = data?.stores ?? [];

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Account</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Manage store reference numbers for your client{stores.length !== 1 ? 's' : ''}.</p>
      </div>

      {stores.length === 0 ? (
        <Card className="p-6 text-sm text-[var(--muted-foreground)]">No stores to manage.</Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                <th className="px-4 py-2 font-medium">Store</th>
                <th className="px-2 py-2 font-medium">Client</th>
                <th className="px-2 py-2 font-medium">Store number</th>
                <th className="w-20 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => {
                const value = edits[s.id] ?? s.store_number ?? '';
                const dirty = value !== (s.store_number ?? '');
                return (
                  <tr key={s.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-2 font-medium">{s.name}</td>
                    <td className="px-2 py-2 text-[var(--muted-foreground)]">{s.clients?.name ?? '—'}</td>
                    <td className="px-2 py-2">
                      <Input
                        value={value}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        placeholder="e.g. PR#346"
                        className="h-8 max-w-[10rem]"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {savedId === s.id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
                          <Check className="h-3.5 w-3.5" />
                          Saved
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!dirty || save.isPending || value.trim().length === 0}
                          onClick={() => save.mutate({ id: s.id, storeNumber: value })}
                        >
                          Save
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {save.isError && <p className="text-sm text-[var(--danger)]">{(save.error as Error).message}</p>}
    </div>
  );
}
