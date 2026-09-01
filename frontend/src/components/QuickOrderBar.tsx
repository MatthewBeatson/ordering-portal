import * as React from 'react';
import { useCart } from '@/lib/CartContext';
import { tierPrice } from '@/lib/pricing';
import { money } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Product } from '@/lib/types';
import { Search, Plus, X } from 'lucide-react';

interface QuickOrderBarProps {
  // Full added_to_portal catalog, independent of the main table's
  // grouping/filter/search state -- quick-add always searches everything.
  products: Product[];
  clientSkuByProduct: Map<string, string>;
  // tierNumber stays real even when showPricing is false -- it's what
  // computes the unit_price attached to the cart line on add, which
  // still has to flow through to Cin7 regardless of what this client's
  // buyers can see. showPricing only gates the inline price shown in
  // the match list below.
  tierNumber: number | null;
  showPricing: boolean;
}

const MAX_MATCHES = 8;
const HINT_DISMISSED_KEY = 'shonrei-portal:quick-order-hint-dismissed';

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--border-strong)] bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[11px] font-medium">
      {children}
    </kbd>
  );
}

// Search (Tab commits the highlighted match, moves to Qty) -> Qty (Enter
// submits immediately; Tab moves to the Submit button for mouse/Enter-on-
// button users) -> adds to cart and resets, focus back on Search for the
// next item. Built for someone working off a phone/paper order list who
// wants to never touch the mouse.
export function QuickOrderBar({ products, clientSkuByProduct, tierNumber, showPricing }: QuickOrderBarProps) {
  const cart = useCart();
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<Product | null>(null);
  const [highlight, setHighlight] = React.useState(0);
  const [qty, setQty] = React.useState(1);
  const [justAdded, setJustAdded] = React.useState(false);
  const [showHint, setShowHint] = React.useState(() => {
    try {
      return localStorage.getItem(HINT_DISMISSED_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const searchRef = React.useRef<HTMLInputElement>(null);
  const qtyRef = React.useRef<HTMLInputElement>(null);

  function dismissHint() {
    setShowHint(false);
    try {
      localStorage.setItem(HINT_DISMISSED_KEY, '1');
    } catch {
      // localStorage unavailable (e.g. private browsing) -- fine to just
      // hide it for this session without persisting the dismissal.
    }
  }

  const matches = React.useMemo(() => {
    if (selected) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => {
        const clientSku = clientSkuByProduct.get(p.id) ?? '';
        return [p.sku, clientSku, p.name].join(' ').toLowerCase().includes(q);
      })
      .slice(0, MAX_MATCHES);
  }, [products, query, clientSkuByProduct, selected]);

  React.useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Cursor lands in the search box the moment the page loads, so a
  // well-versed buyer can start typing a SKU immediately with zero clicks.
  React.useEffect(() => {
    searchRef.current?.focus();
  }, []);

  function commitSelection(product: Product) {
    setSelected(product);
    setQuery(`${product.sku} — ${product.name}`);
    requestAnimationFrame(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    });
  }

  function reset() {
    setSelected(null);
    setQuery('');
    setQty(1);
    setHighlight(0);
  }

  function handleAdd() {
    if (!selected || qty < 1) return;
    const clientSku = clientSkuByProduct.get(selected.id);
    cart.addLine({
      sku: selected.sku,
      description: clientSku ? `${selected.name} (${clientSku})` : selected.name,
      quantity: qty,
      unit_price: tierPrice(selected, tierNumber) ?? undefined,
    });
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1000);
    reset();
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Tab') {
      if (!selected && matches.length > 0) {
        e.preventDefault();
        commitSelection(matches[highlight] ?? matches[0]);
      }
      // Already selected (or no matches): let Tab move focus normally.
    } else if (e.key === 'Enter') {
      if (!selected && matches.length > 0) {
        e.preventDefault();
        commitSelection(matches[highlight] ?? matches[0]);
      }
    } else if (e.key === 'Escape') {
      reset();
    }
  }

  function handleQtyKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    } else if (e.key === 'Escape') {
      reset();
      searchRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {showHint && (
        <div className="flex items-start justify-between gap-3 rounded-[var(--radius)] bg-[var(--accent-muted)] px-3 py-2 text-xs text-[var(--accent)]">
          <span className="leading-relaxed">
            <strong className="font-semibold">Quick order:</strong> type a SKU or name, press <Kbd>Tab</Kbd> to pick it, type
            a quantity, then <Kbd>Enter</Kbd> to add the line — the search box clears and refocuses so you can go straight
            into the next item.
          </span>
          <button
            onClick={dismissHint}
            aria-label="Dismiss"
            className="flex-shrink-0 rounded p-0.5 text-[var(--accent)] hover:bg-white/40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] p-2 shadow-sm">
        <Search className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />

        <div className="relative flex-1">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (selected) setSelected(null);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Quick add — type a SKU or name, Tab to pick..."
            className="h-8 w-full border-none bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
          />
          {matches.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] shadow-lg">
              {matches.map((p, i) => (
                <li
                  key={p.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commitSelection(p);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm ${i === highlight ? 'bg-[var(--accent-muted)]' : ''}`}
                >
                  <span>
                    <span className="font-mono text-xs text-[var(--muted-foreground)]">{p.sku}</span> {p.name}
                  </span>
                  {tierNumber && showPricing && (
                    <span className="tabular-nums text-[var(--muted-foreground)]">{money(tierPrice(p, tierNumber))}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Input
          ref={qtyRef}
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          onKeyDown={handleQtyKeyDown}
          disabled={!selected}
          className="h-8 w-16 flex-shrink-0 px-2"
        />

        <Button size="sm" variant={justAdded ? 'primary' : 'secondary'} onClick={handleAdd} disabled={!selected} className="flex-shrink-0">
          <Plus className="h-3.5 w-3.5" />
          {justAdded ? 'Added' : 'Add'}
        </Button>
      </div>
    </div>
  );
}
