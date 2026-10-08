const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');
const { sendEmail } = require('../lib/email');

// A "bulk approval" = one click of "Confirm N selected" on the Approvals page.
// Each is saved as an approval_batches row (037) so the approver and Shonrei
// can look back at it as a group, and so the notification email can link to a
// permanent confirmation page.

const NZ_TZ = 'Pacific/Auckland';
const APP_BASE_URL = () => (process.env.APP_BASE_URL || 'https://orders.shonrei.com').replace(/\/$/, '');

// "4:42 PM" / "9 October 2026" / "NZDT", always in NZ time regardless of the
// server's own timezone (Render runs UTC).
function formatBatchTime(iso) {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZoneName: 'short',
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    time: `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`,
    date: `${get('day')} ${get('month')} ${get('year')}`,
    tz: get('timeZoneName'),
  };
}

function batchSubject(iso) {
  const { time, date } = formatBatchTime(iso);
  return `Shonrei Orders Approved ${time} on ${date}`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isStaff(req) {
  return req.roles.isPortalAdmin === true;
}

// Loads one batch with everything the page and the email render: approver,
// and each approved order with its store, line count and total quantity.
async function loadBatchDetail(batchId) {
  const { data: batch, error } = await supabaseAdmin.from('approval_batches').select('*').eq('id', batchId).maybeSingle();
  if (error) throw new ApiError(500, 'Failed to load approval', error.message);
  if (!batch) return null;

  const [{ data: orders, error: ordersErr }, { data: approver }] = await Promise.all([
    supabaseAdmin
      .from('orders')
      .select('id, reference, store_id, status, created_at, order_lines(quantity)')
      .eq('approval_batch_id', batchId)
      .order('created_at', { ascending: true }),
    batch.approved_by
      ? supabaseAdmin.from('users').select('id, email, full_name').eq('id', batch.approved_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (ordersErr) throw new ApiError(500, 'Failed to load approved orders', ordersErr.message);

  const storeIds = [...new Set((orders || []).map((o) => o.store_id))];
  const { data: stores } = storeIds.length
    ? await supabaseAdmin.from('stores').select('id, name, store_number').in('id', storeIds)
    : { data: [] };
  const storeById = new Map((stores || []).map((s) => [s.id, s]));

  return {
    batch,
    approver,
    orders: (orders || []).map((o) => {
      const store = storeById.get(o.store_id);
      return {
        id: o.id,
        reference: o.reference,
        store_id: o.store_id,
        store_name: store?.name ?? null,
        store_number: store?.store_number ?? null,
        status: o.status,
        line_count: (o.order_lines || []).length,
        total_quantity: (o.order_lines || []).reduce((sum, l) => sum + (Number(l.quantity) || 0), 0),
      };
    }),
  };
}

function renderEmail({ batch, approver, orders }) {
  const subject = batchSubject(batch.approved_at);
  const { time, date, tz } = formatBatchTime(batch.approved_at);
  const approverName = approver?.full_name || approver?.email || 'an approver';
  const skippedCount = Array.isArray(batch.skipped) ? batch.skipped.length : 0;
  const link = `${APP_BASE_URL()}/approvals/batches/${batch.id}`;
  // Served from the frontend's public/ folder (emails can't embed local files).
  const logoUrl = `${APP_BASE_URL()}/shonrei-logo.png`;

  const storeLabel = (o) => [o.store_number, o.store_name].filter(Boolean).join(' - ') || '—';

  const rows = orders
    .map(
      (o) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${esc(o.reference || o.id.slice(0, 8))}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${esc(storeLabel(o))}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${o.line_count}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${o.total_quantity}</td>
      </tr>`
    )
    .join('');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="vertical-align:top">
          <h1 style="margin:0 0 4px;font-size:20px">Orders approved</h1>
          <p style="margin:0;color:#6b7280;font-size:14px">${esc(time)} on ${esc(date)} (${esc(tz)})</p>
        </td>
        <td style="vertical-align:top;text-align:right;width:150px">
          <img src="${esc(logoUrl)}" alt="Shonrei" width="140" height="24" style="display:inline-block;border:0;height:24px;width:140px">
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5">
      <strong>${esc(approverName)}</strong> approved <strong>${orders.length} order${orders.length === 1 ? '' : 's'}</strong>${orders.length > 1 ? ' as one group' : ''}.${skippedCount > 0 ? ` ${skippedCount} selected order${skippedCount === 1 ? ' was' : 's were'} not approved.` : ''}
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
      <thead><tr style="text-align:left;color:#6b7280">
        <th style="padding:6px 10px;border-bottom:2px solid #e5e7eb">Order</th>
        <th style="padding:6px 10px;border-bottom:2px solid #e5e7eb">Store</th>
        <th style="padding:6px 10px;border-bottom:2px solid #e5e7eb;text-align:right">Lines</th>
        <th style="padding:6px 10px;border-bottom:2px solid #e5e7eb;text-align:right">Qty</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <a href="${esc(link)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">View this approval</a>
    <p style="margin:20px 0 0;color:#9ca3af;font-size:12px">Shonrei Ordering Portal. Orders are now being sent to Shonrei for processing. This approval stays available at the link above.</p>
  </div>
</body></html>`;

  const text = [
    `Orders approved - ${time} on ${date} (${tz})`,
    '',
    `${approverName} approved ${orders.length} order${orders.length === 1 ? '' : 's'}${orders.length > 1 ? ' as one group' : ''}.`,
    skippedCount > 0 ? `${skippedCount} selected order(s) were not approved.` : null,
    '',
    ...orders.map((o) => `- ${o.reference || o.id.slice(0, 8)} | ${storeLabel(o)} | ${o.line_count} lines | qty ${o.total_quantity}`),
    '',
    `View this approval: ${link}`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { subject, html, text };
}

// The approver plus the shared APPROVAL_NOTIFY_EMAILS list. For single-order
// approvals, anyone who is a portal user with "single-order emails" switched
// off (Account settings, user_preferences.notify_single_approval_emails) is
// dropped; addresses that aren't portal users (e.g. a shared mailbox) can't
// opt out, so they always stay. Bulk-approval emails ignore the setting.
async function notifyRecipients(req, kind) {
  const extra = (process.env.APPROVAL_NOTIFY_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const all = [...new Set([req.user.email, ...extra].filter(Boolean).map((e) => e.toLowerCase()))];
  if (kind !== 'single') return all;

  const { data: users, error: usersErr } = await supabaseAdmin.from('users').select('id, email').in('email', all);
  if (usersErr) throw new Error(usersErr.message);
  const matched = users || [];
  if (matched.length === 0) return all;

  const { data: prefs, error: prefsErr } = await supabaseAdmin
    .from('user_preferences')
    .select('user_id')
    .in('user_id', matched.map((u) => u.id))
    .eq('notify_single_approval_emails', false);
  if (prefsErr) throw new Error(prefsErr.message);

  const optedOutEmails = new Set(
    matched.filter((u) => (prefs || []).some((p) => p.user_id === u.id)).map((u) => String(u.email).toLowerCase())
  );
  return all.filter((e) => !optedOutEmails.has(e));
}

// Called by orders.bulkConfirm (kind 'bulk') and orders.confirmOrder (kind
// 'single') right after the orders are confirmed. Never throws: the orders are
// already confirmed (and synced to Cin7) at this point, so a failure to record
// the approval or send the email must not turn it into an error. Returns the
// batch id, or null if it couldn't be recorded.
async function recordApproval(req, confirmedOrderIds, skipped, { kind = 'bulk' } = {}) {
  if (confirmedOrderIds.length === 0) return null;

  try {
    const { data: batch, error } = await supabaseAdmin
      .from('approval_batches')
      .insert({ approved_by: req.user.id, confirmed_count: confirmedOrderIds.length, skipped, kind })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const { error: linkErr } = await supabaseAdmin.from('orders').update({ approval_batch_id: batch.id }).in('id', confirmedOrderIds);
    if (linkErr) throw new Error(linkErr.message);

    let recipients = [];
    let emailResult;
    try {
      recipients = await notifyRecipients(req, kind);
      if (recipients.length === 0) {
        emailResult = { status: 'skipped' };
      } else {
        const detail = await loadBatchDetail(batch.id);
        emailResult = await sendEmail({ to: recipients, ...renderEmail(detail) });
      }
    } catch (err) {
      emailResult = { status: 'failed', error: err.message };
    }

    await supabaseAdmin
      .from('approval_batches')
      .update({ email_status: emailResult.status, email_recipients: recipients, email_error: emailResult.error ?? null })
      .eq('id', batch.id);

    if (emailResult.status === 'failed') console.error('Approval email failed:', emailResult.error);
    return batch.id;
  } catch (err) {
    console.error('Failed to record approval batch:', err.message);
    return null;
  }
}

function canViewOrder(req, order) {
  return isStaff(req) || req.roles.accessibleStoreIds.has(order.store_id);
}

function toApiShape(req, { batch, approver, orders }) {
  const staff = isStaff(req);
  const visibleOrders = orders.filter((o) => canViewOrder(req, o));
  return {
    id: batch.id,
    kind: batch.kind,
    subject: batchSubject(batch.approved_at),
    approved_at: batch.approved_at,
    ...(() => {
      const { time, date, tz } = formatBatchTime(batch.approved_at);
      return { time, date, timezone: tz };
    })(),
    approved_by: approver ? { id: approver.id, email: approver.email, full_name: approver.full_name } : null,
    confirmed_count: batch.confirmed_count,
    skipped: Array.isArray(batch.skipped) ? batch.skipped : [],
    orders: visibleOrders,
    // Recipient addresses include internal Shonrei ones, so only staff see
    // them; everyone else just sees whether a notification went out.
    email: staff
      ? { status: batch.email_status, recipients: batch.email_recipients, error: batch.email_error }
      : { status: batch.email_status },
  };
}

async function getBatch(req, batchId) {
  const detail = await loadBatchDetail(batchId);
  if (!detail) throw new ApiError(404, 'Approval not found');

  const allowed = isStaff(req) || detail.batch.approved_by === req.user.id || detail.orders.some((o) => canViewOrder(req, o));
  if (!allowed) throw new ApiError(404, 'Approval not found'); // 404, not 403: don't confirm it exists

  return toApiShape(req, detail);
}

async function listBatches(req) {
  const LIMIT = 50;
  let batchIds = null; // null = no restriction (staff)

  if (!isStaff(req)) {
    const ids = new Set();
    const storeRoleIds = (req.roles.storeRoles || []).map((r) => r.store_id);
    const clientIds = (req.roles.clientRoles || []).map((r) => r.client_id);

    const queries = [supabaseAdmin.from('approval_batches').select('id').eq('approved_by', req.user.id)];
    if (storeRoleIds.length > 0) {
      queries.push(supabaseAdmin.from('orders').select('approval_batch_id').not('approval_batch_id', 'is', null).in('store_id', storeRoleIds));
    }
    if (clientIds.length > 0) {
      queries.push(
        supabaseAdmin.from('orders').select('approval_batch_id, stores!inner(client_id)').not('approval_batch_id', 'is', null).in('stores.client_id', clientIds)
      );
    }
    for (const result of await Promise.all(queries)) {
      if (result.error) throw new ApiError(500, 'Failed to list approvals', result.error.message);
      for (const row of result.data || []) ids.add(row.id ?? row.approval_batch_id);
    }
    batchIds = [...ids];
    if (batchIds.length === 0) return { batches: [] };
  }

  let query = supabaseAdmin.from('approval_batches').select('id, kind, approved_at, approved_by, confirmed_count, skipped, email_status').order('approved_at', { ascending: false }).limit(LIMIT);
  if (batchIds) query = query.in('id', batchIds);
  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Failed to list approvals', error.message);

  const approverIds = [...new Set((data || []).map((b) => b.approved_by).filter(Boolean))];
  const { data: approvers } = approverIds.length
    ? await supabaseAdmin.from('users').select('id, email, full_name').in('id', approverIds)
    : { data: [] };
  const approverById = new Map((approvers || []).map((u) => [u.id, u]));

  return {
    batches: (data || []).map((b) => {
      const { time, date, tz } = formatBatchTime(b.approved_at);
      const a = approverById.get(b.approved_by);
      return {
        id: b.id,
        kind: b.kind,
        subject: batchSubject(b.approved_at),
        approved_at: b.approved_at,
        time,
        date,
        timezone: tz,
        approved_by: a ? { id: a.id, email: a.email, full_name: a.full_name } : null,
        confirmed_count: b.confirmed_count,
        skipped_count: Array.isArray(b.skipped) ? b.skipped.length : 0,
        email_status: b.email_status,
      };
    }),
  };
}

module.exports = { recordApproval, getBatch, listBatches, batchSubject, renderEmail, formatBatchTime };
