// Line-item shaping for Cin7 Sale/Order lines.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Cin7 rejects a Sale if the same SKU appears twice in Lines ("It is
// impossible to use product with one SKU more once in Lines"). Our
// order_lines table has no such constraint, so merge before submitting:
// same SKU -> sum quantity, keep the line's price (order creation
// doesn't currently allow differing prices per line for the same SKU),
// concatenate any distinct descriptions/comments.
function mergeDuplicateLines(lines) {
  const bySku = new Map();
  for (const line of lines) {
    const existing = bySku.get(line.sku);
    if (!existing) {
      bySku.set(line.sku, { ...line });
      continue;
    }
    existing.quantity = Number(existing.quantity) + Number(line.quantity);
    if (line.description && !existing.description?.includes(line.description)) {
      existing.description = existing.description ? `${existing.description}; ${line.description}` : line.description;
    }
  }
  return [...bySku.values()];
}

// Tax is computed here (not read back from Cin7) because Cin7's line
// schema requires the caller to supply Tax/Total up front, and
// order_lines carries no tax data of its own -- see clients.tax_rate.
//
// Comment carries the CLIENT's own SKU (client_product_skus -- the
// portal stays the source of truth for it, this is a one-way push at
// sync time, not a two-way sync) so it shows up on Cin7's own Sale
// documents (packing slip/invoice PDF templates) next to the
// description. Cin7 has no per-customer SKU field of its own at all
// (see client_product_skus' migration comment -- every Cin7 product
// field is global, shared across every customer), so Comment is the
// only place this can land in a Cin7-native document. Deliberately not
// the product name/description itself -- Cin7 already shows that via
// its own SKU lookup, so Comment stays a single clean field just for
// the client's code. clientSkuBySku is resolved by the caller
// (sync.js's resolveClientSkuBySku) -- this file has no DB access of
// its own.
function buildSaleOrderLine(line, client, clientSkuBySku) {
  const quantity = Number(line.quantity);
  const price = Number(line.unit_price ?? 0);
  const subtotal = round2(quantity * price);
  const tax = round2(subtotal * Number(client.tax_rate));
  const clientSku = clientSkuBySku?.get(line.sku);
  return {
    SKU: line.sku,
    Quantity: quantity,
    Price: price,
    Tax: tax,
    Total: round2(subtotal + tax),
    TaxRule: client.cin7_tax_rule,
    ...(clientSku ? { Comment: clientSku } : {}),
  };
}

function buildSaleOrderLines(lines, client, clientSkuBySku) {
  return mergeDuplicateLines(lines).map((l) => buildSaleOrderLine(l, client, clientSkuBySku));
}

module.exports = { mergeDuplicateLines, buildSaleOrderLine, buildSaleOrderLines };
