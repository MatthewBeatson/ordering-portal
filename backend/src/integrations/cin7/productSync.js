// Mirrors every product from Cin7 into our own `products` table.
// Deliberately syncs everything, not a curated subset -- curation
// happens afterward via products.added_to_portal (011), set by staff
// through the add-to-portal endpoints in services/products.js, not by
// this job. That keeps "what exists" (Cin7's problem) separate from
// "what's shown on the portal" (Shonrei's problem).
//
// Field names (ID, SKU, Name, Category, Description/ShortDescription,
// PriceTier1..10) are taken from a real GET /Product response captured
// against the trial account during earlier testing, not guessed.

const { supabaseAdmin } = require('../../config/supabase');
const cin7 = require('./client');

const PAGE_SIZE = 250;

// display_systems.cin7_category_value is the sync anchor -- upserts a
// row the first time a given Cin7 category is seen, reuses it after.
// `name` is seeded from the raw Cin7 value but is staff-editable
// afterward if it isn't already display-ready.
async function resolveDisplaySystemId(cin7CategoryValue, cache) {
  if (!cin7CategoryValue) return null;
  if (cache.has(cin7CategoryValue)) return cache.get(cin7CategoryValue);

  const { data: existing, error: selectErr } = await supabaseAdmin
    .from('display_systems')
    .select('id')
    .eq('cin7_category_value', cin7CategoryValue)
    .maybeSingle();
  if (selectErr) {
    console.error(`[cin7 productSync] failed to look up display_system for category "${cin7CategoryValue}":`, selectErr.message);
    cache.set(cin7CategoryValue, null);
    return null;
  }
  if (existing) {
    cache.set(cin7CategoryValue, existing.id);
    return existing.id;
  }

  const { data: created, error: insertErr } = await supabaseAdmin
    .from('display_systems')
    .insert({ name: cin7CategoryValue, cin7_category_value: cin7CategoryValue })
    .select('id')
    .single();
  if (insertErr) {
    console.error(`[cin7 productSync] failed to create display_system for category "${cin7CategoryValue}":`, insertErr.message);
    cache.set(cin7CategoryValue, null);
    return null;
  }
  cache.set(cin7CategoryValue, created.id);
  return created.id;
}

function mapProduct(p, displaySystemId) {
  return {
    cin7_product_id: p.ID,
    sku: p.SKU,
    name: p.Name,
    description: p.Description || p.ShortDescription || null,
    category: p.Category || null,
    brand: p.Brand || null,
    display_system_id: displaySystemId,
    price_tier_1: p.PriceTier1 ?? null,
    price_tier_2: p.PriceTier2 ?? null,
    price_tier_3: p.PriceTier3 ?? null,
    price_tier_4: p.PriceTier4 ?? null,
    price_tier_5: p.PriceTier5 ?? null,
    price_tier_6: p.PriceTier6 ?? null,
    price_tier_7: p.PriceTier7 ?? null,
    price_tier_8: p.PriceTier8 ?? null,
    price_tier_9: p.PriceTier9 ?? null,
    price_tier_10: p.PriceTier10 ?? null,
    last_synced_at: new Date().toISOString(),
  };
}

// Full mirror sync: every Cin7 product gets upserted (matched on
// cin7_product_id). Returns a summary rather than throwing on a
// per-product failure -- one bad row shouldn't abort the whole sync.
async function syncProducts() {
  if (!cin7.isConfigured()) {
    throw new Error('CIN7_ACCOUNT_ID / CIN7_APPLICATION_KEY are not configured');
  }

  const displaySystemCache = new Map();
  let page = 1;
  let total = Infinity;
  let synced = 0;
  let failed = 0;
  const errors = [];

  while ((page - 1) * PAGE_SIZE < total) {
    const res = await cin7.fetchProductsPage(page, PAGE_SIZE);
    if (!res.ok) {
      throw new Error(`Cin7 product fetch failed: ${cin7.cin7ErrorMessage(res)}`);
    }
    total = res.body.Total ?? 0;
    const products = res.body.Products ?? [];

    for (const p of products) {
      const displaySystemId = await resolveDisplaySystemId(p.Category, displaySystemCache);
      const row = mapProduct(p, displaySystemId);

      const { error } = await supabaseAdmin.from('products').upsert(row, { onConflict: 'cin7_product_id' });
      if (error) {
        failed++;
        errors.push({ sku: p.SKU, error: error.message });
        console.error(`[cin7 productSync] failed to upsert SKU ${p.SKU}:`, error.message);
      } else {
        synced++;
      }
    }

    page++;
  }

  console.log(`[cin7 productSync] done: ${synced} synced, ${failed} failed, ${total} total in Cin7`);
  return { synced, failed, total, errors: errors.slice(0, 20) };
}

module.exports = { syncProducts };
