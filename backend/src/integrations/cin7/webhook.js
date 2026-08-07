// Receives Cin7 Core webhook callbacks. Mounted outside requireAuth in
// app.js -- Cin7 isn't a Supabase user, so it authenticates differently
// (see below).
//
// Cin7 does NOT sign webhook payloads (no HMAC/signature header to
// verify). Instead, when a webhook is registered you choose an
// ExternalAuthorizationType of 'bearerauth' with an ExternalBearerToken,
// and Cin7 attaches that exact credential to every callback it makes.
// So verification here is just: does the Authorization header match
// the token we configured at registration time. Confirmed via Cin7's
// own docs (Webhooks reference, https://dearinventory.docs.apiary.io/),
// not guessed.
//
// Currently handles only Sale/InvoiceAuthorised (the event section 3 of
// the Phase 5 spec asks for, feeding the shipped-status auto fallback).
// Other event types are accepted (200, so Cin7 doesn't retry) but
// otherwise ignored until there's a concrete use for them -- every
// call that passes auth is still logged to webhook_log regardless.

const { Router } = require('express');
const { asyncHandler } = require('../../lib/asyncHandler');
const { supabaseAdmin } = require('../../config/supabase');
const { applyInvoiceCreatedEvent } = require('./statusMapping');

const CIN7_WEBHOOK_TOKEN = process.env.CIN7_WEBHOOK_TOKEN;

const router = Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization || '';
    if (!CIN7_WEBHOOK_TOKEN || authHeader !== `Bearer ${CIN7_WEBHOOK_TOKEN}`) {
      return res.status(401).json({ error: 'Invalid webhook credentials' });
    }

    const event = req.body;
    const eventType = event?.EventType;

    // Unconditional raw log of every call that passes auth, regardless
    // of event type or whether it's handled below -- see
    // 008_webhook_log.sql. Added to diagnose whether Cin7 delivers
    // webhooks at all on a trial account (no delivery log exposed via
    // Cin7's API, and no server-log access from this environment).
    const logResult = await supabaseAdmin.from('webhook_log').insert({ provider: 'cin7', event_type: eventType, raw_payload: event });
    if (logResult.error) {
      console.error('[cin7 webhook] failed to write webhook_log:', logResult.error.message);
    }

    switch (eventType) {
      case 'Sale/InvoiceAuthorised':
        await applyInvoiceCreatedEvent({
          // Cin7's own payload uses SaleTaskID for this event; other
          // event types use SaleID for the same underlying Sale. Cover
          // both rather than assume one name.
          cin7SaleId: event.SaleTaskID || event.SaleID,
          invoiceCreatedAt: new Date().toISOString(),
          rawEvent: event,
        });
        break;
      default:
        console.log(`[cin7 webhook] ignoring unhandled event type: ${eventType}`);
    }

    // Cin7 expects 200 regardless, including for event types we don't
    // act on -- returning an error here would just cause retries.
    res.status(200).json({ received: true });
  })
);

module.exports = router;
