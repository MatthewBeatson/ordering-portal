// One-time setup: registers (or re-registers) this backend's webhook
// receiver with a Cin7 Core account. Run manually, not on every deploy --
// Cin7 webhooks are configured per-account and persist server-side.
//
// Usage:
//   CIN7_ACCOUNT_ID=... CIN7_APPLICATION_KEY=... CIN7_WEBHOOK_TOKEN=... \
//     node scripts/register-cin7-webhook.js https://your-backend.onrender.com/webhooks/cin7
//
// Requires the Automations module on the target Cin7 Core account --
// if it's not included in the plan, POST /Webhooks will fail; that's
// expected, not a bug in this script.

require('dotenv').config();

const CIN7_API_BASE_URL = process.env.CIN7_API_BASE_URL || 'https://inventory.dearsystems.com/ExternalApi/v2';
const CIN7_ACCOUNT_ID = process.env.CIN7_ACCOUNT_ID;
const CIN7_APPLICATION_KEY = process.env.CIN7_APPLICATION_KEY;
const CIN7_WEBHOOK_TOKEN = process.env.CIN7_WEBHOOK_TOKEN;

const callbackUrl = process.argv[2];

async function cin7Fetch(method, path, body) {
  const res = await fetch(`${CIN7_API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'api-auth-accountid': CIN7_ACCOUNT_ID,
      'api-auth-applicationkey': CIN7_APPLICATION_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: parsed };
}

(async () => {
  if (!callbackUrl) {
    console.error('Usage: node scripts/register-cin7-webhook.js <callback-url>');
    process.exit(1);
  }
  if (!CIN7_ACCOUNT_ID || !CIN7_APPLICATION_KEY || !CIN7_WEBHOOK_TOKEN) {
    console.error('CIN7_ACCOUNT_ID, CIN7_APPLICATION_KEY, and CIN7_WEBHOOK_TOKEN must all be set');
    process.exit(1);
  }

  const existing = await cin7Fetch('GET', '/Webhooks');
  const already = existing.body?.Webhooks?.find((w) => w.Type === 'Sale/InvoiceAuthorised' && w.ExternalURL === callbackUrl);
  if (already) {
    console.log('Webhook already registered:', JSON.stringify(already, null, 2));
    return;
  }

  const res = await cin7Fetch('POST', '/Webhooks', {
    Type: 'Sale/InvoiceAuthorised',
    IsActive: true,
    ExternalURL: callbackUrl,
    ExternalAuthorizationType: 'bearerauth',
    ExternalBearerToken: CIN7_WEBHOOK_TOKEN,
  });

  console.log(`Register -> HTTP ${res.status}`);
  console.log(JSON.stringify(res.body, null, 2));
})();
