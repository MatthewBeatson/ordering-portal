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

  // Full replace for this client -- Cin7 is the source of truth, and a
  // small per-client address list makes delete-then-insert simple and
  // correct (no risk of stale rows lingering after an address is
  // removed in Cin7).
  const { error: deleteErr } = await supabaseAdmin.from('client_addresses').delete().eq('client_id', clientId);
  if (deleteErr) throw new Error(`Failed to clear old addresses: ${deleteErr.message}`);

  if (rows.length === 0) return { synced: 0 };

  const { error: insertErr } = await supabaseAdmin.from('client_addresses').insert(rows);
  if (insertErr) throw new Error(`Failed to save addresses: ${insertErr.message}`);

  return { synced: rows.length };
}

module.exports = { syncClientAddresses };
