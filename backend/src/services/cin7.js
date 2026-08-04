// Stub for the Cin7 integration — built out as its own module in the next
// phase. For now this just logs so the calling code (approve flow) has a
// real seam to call into rather than a TODO comment.
async function syncOrderToCin7(order) {
  console.log(`[cin7] would sync here: order ${order.id} (store ${order.store_id})`);
}

module.exports = { syncOrderToCin7 };
