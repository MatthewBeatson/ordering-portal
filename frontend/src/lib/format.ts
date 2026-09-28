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

// Shared by Cart and Account's address selectors (both search over the
// same client_addresses shape) so the display text is identical
// everywhere an address gets listed.
// store_number (035) -- when an address is tagged with the store it
// physically belongs to, that number is prefixed onto every label
// built from this everywhere it's used (Cart's delivery-address
// search, Account's two address pickers), so searching e.g. "443"
// finds it -- not just searching its street/suburb text.
export function formatAddress(a: {
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  store_number?: string | null;
}) {
  const address = [a.line1, a.line2, a.city, a.state, a.postcode, a.country].filter(Boolean).join(', ');
  return a.store_number ? `${a.store_number} - ${address}` : address;
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
