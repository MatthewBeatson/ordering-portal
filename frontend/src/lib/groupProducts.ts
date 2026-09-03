// Shared "By display system" / "By product type" grouping logic,
// extracted from Catalog.tsx so Cart and OrderDetail can render their
// line items the same way -- byte-identical grouping/sort behavior,
// parameterized by accessor functions instead of hardcoded fields so
// it works for both a ProductRow (Catalog) and a resolved cart/order
// line (Cart/OrderDetail, via useResolvedLines).

export type GroupMode = 'type' | 'display';

export type GroupRef = { id: string; name: string; display_order: number } | null | undefined;

export interface Subgroup<T> {
  key: string;
  label: string | null;
  rows: T[];
}

export interface Group<T> {
  key: string;
  label: string;
  order: number;
  subgroups: Subgroup<T>[];
}

function bucket<T>(rows: T[], getRef: (row: T) => GroupRef) {
  const map = new Map<string, { label: string; order: number; rows: T[] }>();
  for (const row of rows) {
    const ref = getRef(row);
    const key = ref?.id ?? '__none';
    if (!map.has(key)) {
      map.set(key, { label: ref?.name ?? 'Ungrouped', order: ref?.display_order ?? 9999, rows: [] });
    }
    map.get(key)!.rows.push(row);
  }
  return [...map.entries()].sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label));
}

// Like bucket(), but a row can belong to several groups at once (028 --
// a product can be in more than one display system) -- a row with N
// systems appears in N groups; a row with zero falls into '__none'
// once, same convention as every other empty-facet case.
function bucketMulti<T>(rows: T[], getRefs: (row: T) => GroupRef[]) {
  const map = new Map<string, { label: string; order: number; rows: T[] }>();
  for (const row of rows) {
    const refs = getRefs(row);
    if (refs.length === 0) {
      if (!map.has('__none')) map.set('__none', { label: 'Ungrouped', order: 9999, rows: [] });
      map.get('__none')!.rows.push(row);
      continue;
    }
    for (const ref of refs) {
      const key = ref?.id ?? '__none';
      if (!map.has(key)) {
        map.set(key, { label: ref?.name ?? 'Ungrouped', order: ref?.display_order ?? 9999, rows: [] });
      }
      map.get(key)!.rows.push(row);
    }
  }
  return [...map.entries()].sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label));
}

// Two-level grouping for "by display system": display system -> product
// type (a row with multiple display systems appears once per system it
// belongs to). For "by product type": a single level, product type only.
export function groupProducts<T>(
  rows: T[],
  mode: GroupMode,
  getDisplaySystems: (row: T) => GroupRef[],
  getProductType: (row: T) => GroupRef
): Group<T>[] {
  if (mode === 'type') {
    return bucket(rows, getProductType).map(([key, g]) => ({
      key,
      label: g.label,
      order: g.order,
      subgroups: [{ key: 'flat', label: null, rows: g.rows }],
    }));
  }

  return bucketMulti(rows, getDisplaySystems).map(([key, g]) => ({
    key,
    label: g.label,
    order: g.order,
    subgroups: bucket(g.rows, getProductType).map(([tKey, t]) => ({ key: tKey, label: t.label, rows: t.rows })),
  }));
}
