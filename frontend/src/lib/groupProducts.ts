// Shared "By display system" / "By product type" grouping logic,
// extracted from Catalog.tsx so Cart and OrderDetail can render their
// line items the same way -- byte-identical grouping/sort behavior,
// parameterized by accessor functions instead of hardcoded fields so
// it works for both a ProductRow (Catalog) and a resolved cart/order
// line (Cart/OrderDetail, via useResolvedLines).

export type GroupMode = 'type' | 'display' | 'custom';

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

// tray_product_id -> ordered insert_product_ids (custom_group_rules,
// 030), as built by useCustomGroupRules.ts.
export type CustomRules = Map<string, string[]>;

export interface CustomGroupOptions<T> {
  // A row's own product id -- Catalog rows carry it directly (p.id);
  // Cart/Order Detail lines don't (no product_id on order_lines, see
  // useResolvedLines.ts's own note on this), so those callers resolve
  // it via their sku->product map instead.
  getId: (row: T) => string | undefined;
  getLabel: (row: T) => string;
  rules: CustomRules;
}

// Staff-defined tray -> ordered-inserts pairs (030), not a facet at
// all -- unlike the other two modes, most products AREN'T part of any
// rule, so this mode is "pull the specifically-linked pairs out front,
// everything else falls to Ungrouped" rather than a true partition of
// every row. A tray absent from the current row set (filtered out by
// search, not curated for this client, not on this order) means its
// whole rule is skipped this pass -- its inserts fall to Ungrouped too,
// rather than showing under a tray that isn't actually visible here.
function groupCustom<T>(rows: T[], { getId, getLabel, rules }: CustomGroupOptions<T>): Group<T>[] {
  const rowByProductId = new Map<string, T>();
  for (const row of rows) {
    const id = getId(row);
    if (id) rowByProductId.set(id, row);
  }

  const consumed = new Set<string>();
  const groups: Group<T>[] = [];
  let order = 0;

  for (const [trayId, insertIds] of rules) {
    const trayRow = rowByProductId.get(trayId);
    if (!trayRow) continue;
    const groupRows: T[] = [trayRow];
    consumed.add(trayId);
    for (const insertId of insertIds) {
      const insertRow = rowByProductId.get(insertId);
      if (!insertRow) continue;
      groupRows.push(insertRow);
      consumed.add(insertId);
    }
    groups.push({
      key: trayId,
      label: getLabel(trayRow),
      order: order++,
      subgroups: [{ key: 'items', label: null, rows: groupRows }],
    });
  }

  const leftover = rows.filter((row) => {
    const id = getId(row);
    return !id || !consumed.has(id);
  });
  if (leftover.length > 0) {
    groups.push({ key: '__none', label: 'Ungrouped', order: 9999, subgroups: [{ key: 'flat', label: null, rows: leftover }] });
  }

  return groups;
}

// Two-level grouping for "by display system": display system -> product
// type (a row with multiple display systems appears once per system it
// belongs to). For "by product type": a single level, product type only.
// For "custom": see groupCustom above -- `custom` is required in that
// mode (callers pass it unconditionally; it's simply unused otherwise).
export function groupProducts<T>(
  rows: T[],
  mode: GroupMode,
  getDisplaySystems: (row: T) => GroupRef[],
  getProductType: (row: T) => GroupRef,
  custom?: CustomGroupOptions<T>
): Group<T>[] {
  if (mode === 'custom') {
    if (!custom) return [{ key: '__none', label: 'Ungrouped', order: 0, subgroups: [{ key: 'flat', label: null, rows }] }];
    return groupCustom(rows, custom);
  }

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
