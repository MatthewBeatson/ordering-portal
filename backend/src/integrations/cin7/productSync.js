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
// No grouping/filter axis is Cin7-sourced any more. Category used to
// sync into display_systems, but as of 028_display_systems_many_to_many
// that's portal-native too (product_display_systems, many-to-many) --
// same reasoning as product_type/jewellery_type/colour (023): staff
// manage the reference table (name + display_order) and assign it per
// product directly in the portal. This sync deliberately never touches
// product_type_id/jewellery_type_id/colour_id, jewellery_count, or a
// product's display systems -- omitting a key from the upsert payload
// leaves whatever staff have set untouched, so re-running a Cin7 sync
// can never silently overwrite portal-native classification. The raw
// `category` text column IS still synced (kept for reference/search --
// see ProductCuration.tsx's "Category" column) -- only the FK-based
// display_system_id/product_display_systems link has been retired.

const { supabaseAdmin } = require('../../config/supabase');
const cin7 = require('./client');

const PAGE_SIZE = 250;

function mapProduct(p) {
  return {
    cin7_product_id: p.ID,
    sku: p.SKU,
    name: p.Name,
    description: p.Description || p.ShortDescription || null,
    category: p.Category || null,
    brand: p.Brand || null,
    // product_type_id/jewellery_type_id/colour_id/jewellery_count and
    // display systems (a separate join table now) deliberately
    // omitted -- see the header comment. An omitted key leaves the
    // existing DB value untouched on this upsert, rather than nulling
    // it out.
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
      const row = mapProduct(p);

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
