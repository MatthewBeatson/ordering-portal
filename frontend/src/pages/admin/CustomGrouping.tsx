import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { customGroupRulesApi } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ArrowUp, ArrowDown, X, Plus, Search } from 'lucide-react';

// Staff-managed rules behind Catalog/Cart/Order Detail's "Custom"
// grouping mode (030) -- pairs a tray/base product with the specific
// insert products that always show directly under it, e.g. tray
// MT20012EBUSS -> its M150... inserts, in a fixed order. Global (not
// per-client), same as the other taxonomy screens. A product not
// covered by any rule here just falls to "Ungrouped" in that view.

type ProductRef = { id: string; sku: string; name: string };

function ProductPicker({
  placeholder,
  exclude,
  onPick,
}: {
  placeholder: string;
  exclude: Set<string>;
  onPick: (product: ProductRef) => void;
}) {
  const [query, setQuery] = React.useState('');
  const { data: matches, isFetching } = useQuery({
    queryKey: ['custom-group-rules-product-search', query],
    queryFn: async () => {
      const q = query.trim();
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name')
        .or(`sku.ilike.%${q}%,name.ilike.%${q}%`)
        .order('name')
        .limit(10);
      if (error) throw error;
      return data as ProductRef[];
    },
    enabled: query.trim().length > 1,
  });
  const visibleMatches = (matches ?? []).filter((p) => !exclude.has(p.id));

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-8 pl-8 text-sm"
        />
      </div>
      {query.trim().length > 1 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] shadow-lg">
          {isFetching && (
            <li className="flex justify-center px-3 py-2">
              <Spinner className="h-4 w-4" />
            </li>
          )}
          {!isFetching && visibleMatches.length === 0 && (
            <li className="px-3 py-2 text-xs text-[var(--muted-foreground)]">No matches.</li>
          )}
          {visibleMatches.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onPick(p);
                  setQuery('');
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--accent-muted)]"
              >
                <span className="font-mono text-xs text-[var(--muted-foreground)]">{p.sku}</span>
                <span className="truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A tray currently being created/edited -- local, unsaved insert order
// until "Save" commits it via setForTray (full replace).
interface EditingRule {
  tray: ProductRef;
  inserts: ProductRef[];
}

export default function CustomGrouping() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState<EditingRule | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ['custom-group-rules-admin'],
    queryFn: () => customGroupRulesApi.list(),
  });

  const rulesByTray = React.useMemo(() => {
    const map = new Map<string, { tray: ProductRef; inserts: ProductRef[] }>();
    for (const row of rows ?? []) {
      if (!map.has(row.tray_product_id)) map.set(row.tray_product_id, { tray: row.tray, inserts: [] });
      map.get(row.tray_product_id)!.inserts.push(row.insert);
    }
    return [...map.values()].sort((a, b) => a.tray.name.localeCompare(b.tray.name));
  }, [rows]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['custom-group-rules-admin'] });

  const save = useMutation({
    mutationFn: (rule: EditingRule) => customGroupRulesApi.setForTray(rule.tray.id, rule.inserts.map((i) => i.id)),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const removeRule = useMutation({
    mutationFn: (trayProductId: string) => customGroupRulesApi.removeTray(trayProductId),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  function startNew(tray: ProductRef) {
    setEditing({ tray, inserts: [] });
  }

  function startEdit(rule: { tray: ProductRef; inserts: ProductRef[] }) {
    setEditing({ tray: rule.tray, inserts: [...rule.inserts] });
  }

  function moveInsert(index: number, dir: -1 | 1) {
    if (!editing) return;
    const next = [...editing.inserts];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setEditing({ ...editing, inserts: next });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Custom grouping</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Define fixed tray/base -&gt; insert pairings for the "Custom" view on Catalog, Cart, and Order Detail -- e.g. a
          specific tray always shows its specific inserts listed directly underneath, regardless of display system or
          product type. A product not part of any rule below just falls into "Ungrouped" in that view.
        </p>
      </div>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      {!editing && (
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">Start a new rule</div>
          <div className="max-w-md">
            <ProductPicker placeholder="Search for the tray/base product..." exclude={new Set()} onPick={startNew} />
          </div>
        </Card>
      )}

      {editing && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs text-[var(--muted-foreground)]">Tray / base</div>
              <div className="text-sm font-semibold">
                <span className="font-mono text-xs text-[var(--muted-foreground)]">{editing.tray.sku}</span> {editing.tray.name}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>

          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Inserts shown under this tray, in order
          </div>
          {editing.inserts.length === 0 && (
            <p className="mb-2 text-sm text-[var(--muted-foreground)]">No inserts added yet.</p>
          )}
          <ul className="mb-3 flex flex-col gap-1">
            {editing.inserts.map((insert, i) => (
              <li key={insert.id} className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-2 py-1.5">
                <span className="font-mono text-xs text-[var(--muted-foreground)]">{insert.sku}</span>
                <span className="flex-1 truncate text-sm">{insert.name}</span>
                <button onClick={() => moveInsert(i, -1)} disabled={i === 0} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveInsert(i, 1)}
                  disabled={i === editing.inserts.length - 1}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setEditing({ ...editing, inserts: editing.inserts.filter((x) => x.id !== insert.id) })}
                  className="text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <div className="max-w-md">
            <ProductPicker
              placeholder="Search to add an insert..."
              exclude={new Set([editing.tray.id, ...editing.inserts.map((i) => i.id)])}
              onPick={(p) => setEditing({ ...editing, inserts: [...editing.inserts, p] })}
            />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" onClick={() => save.mutate(editing)} disabled={save.isPending}>
              {save.isPending ? <Spinner className="h-3.5 w-3.5 border-white/30 border-t-white" /> : <Plus className="h-3.5 w-3.5" />}
              Save rule
            </Button>
            {rulesByTray.some((r) => r.tray.id === editing.tray.id) && (
              <Button
                variant="ghost"
                onClick={() => removeRule.mutate(editing.tray.id)}
                disabled={removeRule.isPending}
                className="text-[var(--danger)]"
              >
                Remove this rule entirely
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-sm font-semibold">Existing rules</div>
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner className="h-5 w-5" />
          </div>
        ) : rulesByTray.length === 0 ? (
          <p className="px-4 py-3 text-sm text-[var(--muted-foreground)]">No custom grouping rules yet -- add one above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                <th className="px-4 py-2 font-medium">Tray / base</th>
                <th className="px-4 py-2 font-medium">Inserts</th>
                <th className="w-24 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rulesByTray.map((rule) => (
                <tr key={rule.tray.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs text-[var(--muted-foreground)]">{rule.tray.sku}</span> {rule.tray.name}
                  </td>
                  <td className="px-4 py-2 text-[var(--muted-foreground)]">{rule.inserts.length} insert(s)</td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => startEdit(rule)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
