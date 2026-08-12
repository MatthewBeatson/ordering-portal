import type { Product } from './types';

// clients.cin7_price_tier is free text mirroring Cin7's own tier naming
// (e.g. "Tier 2", "2", "Price Tier 2") -- pull the first number out of it
// rather than assuming an exact format.
export function parseTierNumber(tierText: string | null | undefined): number | null {
  if (!tierText) return null;
  const match = tierText.match(/\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return n >= 1 && n <= 10 ? n : null;
}

const TIER_KEYS = [
  'price_tier_1',
  'price_tier_2',
  'price_tier_3',
  'price_tier_4',
  'price_tier_5',
  'price_tier_6',
  'price_tier_7',
  'price_tier_8',
  'price_tier_9',
  'price_tier_10',
] as const;

// Returns the unit price for this product at the client's price tier.
// This is what gets sent to the backend as order_lines.unit_price -- the
// backend/Cin7 sync uses that value as-is (see backend/src/integrations/
// cin7/lines.js), it never re-derives price from the tier server-side.
export function tierPrice(product: Product, tierNumber: number | null): number | null {
  if (!tierNumber) return null;
  const key = TIER_KEYS[tierNumber - 1];
  return product[key];
}
