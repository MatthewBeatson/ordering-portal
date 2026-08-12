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
// Four grouping/filter axes, all sourced from Cin7, all resolved into
// their own Supabase reference table rather than stored as raw text:
//   - Category            -> display_systems (cin7_category_value)
//   - AdditionalAttribute1 -> product_types (016)
//   - AdditionalAttribute2 -> product_jewellery_types (018) -- what
//     jewellery item the fixture holds (Ring, Earring, Pendant...)
//   - AdditionalAttribute3 -> product_colours (017)
// AdditionalAttribute1-3 are List-type custom fields staff configure
// in Cin7 themselves. Cin7's own docs note these are silently empty on
// Small/Medium subscription plans or without an AttributeSet assigned
// to the product -- not something this code can detect or work around,
// just something to be aware of if a dimension stays empty after a
// sync.

const { supabaseAdmin } = require('../../config/supabase');
const cin7 = require('./client');

const PAGE_SIZE = 250;

// Shared resolve-or-create pattern for every Cin7-sourced reference
// table: display_systems keys off cin7_category_value (Category has
// its own field name), the other three key off cin7_attribute_value.
// `name` is seeded from the raw Cin7 value but is staff-editable
// afterward if it isn't already display-ready -- the anchor column is
// what keeps the sync link stable across a rename.
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

function mapProduct(p, displaySystemId, productTypeId, jewelleryTypeId, colourId) {
  return {
    cin7_product_id: p.ID,
    sku: p.SKU,
    name: p.Name,
    description: p.Description || p.ShortDescription || null,
    category: p.Category || null,
    brand: p.Brand || null,
    display_system_id: displaySystemId,
    product_type_id: productTypeId,
    jewellery_type_id: jewelleryTypeId,
    colour_id: colourId,
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
  const productTypeCache = new Map();
  const jewelleryTypeCache = new Map();
  const colourCache = new Map();
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
      const productTypeId = await resolveReferenceId('product_types', 'cin7_attribute_value', p.AdditionalAttribute1, productTypeCache);
      const jewelleryTypeId = await resolveReferenceId(
        'product_jewellery_types',
        'cin7_attribute_value',
        p.AdditionalAttribute2,
        jewelleryTypeCache
      );
      const colourId = await resolveReferenceId('product_colours', 'cin7_attribute_value', p.AdditionalAttribute3, colourCache);
      const row = mapProduct(p, displaySystemId, productTypeId, jewelleryTypeId, colourId);

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
