// Mirrors every product from Cin7 into our own `products` table.
// Deliberately syncs everything, not a curated subset -- curation
// happens afterward per-client via client_portal_products (013), set by
// staff through the add-to-portal endpoints in services/products.js,
// not by this job. That keeps "what exists" (Cin7's problem) separate
// from "what's shown on which client's portal" (Shonrei's problem).
//
// Field names (ID, SKU, Name, Category, Description/ShortDescription,
// PriceTier1..10) are taken from a real GET /Product response captured
// against the trial account during earlier testing, not guessed.
//
// Only one grouping/filter axis is still Cin7-sourced:
//   - Category -> display_systems (cin7_category_value)
//
// product_type, jewellery_type ("what jewellery item the fixture
// holds -- Ring, Earring, Pendant...", 018), and colour (017) were
// previously synced from Cin7 Additional Attributes 1-3, but as of
// 023_portal_native_taxonomy.sql these are portal-native: staff manage
// them directly (name + display_order) via the admin taxonomy screen,
// and set them per product there. This sync deliberately never touches
// product_type_id/jewellery_type_id/colour_id -- omitting a key from
// the upsert payload leaves whatever staff have set untouched, so
// re-running a Cin7 sync can never silently overwrite portal-native
// classification.

const { supabaseAdmin } = require('../../config/supabase');
const cin7 = require('./client');

const PAGE_SIZE = 250;

// Resolve-or-create pattern, now only used for display_systems (the
// one remaining Cin7-sourced reference table, keyed off
// cin7_category_value). `name` is seeded from the raw Cin7 value but
// is staff-editable afterward if it isn't already display-ready -- the
// anchor column is what keeps the sync link stable across a rename.
async function resolveReferenceId(table, anchorColumn, cin7Value, cache) {
  if (!cin7Value) return null;
  if (cache.has(cin7Value)) return cache.get(cin7Value);

  const { data: existing, error: selectErr } = await supabaseAdmin.from(table).select('id').eq(anchorColumn, cin7Value).maybeSingle();
  if (selectErr) {
    console.error(`[cin7 productSync] failed to look up ${table} for "${cin7Value}":`, selectErr.message);
    cache.set(cin7Value, null);
    return null;
  }
  if (existing) {
    cache.set(cin7Value, existing.id);
    return existing.id;
  }

  const { data: created, error: insertErr } = await supabaseAdmin
    .from(table)
    .insert({ name: cin7Value, [anchorColumn]: cin7Value })
    .select('id')
    .single();
  if (insertErr) {
    console.error(`[cin7 productSync] failed to create ${table} for "${cin7Value}":`, insertErr.message);
    cache.set(cin7Value, null);
    return null;
  }
  cache.set(cin7Value, created.id);
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
    // product_type_id/jewellery_type_id/colour_id deliberately omitted
    // -- see the header comment. An omitted key leaves the existing DB
    // value untouched on this upsert, rather than nulling it out.
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
      const displaySystemId = await resolveReferenceId('display_systems', 'cin7_category_value', p.Category, displaySystemCache);
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
