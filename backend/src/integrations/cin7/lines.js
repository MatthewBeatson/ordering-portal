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
// Name is overridden to "<current Cin7 name> - <client sku>" when a
// client SKU is known (client_product_skus -- the portal stays the
// source of truth for it, this is a one-way push at sync time, not a
// two-way sync). Confirmed with the client: Cin7's own per-line
// Comment field isn't actually shown on standard Sale reports/PDF
// templates, but the line's Name/description always is, so that's the
// reliable place for this rather than Comment alone. Comment is still
// set too, at no extra cost, in case a particular template does
// surface it. Cin7 has no per-customer SKU field of its own at all
// (every Cin7 product field is global, shared across every customer --
// see client_product_skus' migration comment), so this override is the
// only way the client's own code reaches a Cin7-native document.
// lineOverrides (Map<sku, {name, clientSku}>) is resolved by the
// caller (sync.js's resolveLineOverrides) -- this file has no DB
// access of its own. No override for a line (no client SKU set for
// that product/client) leaves Name unset entirely, same as before this
// feature existed -- Cin7 resolves its own display name via the SKU.
function buildSaleOrderLine(line, client, lineOverrides) {
  const quantity = Number(line.quantity);
  const price = Number(line.unit_price ?? 0);
  const subtotal = round2(quantity * price);
  const tax = round2(subtotal * Number(client.tax_rate));
  const override = lineOverrides?.get(line.sku);
  return {
    SKU: line.sku,
    Quantity: quantity,
    Price: price,
    Tax: tax,
    Total: round2(subtotal + tax),
    TaxRule: client.cin7_tax_rule,
    ...(override ? { Name: override.name, Comment: override.clientSku } : {}),
  };
}

function buildSaleOrderLines(lines, client, lineOverrides) {
  return mergeDuplicateLines(lines).map((l) => buildSaleOrderLine(l, client, lineOverrides));
}

module.exports = { mergeDuplicateLines, buildSaleOrderLine, buildSaleOrderLines };
