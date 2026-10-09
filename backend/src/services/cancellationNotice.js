const { sendEmail } = require('../lib/email');

const APP_BASE_URL = () => (process.env.APP_BASE_URL || 'https://orders.shonrei.com').replace(/\/$/, '');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Tells Shonrei staff a client has asked to cancel an order that already
// synced to Cin7 (Cin7 is where staff then void it). Goes to the same
// APPROVAL_NOTIFY_EMAILS list as approval emails -- the Shonrei-side
// recipients. With that list empty, nobody is emailed (the request still shows
// in the portal). Best-effort: never throws.
async function notifyCancellationRequested({ order, store, requesterEmail, reason }) {
  try {
    const to = [
      ...new Set(
        (process.env.APPROVAL_NOTIFY_EMAILS || '')
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      ),
    ];
    if (to.length === 0) return { status: 'skipped' };

    const ref = order.reference || order.id.slice(0, 8);
    const storeLabel = [store?.store_number, store?.name].filter(Boolean).join(' - ') || 'Unknown store';
    const link = `${APP_BASE_URL()}/orders/${order.id}`;
    const logoUrl = `${APP_BASE_URL()}/shonrei-logo.png`;
    const subject = `Cancellation requested: ${ref}`;

    const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="vertical-align:top">
          <h1 style="margin:0 0 4px;font-size:20px">Cancellation requested</h1>
          <p style="margin:0;color:#6b7280;font-size:14px">${esc(ref)}</p>
        </td>
        <td style="vertical-align:top;text-align:right;width:150px">
          <img src="${esc(logoUrl)}" alt="Shonrei" width="140" height="24" style="display:inline-block;border:0;height:24px;width:140px">
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5"><strong>${esc(requesterEmail || 'A user')}</strong> has asked to cancel an order that is already in Cin7.</p>
    <p style="margin:0 0 4px;font-size:14px"><strong>Store:</strong> ${esc(storeLabel)}</p>
    <p style="margin:0 0 16px;font-size:14px"><strong>Reason:</strong> ${esc(reason || 'None given')}</p>
    <a href="${esc(link)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Review in the portal</a>
    <p style="margin:20px 0 0;color:#9ca3af;font-size:12px">If you agree, void the Sale in Cin7. The portal marks the order Cancelled automatically once Cin7 shows it as voided.</p>
  </div>
</body></html>`;

    const text = [
      `Cancellation requested - ${ref}`,
      '',
      `${requesterEmail || 'A user'} has asked to cancel an order that is already in Cin7.`,
      `Store: ${storeLabel}`,
      `Reason: ${reason || 'None given'}`,
      '',
      `Review in the portal: ${link}`,
      'If you agree, void the Sale in Cin7. The portal marks the order Cancelled automatically once Cin7 shows it as voided.',
    ].join('\n');

    return await sendEmail({ to, subject, html, text });
  } catch (err) {
    console.error('Cancellation request email failed:', err.message);
    return { status: 'failed', error: err.message };
  }
}

module.exports = { notifyCancellationRequested };
