// Backfills client_product_skus by pulling a client's own SKU straight
// out of the product NAME, for clients whose real-world SKU has been
// getting hand-typed into Cin7's Name/Description field instead of
// living in the portal (see client_product_skus' own migration comment
// for why that field can't hold it directly -- Cin7 has no per-customer
// product field at all).
//
// Matches a 7-digit run starting with 927 (e.g. "Blue Tray 200 x 240mm
// - 9271173" -> "9271173") anywhere in the product's name. Only ever
// touches products actually curated onto this client's portal
// (client_portal_products), skips a product that already has a
// client_product_skus row (never overwrites a value someone already
// set/edited by hand), and skips a product whose name has no such
// pattern -- both counted and reported, not silently dropped.
//
// Rerunnable: safe to run again later and it will only pick up
// products curated/named since the last run -- nothing already done
// gets touched.
//
// Usage:
//   node scripts/backfill-client-skus-from-name.js "JPL - AU"
//   node scripts/backfill-client-skus-from-name.js "JPL - AU" --dry-run

require('dotenv').config();
const { supabaseAdmin } = require('../src/config/supabase');

const SKU_PATTERN = /\b(927\d{4})\b/;

async function main() {
  const clientName = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!clientName) {
    console.error('Usage: node scripts/backfill-client-skus-from-name.js "<client name>" [--dry-run]');
    process.exit(1);
  }

  const { data: client, error: clientErr } = await supabaseAdmin.from('clients').select('id, name').eq('name', clientName).maybeSingle();
  if (clientErr) throw clientErr;
  if (!client) {
    console.error(`No client found named "${clientName}"`);
    process.exit(1);
  }

  const { data: curated, error: curatedErr } = await supabaseAdmin
    .from('client_portal_products')
    .select('product_id, products(id, sku, name)')
    .eq('client_id', client.id);
  if (curatedErr) throw curatedErr;

  const { data: existingSkus, error: skusErr } = await supabaseAdmin
    .from('client_product_skus')
    .select('product_id')
    .eq('client_id', client.id);
  if (skusErr) throw skusErr;
  const alreadyDone = new Set((existingSkus ?? []).map((r) => r.product_id));

  let toWrite = [];
  let skippedAlreadyDone = 0;
  let skippedNoMatch = 0;

  for (const row of curated ?? []) {
    const product = row.products;
    if (!product) continue;
    if (alreadyDone.has(product.id)) {
      skippedAlreadyDone++;
      continue;
    }
    const match = product.name.match(SKU_PATTERN);
    if (!match) {
      skippedNoMatch++;
      continue;
    }
    toWrite.push({ client_id: client.id, product_id: product.id, client_sku: match[1], sku: product.sku, name: product.name });
  }

  console.log(`Client: ${client.name} (${client.id})`);
  console.log(`Curated products: ${(curated ?? []).length}`);
  console.log(`Already had a client SKU (skipped): ${skippedAlreadyDone}`);
  console.log(`No 927-prefixed SKU found in name (skipped): ${skippedNoMatch}`);
  console.log(`To write: ${toWrite.length}`);
  for (const row of toWrite) console.log(`  ${row.sku} -> ${row.client_sku}  (${row.name})`);

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    return;
  }
  if (toWrite.length === 0) {
    console.log('\nNothing to write.');
    return;
  }

  const { error: writeErr } = await supabaseAdmin
    .from('client_product_skus')
    .upsert(
      toWrite.map(({ client_id, product_id, client_sku }) => ({ client_id, product_id, client_sku })),
      { onConflict: 'client_id,product_id' }
    );
  if (writeErr) throw writeErr;
  console.log(`\nWrote ${toWrite.length} client SKU(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
