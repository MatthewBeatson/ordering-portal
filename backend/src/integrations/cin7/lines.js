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
// Comment is deliberately NOT sent -- order_lines.description gets
// auto-populated with the product name (+ client SKU) at cart-add time
// purely for our own UI display, and Cin7 already shows the product
// name via its own SKU lookup, so pushing that same text into Cin7's
// line Comment field just duplicated it there for no reason.
function buildSaleOrderLine(line, client) {
  const quantity = Number(line.quantity);
  const price = Number(line.unit_price ?? 0);
  const subtotal = round2(quantity * price);
  const tax = round2(subtotal * Number(client.tax_rate));
  return {
    SKU: line.sku,
    Quantity: quantity,
    Price: price,
    Tax: tax,
    Total: round2(subtotal + tax),
    TaxRule: client.cin7_tax_rule,
  };
}

function buildSaleOrderLines(lines, client) {
  return mergeDuplicateLines(lines).map((l) => buildSaleOrderLine(l, client));
}

module.exports = { mergeDuplicateLines, buildSaleOrderLine, buildSaleOrderLines };
