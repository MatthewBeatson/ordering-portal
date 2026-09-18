import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

export interface SearchComboboxOption {
  id: string;
  label: string;
}

// Shared search-as-you-type select, used anywhere a plain <select>
// would otherwise force scrolling through a long native list (store
// numbers, Cin7-synced addresses -- both can run into the hundreds).
// The top match is always pre-selected (highlighted) as you type, and
// Enter commits whichever row is highlighted -- for a query specific
// enough to only ever match one real thing (e.g. a 3-digit store
// number), that's a single type-then-Enter. Up/Down (or hovering) moves
// the highlight when the top result isn't the one wanted.
//
// `query` starts as `initialQuery` (e.g. the currently selected
// option's own label, so it reads like a normal select showing
// today's value) and resyncs whenever `initialQuery` changes from
// outside (the selection changed elsewhere) -- pass '' for a control
// that must always start blank with no sensible default (e.g. "which
// store is this order for", 2026-09-09).
export function SearchCombobox({
  options,
  onSelect,
  initialQuery = '',
  placeholder,
  maxResults = 8,
  disabled = false,
  clearAfterSelect = false,
  inputRef,
}: {
  options: SearchComboboxOption[];
  onSelect: (option: SearchComboboxOption) => void;
  initialQuery?: string;
  placeholder: string;
  maxResults?: number;
  disabled?: boolean;
  // For a picker that's never meant to display "today's value" as text
  // (e.g. Cart's "Ordering for" switcher, 2026-09-15) -- every commit
  // snaps straight back to the empty placeholder instead of showing the
  // option just picked, so the box always reads as "search again", not
  // "here's what's selected". Pair with initialQuery="" (the caller's
  // own selection state lives elsewhere, this box never reflects it).
  clearAfterSelect?: boolean;
  // Lets a caller focus the box programmatically (e.g. Cart's admin
  // quick-submit returning focus here for the next order).
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = React.useState(initialQuery);
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  React.useEffect(() => setQuery(initialQuery), [initialQuery]);

  // Tracks whether `query` currently reflects a real committed
  // selection (true, including right after initialQuery syncs in from
  // outside) vs. mid-edit free typing (false). Lets onBlur tell the two
  // apart: leaving the field after typing/clearing without picking a
  // match should snap back to whatever's actually selected -- e.g. the
  // "Use client default" placeholder once a store's ship-to address is
  // cleared -- rather than stranding the field on whatever partial text
  // was left in it.
  const committedRef = React.useRef(true);

  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, maxResults) : [];
  // The pre-selected row. Reset to the top match on every keystroke
  // (onChange), clamped so a shrinking result list can't leave it dangling.
  const active = Math.min(highlight, Math.max(matches.length - 1, 0));
  const activeItemRef = React.useRef<HTMLLIElement>(null);
  React.useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active, matches.length]);

  function commit(option: SearchComboboxOption) {
    committedRef.current = true;
    onSelect(option);
    setQuery(clearAfterSelect ? '' : option.label);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight(Math.min(active + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(Math.max(active - 1, 0));
    } else if (e.key === 'Enter' && matches.length > 0) {
      e.preventDefault();
      commit(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            committedRef.current = false;
            setQuery(e.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          // A single click always selects everything, including when the
          // box is already focused (no focus event then) -- so with a
          // store already showing, one click then typing replaces it.
          onClick={(e) => e.currentTarget.select()}
          // Select the pre-filled text on focus so a single click, then
          // typing, replaces it outright -- no need to clear the
          // existing value by hand first before starting a new search.
          // Deferred one frame: setOpen(true) below causes a re-render
          // that reassigns this controlled input's value DOM property
          // (even to the same string) on commit, which resets the
          // selection right back to collapsed if select() runs first.
          onFocus={(e) => {
            setOpen(true);
            const el = e.target;
            requestAnimationFrame(() => el.select());
          }}
          onBlur={() =>
            window.setTimeout(() => {
              setOpen(false);
              if (!committedRef.current) {
                setQuery(initialQuery);
                committedRef.current = true;
              }
            }, 150)
          }
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={open && !!q}
          aria-autocomplete="list"
          placeholder={placeholder}
          disabled={disabled}
          className="h-9 pl-8"
        />
      </div>
      {open && q && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] shadow-lg">
          {matches.length === 0 && <li className="px-3 py-2 text-xs text-[var(--muted-foreground)]">No matches.</li>}
          {matches.map((m, i) => (
            <li key={m.id} ref={i === active ? activeItemRef : undefined} role="option" aria-selected={i === active}>
              <button
                type="button"
                // onMouseDown (not onClick) fires before the input's onBlur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(m);
                }}
                // onMouseMove, not onMouseEnter: a list that scrolls or
                // appears under a stationary cursor must not steal the
                // pre-selected top result.
                onMouseMove={() => i !== active && setHighlight(i)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${i === active ? 'bg-[var(--accent-muted)]' : ''}`}
              >
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
