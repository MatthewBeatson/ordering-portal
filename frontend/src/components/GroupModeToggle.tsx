import type { GroupMode } from '@/lib/groupProducts';

// Shared "By display system" / "By product type" pill toggle --
// extracted from Catalog.tsx so Cart and OrderDetail can offer the
// same grouping switch.
export function GroupModeToggle({ value, onChange }: { value: GroupMode; onChange: (mode: GroupMode) => void }) {
  return (
    <div className="flex overflow-hidden rounded-[var(--radius)] border border-[var(--border-strong)]">
      <button
        onClick={() => onChange('display')}
        className={`px-3 py-1.5 text-sm font-medium ${value === 'display' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] hover:bg-[var(--muted)]'}`}
      >
        By display system
      </button>
      <button
        onClick={() => onChange('type')}
        className={`border-l border-[var(--border-strong)] px-3 py-1.5 text-sm font-medium ${value === 'type' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] hover:bg-[var(--muted)]'}`}
      >
        By product type
      </button>
    </div>
  );
}
