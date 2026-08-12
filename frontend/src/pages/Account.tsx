import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storesApi, clientsApi, type ManageableStore } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Check, Plus } from 'lucide-react';

// Client-admins and Shonrei staff manage store reference numbers --
// and now whole stores -- directly here instead of needing Supabase
// dashboard access. Store numbers feed the (not-yet-built) auto
// reference-generation -- see BACKLOG.md -- so this is where that
// per-client preset lives. Grouped by client since a client can have
// several stores, each needing its own number.
export default function Account() {
  const queryClient = useQueryClient();

  const { data: clientsData, isLoading: clientsLoading, error: clientsError } = useQuery({
    queryKey: ['manageable-clients'],
    queryFn: () => clientsApi.listManageable(),
  });
  const { data: storesData, isLoading: storesLoading, error: storesError } = useQuery({
    queryKey: ['manageable-stores'],
    queryFn: () => storesApi.listManageable(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['manageable-stores'] });
  };

  if (clientsLoading || storesLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (clientsError || storesError) {
    return (
      <Card className="p-6 text-sm text-[var(--danger)]">
        Couldn't load your account settings: {((clientsError || storesError) as Error).message}
      </Card>
    );
  }

  const clients = clientsData?.clients ?? [];
  const stores = storesData?.stores ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Account</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Manage stores and their reference numbers for your client{clients.length !== 1 ? 's' : ''}.</p>
      </div>

      {clients.length === 0 ? (
        <Card className="p-6 text-sm text-[var(--muted-foreground)]">No clients to manage.</Card>
      ) : (
        clients.map((client) => (
          <ClientStoreGroup
            key={client.id}
            clientId={client.id}
            clientName={client.name}
            stores={stores.filter((s) => s.client_id === client.id)}
            onChanged={invalidate}
          />
        ))
      )}
    </div>
  );
}

function ClientStoreGroup({
  clientId,
  clientName,
  stores,
  onChanged,
}: {
  clientId: string;
  clientName: string;
  stores: ManageableStore[];
  onChanged: () => void;
}) {
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [savedId, setSavedId] = React.useState<string | null>(null);
  const [showAddForm, setShowAddForm] = React.useState(false);

  const save = useMutation({
    mutationFn: ({ id, storeNumber }: { id: string; storeNumber: string }) => storesApi.updateStoreNumber(id, storeNumber),
    onSuccess: (store) => {
      onChanged();
      setSavedId(store.id);
      window.setTimeout(() => setSavedId((cur) => (cur === store.id ? null : cur)), 1500);
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{clientName}</h2>
        <Button size="sm" variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
          Add store
        </Button>
      </div>

      {stores.length === 0 && !showAddForm && (
        <Card className="p-4 text-sm text-[var(--muted-foreground)]">No stores yet.</Card>
      )}

      {stores.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                <th className="px-4 py-2 font-medium">Store</th>
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

      {showAddForm && (
        <AddStoreForm
          clientId={clientId}
          onDone={() => {
            setShowAddForm(false);
            onChanged();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}
    </div>
  );
}

function AddStoreForm({ clientId, onDone, onCancel }: { clientId: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = React.useState('');
  const [storeNumber, setStoreNumber] = React.useState('');
  const [line1, setLine1] = React.useState('');
  const [line2, setLine2] = React.useState('');
  const [city, setCity] = React.useState('');
  const [state, setState] = React.useState('');
  const [postcode, setPostcode] = React.useState('');
  const [country, setCountry] = React.useState('');

  const create = useMutation({
    mutationFn: () =>
      storesApi.create({
        client_id: clientId,
        name,
        store_number: storeNumber || undefined,
        cin7_address_line1: line1,
        cin7_address_line2: line2 || undefined,
        cin7_address_city: city || undefined,
        cin7_address_state: state || undefined,
        cin7_address_postcode: postcode || undefined,
        cin7_address_country: country || undefined,
      }),
    onSuccess: onDone,
  });

  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-medium">New store</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Store name*">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Store B - Uptown" />
        </Field>
        <Field label="Store number">
          <Input value={storeNumber} onChange={(e) => setStoreNumber(e.target.value)} placeholder="e.g. PR#346" />
        </Field>
        <Field label="Address line 1*">
          <Input value={line1} onChange={(e) => setLine1(e.target.value)} />
        </Field>
        <Field label="Address line 2">
          <Input value={line2} onChange={(e) => setLine2(e.target.value)} />
        </Field>
        <Field label="City">
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="State / region">
          <Input value={state} onChange={(e) => setState(e.target.value)} />
        </Field>
        <Field label="Postcode">
          <Input value={postcode} onChange={(e) => setPostcode(e.target.value)} />
        </Field>
        <Field label="Country">
          <Input value={country} onChange={(e) => setCountry(e.target.value)} />
        </Field>
      </div>

      {create.isError && <p className="mt-2 text-sm text-[var(--danger)]">{(create.error as Error).message}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => create.mutate()}
          disabled={create.isPending || !name.trim() || !line1.trim()}
        >
          {create.isPending ? <Spinner className="h-3.5 w-3.5 border-white/30 border-t-white" /> : 'Add store'}
        </Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-[var(--muted-foreground)]">
      {label}
      {children}
    </label>
  );
}
