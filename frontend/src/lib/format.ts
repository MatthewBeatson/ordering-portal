// Display symbol per client currency (clients.currency, 029) -- $ stays
// the default so every existing NZD/AUD client is unaffected; anything
// unmapped falls back to the code itself (e.g. "USD 12.00") rather than
// silently showing the wrong symbol.
const CURRENCY_SYMBOLS: Record<string, string> = {
  NZD: '$',
  AUD: '$',
  USD: '$',
  GBP: '£',
};

export function money(n: number | null | undefined, currency: string = 'NZD') {
  if (n == null) return '—';
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${n.toFixed(2)}`;
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
