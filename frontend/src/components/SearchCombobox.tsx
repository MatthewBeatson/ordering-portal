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
// Enter commits the FIRST current match directly -- for a query
// specific enough to only ever match one real thing (e.g. a 3-digit
// store number), that's a single type-then-Enter with no need to
// arrow-key to a highlighted row first.
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
}: {
  options: SearchComboboxOption[];
  onSelect: (option: SearchComboboxOption) => void;
  initialQuery?: string;
  placeholder: string;
  maxResults?: number;
  disabled?: boolean;
}) {
  const [query, setQuery] = React.useState(initialQuery);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setQuery(initialQuery), [initialQuery]);

  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, maxResults) : [];

  function commit(option: SearchComboboxOption) {
    onSelect(option);
    setQuery(option.label);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && matches.length > 0) {
      e.preventDefault();
      commit(matches[0]);
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
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          // Select the pre-filled text on focus so a single click, then
          // typing, replaces it outright -- no need to clear the
          // existing value by hand first before starting a new search.
          onFocus={(e) => {
            setOpen(true);
            e.target.select();
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="h-9 pl-8"
        />
      </div>
      {open && q && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--card)] shadow-lg">
          {matches.length === 0 && <li className="px-3 py-2 text-xs text-[var(--muted-foreground)]">No matches.</li>}
          {matches.map((m) => (
            <li key={m.id}>
              <button
                // onMouseDown (not onClick) fires before the input's onBlur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(m);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--accent-muted)]"
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
