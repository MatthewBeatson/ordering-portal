import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productTaxonomyApi, type TaxonomyKind, type TaxonomyRow } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Plus, Trash2 } from 'lucide-react';

// Staff-managed CRUD for the three portal-native taxonomy tables (023)
// -- product type, jewellery held, colour. This is what makes
// display_order real: staff set it here to sequence e.g.
// Plinth/Base -> Tray -> Insert, which Catalog/Cart/Order Detail's "By
// display system" grouping sorts by.
const SECTIONS: { kind: TaxonomyKind; label: string; hint: string }[] = [
  { kind: 'types', label: 'Product type', hint: 'e.g. Base, Tray, Insert -- set display_order to control grouping sequence.' },
  { kind: 'jewellery-types', label: 'Jewellery held', hint: 'What jewellery item the fixture holds -- Ring, Earring, Pendant...' },
  { kind: 'colours', label: 'Colour', hint: 'e.g. Black, Navy, White.' },
];

export default function ProductTaxonomy() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Product taxonomy</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Manage product type, jewellery held, and colour -- portal-native (not synced from Cin7). display_order controls
          both this list's order and the grouping/sort order shown to buyers.
        </p>
      </div>

      {SECTIONS.map((section) => (
        <TaxonomySection key={section.kind} {...section} />
      ))}
    </div>
  );
}

function TaxonomySection({ kind, label, hint }: { kind: TaxonomyKind; label: string; hint: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['product-taxonomy', kind];
  const [error, setError] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState('');

  const { data: rows, isLoading } = useQuery({
    queryKey,
    queryFn: () => productTaxonomyApi.list(kind),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const create = useMutation({
    mutationFn: (name: string) => productTaxonomyApi.create(kind, { name, display_order: rows?.length ?? 0 }),
    onSuccess: () => {
      setNewName('');
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; display_order?: number } }) =>
      productTaxonomyApi.update(kind, id, input),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => productTaxonomyApi.remove(kind, id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--border)] bg-[var(--muted)] px-4 py-2">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-[var(--muted-foreground)]">{hint}</div>
      </div>

      {error && <p className="px-4 pt-2 text-sm text-[var(--danger)]">{error}</p>}

      {isLoading ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="w-32 px-2 py-2 font-medium">Display order</th>
              <th className="w-10 px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <TaxonomyRowEditor
                key={row.id}
                row={row}
                onRename={(name) => update.mutate({ id: row.id, input: { name } })}
                onReorder={(display_order) => update.mutate({ id: row.id, input: { display_order } })}
                onDelete={() => {
                  if (window.confirm(`Delete "${row.name}"? This can't be undone.`)) remove.mutate(row.id);
                }}
                deleting={remove.isPending && remove.variables === row.id}
              />
            ))}
            <tr>
              <td className="px-4 py-2">
                <Input
                  placeholder={`New ${label.toLowerCase()}...`}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim()) create.mutate(newName.trim());
                  }}
                  className="h-8"
                />
              </td>
              <td className="px-2 py-2 text-xs text-[var(--muted-foreground)]">{rows?.length ?? 0}</td>
              <td className="px-4 py-2 text-right">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!newName.trim() || create.isPending}
                  onClick={() => create.mutate(newName.trim())}
                >
                  {create.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  Add
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {rows && rows.length === 0 && !isLoading && (
        <p className="px-4 pb-3 text-xs text-[var(--muted-foreground)]">Nothing here yet -- add the first one above.</p>
      )}
    </Card>
  );
}

function TaxonomyRowEditor({
  row,
  onRename,
  onReorder,
  onDelete,
  deleting,
}: {
  row: TaxonomyRow;
  onRename: (name: string) => void;
  onReorder: (order: number) => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [name, setName] = React.useState(row.name);
  const [order, setOrder] = React.useState(row.display_order);

  React.useEffect(() => setName(row.name), [row.name]);
  React.useEffect(() => setOrder(row.display_order), [row.display_order]);

  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className="px-4 py-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== row.name && onRename(name.trim())}
          className="h-8"
        />
      </td>
      <td className="px-2 py-2">
        <Input
          type="number"
          value={order}
          onChange={(e) => setOrder(Number(e.target.value) || 0)}
          onBlur={() => order !== row.display_order && onReorder(order)}
          className="h-8 w-24"
        />
      </td>
      <td className="px-4 py-2 text-right">
        <button
          onClick={onDelete}
          disabled={deleting}
          className="text-[var(--muted-foreground)] hover:text-[var(--danger)] disabled:opacity-50"
          title="Delete"
        >
          {deleting ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </td>
    </tr>
  );
}
