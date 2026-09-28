// Mirrors a single client's Cin7 customer Addresses into
// client_addresses (014_client_addresses.sql). Manually triggered per
// client (staff action), not part of the product sync job -- addresses
// change far less often and there's no reason to couple the two.

const { supabaseAdmin } = require('../../config/supabase');
const cin7 = require('./client');

function normSuburb(s) {
  return (s || '').toLowerCase().replace(/[.,]/g, '').trim();
}

// Standing check (added 2026-09-29, after a real near-miss: "The
// Pines" is both a QLD store and an unrelated VIC store). The
// store<->address search tagging (services/stores.js's
// importAddressMatches with target='search', and the one-off bulk pass
// that first populated client_addresses.store_number) links a store to
// a Cin7 address by matching its NAME's suburb against the address's
// City field -- not by state. Two stores in different states can
// coincidentally share a suburb name; if BOTH also have a Cin7-synced
// address for that city, name-only matching can't tell them apart and
// would wrongly treat them as the same physical location. Only counted
// as a real risk when a matching address actually exists for the
// shared name on this client -- a name coincidence with no address on
// either side (like "The Pines" today) is noise, not a live problem,
// so it's not reported.
//
// Run automatically at the end of every address sync below, since a
// fresh sync is exactly the moment a previously-harmless name
// coincidence can turn into a live one (a new Cin7 address arrives for
// a city that already collides). Also callable standalone (e.g. from a
// script) without triggering a real Cin7 sync.
async function findSuburbNameCollisions(clientId) {
  const [{ data: stores, error: storesErr }, { data: addresses, error: addrErr }] = await Promise.all([
    supabaseAdmin.from('stores').select('store_number, name, state').eq('client_id', clientId),
    supabaseAdmin.from('client_addresses').select('city').eq('client_id', clientId).eq('type', 'Shipping'),
  ]);
  if (storesErr) throw new Error(`Failed to load stores: ${storesErr.message}`);
  if (addrErr) throw new Error(`Failed to load addresses: ${addrErr.message}`);

  const citiesWithAddress = new Set((addresses || []).map((a) => normSuburb(a.city)));
  const bySuburb = new Map();
  for (const s of stores || []) {
    if (!s.store_number) continue; // skip the head-office placeholder row
    const suburb = normSuburb(s.name.split(' - ').slice(1).join(' - '));
    if (!suburb) continue;
    if (!bySuburb.has(suburb)) bySuburb.set(suburb, []);
    bySuburb.get(suburb).push({ store_number: s.store_number, state: s.state });
  }

  const collisions = [];
  for (const [suburb, list] of bySuburb) {
    const states = new Set(list.map((x) => x.state).filter(Boolean));
    if (states.size > 1 && citiesWithAddress.has(suburb)) {
      collisions.push({ suburb, stores: list });
    }
  }
  return collisions;
}

async function syncClientAddresses(clientId) {
  const { data: client, error: clientErr } = await supabaseAdmin.from('clients').select('id, cin7_customer_id').eq('id', clientId).maybeSingle();
  if (clientErr) throw new Error(`Failed to load client: ${clientErr.message}`);
  if (!client) throw new Error('Client not found');
  if (!client.cin7_customer_id) throw new Error('Client has no cin7_customer_id configured');

  if (!cin7.isConfigured()) throw new Error('CIN7_ACCOUNT_ID / CIN7_APPLICATION_KEY are not configured');

  const res = await cin7.fetchCustomer(client.cin7_customer_id);
  if (!res.ok) throw new Error(cin7.cin7ErrorMessage(res));
  if (!res.body) throw new Error(`Cin7 customer ${client.cin7_customer_id} not found`);

  const addresses = res.body.Addresses || [];
  const rows = addresses.map((a) => ({
    client_id: clientId,
    cin7_address_id: a.ID,
    type: a.Type,
    is_default: a.DefaultForType === true,
    line1: a.Line1,
    line2: a.Line2 || null,
    city: a.City || null,
    state: a.State || null,
    postcode: a.Postcode || null,
    country: a.Country || null,
    synced_at: new Date().toISOString(),
  }));

  // Upsert (not delete-then-insert) so a row's id stays STABLE across
  // re-syncs -- stores.client_address_id (027) references this id
  // directly, and a full replace would silently orphan every store's
  // address assignment on the next sync.
  if (rows.length > 0) {
    const { error: upsertErr } = await supabaseAdmin.from('client_addresses').upsert(rows, { onConflict: 'client_id,cin7_address_id' });
    if (upsertErr) throw new Error(`Failed to save addresses: ${upsertErr.message}`);
  }

  // Still prune anything no longer present in Cin7 -- diff in JS and
  // delete by internal id (avoids building a raw filter string against
  // cin7_address_id, which would need careful escaping). A pruned
  // address's stores.client_address_id references get cleared
  // automatically via ON DELETE SET NULL.
  const currentCin7Ids = new Set(addresses.map((a) => String(a.ID)));
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('client_addresses')
    .select('id, cin7_address_id')
    .eq('client_id', clientId);
  if (existingErr) throw new Error(`Failed to check existing addresses: ${existingErr.message}`);
  const staleIds = (existing || []).filter((r) => !currentCin7Ids.has(String(r.cin7_address_id))).map((r) => r.id);
  if (staleIds.length > 0) {
    const { error: deleteErr } = await supabaseAdmin.from('client_addresses').delete().in('id', staleIds);
    if (deleteErr) throw new Error(`Failed to prune removed addresses: ${deleteErr.message}`);
  }

  const collisions = await findSuburbNameCollisions(clientId);
  if (collisions.length > 0) {
    console.warn(
      `[addressSync] ${collisions.length} cross-state suburb-name collision(s) for client ${clientId} now have a matching Cin7 address -- store<->address search tags for these suburbs may be wrong:`,
      JSON.stringify(collisions)
    );
  }

  return { synced: rows.length, suburbNameCollisions: collisions };
}

module.exports = { syncClientAddresses, findSuburbNameCollisions };
