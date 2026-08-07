// Cin7 Core (V2) raw HTTP client. This is the ONLY file in the app that
// sends a request to Cin7's API, and the only place Cin7 credentials are
// read — nothing outside integrations/cin7/ should import this module's
// internals directly; go through sync.js / statusMapping.js instead.
//
// API contract verified against a real Cin7 Core trial account, not
// guessed:
//   - Auth:       https://help.core.cin7.com/hc/en-us/articles/9982480315407
//   - POST /Sale creates the customer-linked Sale header.
//   - POST /Sale/Order (SaleID + Lines) sets order lines and authorizes
//     the order in one call (Quantity/Price/Total/TaxRule required per
//     line, confirmed via Cin7's own validation errors).
//   - GET /SaleList?ExternalID=<value> finds a Sale by a caller-supplied
//     ExternalID — real, queryable idempotency, confirmed via a live
//     create-then-search round trip.
//   - The created Sale's unique id comes back as `ID`.

const CIN7_API_BASE_URL = process.env.CIN7_API_BASE_URL || 'https://inventory.dearsystems.com/ExternalApi/v2';
const CIN7_ACCOUNT_ID = process.env.CIN7_ACCOUNT_ID;
const CIN7_APPLICATION_KEY = process.env.CIN7_APPLICATION_KEY;

function isConfigured() {
  return Boolean(CIN7_ACCOUNT_ID && CIN7_APPLICATION_KEY);
}

async function cin7Fetch(method, path, body) {
  const response = await fetch(`${CIN7_API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'api-auth-accountid': CIN7_ACCOUNT_ID,
      'api-auth-applicationkey': CIN7_APPLICATION_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsedBody = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body: parsedBody };
}

function cin7ErrorMessage(res) {
  if (Array.isArray(res.body)) return res.body.map((e) => e.Exception || JSON.stringify(e)).join('; ');
  return `HTTP ${res.status}: ${JSON.stringify(res.body)}`;
}

// Looks up a Sale by ExternalID (our orders.idempotency_key). Returns
// the matching SaleList row, or null if none exists yet.
async function findExistingSale(externalId) {
  const res = await cin7Fetch('GET', `/SaleList?ExternalID=${encodeURIComponent(externalId)}`);
  if (!res.ok) return null;
  return res.body?.SaleList?.[0] || null;
}

async function fetchFullSale(saleId) {
  const res = await cin7Fetch('GET', `/Sale?ID=${encodeURIComponent(saleId)}`);
  return res.ok ? res.body : null;
}

async function createSaleHeader(order, store, client) {
  return cin7Fetch('POST', '/Sale', {
    CustomerID: client.cin7_customer_id,
    SkipQuote: true,
    ExternalID: order.idempotency_key,
    CustomerReference: order.reference || undefined,
    TaxRule: client.cin7_tax_rule,
    ShippingAddress: {
      Line1: store.cin7_address_line1,
      Line2: store.cin7_address_line2 || undefined,
      City: store.cin7_address_city || undefined,
      State: store.cin7_address_state || undefined,
      Postcode: store.cin7_address_postcode || undefined,
      Country: store.cin7_address_country || undefined,
    },
  });
}

async function createSaleOrderLines(saleId, saleLines) {
  return cin7Fetch('POST', '/Sale/Order', {
    SaleID: saleId,
    Status: 'AUTHORISED',
    Lines: saleLines,
  });
}

module.exports = {
  isConfigured,
  cin7Fetch,
  cin7ErrorMessage,
  findExistingSale,
  fetchFullSale,
  createSaleHeader,
  createSaleOrderLines,
};
