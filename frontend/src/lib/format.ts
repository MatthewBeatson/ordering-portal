export function money(n: number | null | undefined) {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
