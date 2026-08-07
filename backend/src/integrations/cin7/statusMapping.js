// Translates a Cin7 event into the provider-agnostic action to take on
// an order. Both the webhook handler (integrations/cin7/webhook.js) and
// any future polling job (SaleList?UpdatedSince= fallback, not yet
// built) call into these same functions, so there is one translation
// implementation, not two that could drift apart.
//
// Shonrei uses an invoice-first flow: goods are often physically packed,
// shipped, and invoiced before Cin7 reflects them as in-stock (an
// assembly/BOM step lags in Cin7). Cin7's own pick-pack-ship action is
// actioned by staff AFTER the physical shipment already happened -- so
// Cin7 events here are treated as confirmation, not real-time truth.
// That's why "shipped" is primarily a manual bulk action (see
// services/orders.js markShipped) with this as a fallback only.

const { supabaseAdmin } = require('../../config/supabase');

async function logEvent(orderId, eventType, detail) {
  await supabaseAdmin.from('order_events').insert({ order_id: orderId, actor_id: null, event_type: eventType, detail });
}

async function findOrderByCin7SaleId(cin7SaleId) {
  // Confirmed via a real webhook payload: Cin7's webhook events send the
  // Sale id in UPPERCASE (e.g. SaleTaskID), while Cin7's own REST API
  // returns it lowercase when a Sale is created (what we store in
  // inventory_sync.external_id). Case-insensitive match rather than
  // assuming either side is consistently cased.
  const { data: sync } = await supabaseAdmin
    .from('inventory_sync')
    .select('order_id')
    .eq('provider', 'cin7')
    .ilike('external_id', cin7SaleId)
    .maybeSingle();
  if (!sync) return null;

  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', sync.order_id).maybeSingle();
  return order || null;
}

// Cin7 invoice-created event -> shipped-status auto fallback.
// Never overwrites a manual "Mark as Shipped" -- if already
// shipped_source: 'manual', this just logs the event for reconciliation.
async function applyInvoiceCreatedEvent({ cin7SaleId, invoiceCreatedAt, rawEvent }) {
  const order = await findOrderByCin7SaleId(cin7SaleId);
  if (!order) {
    console.warn(`[cin7 statusMapping] invoice-created event for unknown Sale ${cin7SaleId} -- ignoring`);
    return null;
  }

  if (order.shipped_source === 'manual') {
    await logEvent(order.id, 'cin7_invoice_created_after_manual_ship', { cin7_sale_id: cin7SaleId, rawEvent });
    console.log(`[cin7 statusMapping] order ${order.id} already manually shipped -- logging invoice event, not overwriting`);
    return order;
  }

  const { data: updated, error } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'shipped',
      shipped_at: invoiceCreatedAt || new Date().toISOString(),
      shipped_source: 'auto_invoice',
      shipped_by: null,
    })
    .eq('id', order.id)
    .select()
    .single();

  if (error) {
    console.error(`[cin7 statusMapping] failed to auto-mark order ${order.id} shipped:`, error.message);
    return order;
  }

  await logEvent(order.id, 'shipped', { source: 'auto_invoice', cin7_sale_id: cin7SaleId });
  return updated;
}

module.exports = { findOrderByCin7SaleId, applyInvoiceCreatedEvent };
