// Mirrors a single client's Cin7 customer Addresses into
// client_addresses (014_client_addresses.sql). Manually triggered per
// client (staff action), not part of the product sync job -- addresses
// change far less often and there's no reason to couple the two.

const { supabaseAdmin } = require('../../config/supabase');
const cin7 = require('./client');

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

  return { synced: rows.length };
}

module.exports = { syncClientAddresses };
