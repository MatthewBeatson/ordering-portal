// Provider-agnostic wrapper so the rest of the backend never knows which
// email service is behind it -- swapping providers means rewriting only this
// file. Currently Resend's REST API (no SDK dependency).
//
// Needs two env vars; with either missing, nothing is sent and the caller gets
// { status: 'not_configured' } rather than an error, so features that email
// (e.g. bulk-approval notices) work fine in dev and before email is set up:
//   RESEND_API_KEY  API key from the Resend dashboard
//   EMAIL_FROM      sender on a domain verified in Resend,
//                   e.g. "Shonrei Orders <orders@shonrei.com>"
//
// Never throws: a failed email must not undo whatever business action
// triggered it.
async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { status: 'not_configured' };
  if (!Array.isArray(to) || to.length === 0) return { status: 'failed', error: 'No recipients' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { status: 'failed', error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    return { status: 'sent' };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

module.exports = { sendEmail };
