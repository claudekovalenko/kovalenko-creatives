// Agreements: what the studio agrees to deliver (scope), the terms, what the client pays and when,
// the balance still owed, and a log of extra work done outside the agreement.
// The owner edits everything. The client's people on the plan can read it once it is shared, and
// accept it. Changing the scope, terms or payment plan after acceptance asks them to accept again.
import { HttpError, json, now, newId, readJson, text, oneOf } from './util.js';
import { requireOwner, requirePlanAccess, isOwner, logActivity, userActor, moneyOf, dollars } from './data.js';

export const agreementRoutes = [
  ['GET', '/api/plans/:id/agreement', getAgreement],
  ['PATCH', '/api/plans/:id/agreement', updateAgreement],
  ['POST', '/api/plans/:id/agreement/accept', acceptAgreement],
  ['POST', '/api/plans/:id/scope', createScope],
  ['PATCH', '/api/scope/:id', updateScope],
  ['DELETE', '/api/scope/:id', deleteScope],
  ['POST', '/api/plans/:id/payments', createPayment],
  ['PATCH', '/api/payments/:id', updatePayment],
  ['DELETE', '/api/payments/:id', deletePayment],
  ['POST', '/api/plans/:id/extras', createExtra],
  ['PATCH', '/api/extras/:id', updateExtra],
  ['DELETE', '/api/extras/:id', deleteExtra],
  ['POST', '/api/extras/:id/bill', billExtra],
];

// "$1,250.50", "1250.5" or 1250.5 -> 125050 cents
export function toCents(value, field, { required = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new HttpError(400, `${field} must be an amount like 1250 or 1,250.50`);
  return Math.round(n * 100);
}

function dateOrNull(value, field, { required = false } = {}) {
  if (!value) {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new HttpError(400, `${field} must be a date like 2026-12-01`);
  return value;
}

async function getAgreement(ctx, { id }) {
  const plan = await requirePlanAccess(ctx, id);
  const owner = isOwner(ctx.user);
  if (!owner && plan.agreement_status === 'draft') return json({ agreement: { status: 'draft', shared: false } });
  const [scope, payments, extras] = await Promise.all([
    ctx.db.prepare('SELECT id, title, detail FROM scope_items WHERE plan_id = ? ORDER BY position, created_at').bind(id).all(),
    ctx.db.prepare('SELECT id, label, amount_cents, due_date, paid_at FROM payments WHERE plan_id = ? ORDER BY position, created_at').bind(id).all(),
    ctx.db.prepare(
      `SELECT id, work_date, title, detail, hours, amount_cents, billing, visible, payment_id FROM extras WHERE plan_id = ?${owner ? '' : ' AND visible = 1'}
       ORDER BY work_date DESC, created_at DESC`,
    ).bind(id).all(),
  ]);
  return json({
    agreement: {
      status: plan.agreement_status,
      shared: plan.agreement_status !== 'draft',
      terms: plan.terms,
      accepted_at: plan.accepted_at,
      accepted_by: plan.accepted_by,
      scope: scope.results,
      payments: payments.results,
      extras: extras.results.map(e => ({ ...e, visible: !!e.visible })),
      money: await moneyOf(ctx.db, id, { includeHidden: owner }),
    },
  });
}

// Any change to what was agreed sends an accepted agreement back for acceptance.
async function agreementChanged(ctx, planId, what) {
  const plan = await ctx.db.prepare('SELECT agreement_status, title FROM plans WHERE id = ?').bind(planId).first();
  await ctx.db.prepare('UPDATE plans SET updated_at = ? WHERE id = ?').bind(now(), planId).run();
  if (plan.agreement_status !== 'accepted') return;
  await ctx.db.prepare(`UPDATE plans SET agreement_status = 'shared', accepted_at = NULL, accepted_by = NULL WHERE id = ?`).bind(planId).run();
  await logActivity(ctx.db, { planId, ...userActor(ctx.user), action: 'agreement_reopened', refType: 'plan', refId: planId, summary: `Agreement for ${plan.title} changed (${what}) and needs to be accepted again` });
}

async function updateAgreement(ctx, { id }) {
  const user = requireOwner(ctx);
  const plan = await requirePlanAccess(ctx, id);
  const body = await readJson(ctx.request);
  if (body.terms !== undefined) {
    const terms = text(body.terms, 'Terms', { max: 20000, required: false });
    if (terms !== plan.terms) {
      await ctx.db.prepare('UPDATE plans SET terms = ? WHERE id = ?').bind(terms, id).run();
      await agreementChanged(ctx, id, 'terms');
    }
  }
  if (body.status !== undefined) {
    const status = oneOf(body.status, ['draft', 'shared'], 'status');
    await ctx.db.prepare(`UPDATE plans SET agreement_status = ?, accepted_at = NULL, accepted_by = NULL, updated_at = ? WHERE id = ?`).bind(status, now(), id).run();
    if (status === 'shared') {
      await logActivity(ctx.db, { planId: id, ...userActor(user), action: 'agreement_shared', refType: 'plan', refId: id, summary: `Agreement for ${plan.title} shared with the client` });
    }
  }
  return json({ ok: true });
}

async function acceptAgreement(ctx, { id }) {
  const plan = await requirePlanAccess(ctx, id);
  if (isOwner(ctx.user)) throw new HttpError(400, 'The client accepts the agreement, not the owner');
  if (plan.agreement_status !== 'shared') throw new HttpError(409, plan.agreement_status === 'accepted' ? 'Already accepted' : 'The agreement is not ready yet');
  const t = now();
  await ctx.db.prepare(`UPDATE plans SET agreement_status = 'accepted', accepted_at = ?, accepted_by = ?, updated_at = ? WHERE id = ?`)
    .bind(t, `${ctx.user.name} (${ctx.user.email})`, t, id).run();
  const money = await moneyOf(ctx.db, id);
  await logActivity(ctx.db, { planId: id, ...userActor(ctx.user), action: 'agreement_accepted', refType: 'plan', refId: id, summary: `${ctx.user.name} accepted the agreement for ${plan.title} (${dollars(money.total_cents)} total)` });
  return json({ ok: true, accepted_at: t });
}

async function ownedRow(ctx, table, id) {
  requireOwner(ctx);
  const row = await ctx.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

const nextPos = async (db, table, planId) => (await db.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ${table} WHERE plan_id = ?`).bind(planId).first()).p;

async function createScope(ctx, { id }) {
  requireOwner(ctx);
  await requirePlanAccess(ctx, id);
  const body = await readJson(ctx.request);
  const itemId = newId();
  await ctx.db.prepare('INSERT INTO scope_items (id, plan_id, title, detail, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(itemId, id, text(body.title, 'Item', { max: 300 }), text(body.detail, 'Detail', { max: 2000, required: false }), await nextPos(ctx.db, 'scope_items', id), now()).run();
  await agreementChanged(ctx, id, 'scope');
  return json({ id: itemId }, 201);
}

async function updateScope(ctx, { id }) {
  const row = await ownedRow(ctx, 'scope_items', id);
  const body = await readJson(ctx.request);
  await ctx.db.prepare('UPDATE scope_items SET title = ?, detail = ? WHERE id = ?').bind(
    body.title !== undefined ? text(body.title, 'Item', { max: 300 }) : row.title,
    body.detail !== undefined ? text(body.detail, 'Detail', { max: 2000, required: false }) : row.detail,
    id,
  ).run();
  await agreementChanged(ctx, row.plan_id, 'scope');
  return json({ ok: true });
}

async function deleteScope(ctx, { id }) {
  const row = await ownedRow(ctx, 'scope_items', id);
  await ctx.db.prepare('DELETE FROM scope_items WHERE id = ?').bind(id).run();
  await agreementChanged(ctx, row.plan_id, 'scope');
  return json({ ok: true });
}

async function createPayment(ctx, { id }) {
  requireOwner(ctx);
  await requirePlanAccess(ctx, id);
  const body = await readJson(ctx.request);
  const payId = newId();
  await ctx.db.prepare('INSERT INTO payments (id, plan_id, label, amount_cents, due_date, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(payId, id, text(body.label, 'Payment name', { max: 200 }), toCents(body.amount, 'Amount'), dateOrNull(body.due_date, 'Due date'), await nextPos(ctx.db, 'payments', id), now()).run();
  await agreementChanged(ctx, id, 'payment plan');
  return json({ id: payId }, 201);
}

// Marking paid or unpaid is bookkeeping and does not reopen the agreement; changing amounts does.
async function updatePayment(ctx, { id }) {
  const row = await ownedRow(ctx, 'payments', id);
  const body = await readJson(ctx.request);
  const label = body.label !== undefined ? text(body.label, 'Payment name', { max: 200 }) : row.label;
  const amount = body.amount !== undefined ? toCents(body.amount, 'Amount') : row.amount_cents;
  const due = body.due_date !== undefined ? dateOrNull(body.due_date, 'Due date') : row.due_date;
  const paidAt = body.paid === undefined ? row.paid_at : body.paid ? (row.paid_at || now()) : null;
  await ctx.db.prepare('UPDATE payments SET label = ?, amount_cents = ?, due_date = ?, paid_at = ? WHERE id = ?').bind(label, amount, due, paidAt, id).run();
  if (label !== row.label || amount !== row.amount_cents || due !== row.due_date) await agreementChanged(ctx, row.plan_id, 'payment plan');
  if (body.paid !== undefined && !!paidAt !== !!row.paid_at) {
    await logActivity(ctx.db, { planId: row.plan_id, ...userActor(ctx.user), action: paidAt ? 'payment_paid' : 'payment_unpaid', refType: 'payment', refId: id, summary: `${label} (${dollars(amount)}) marked ${paidAt ? 'paid' : 'unpaid'}` });
  }
  return json({ ok: true });
}

async function deletePayment(ctx, { id }) {
  const row = await ownedRow(ctx, 'payments', id);
  await ctx.db.prepare(`UPDATE extras SET billing = 'unbilled', payment_id = NULL WHERE payment_id = ?`).bind(id).run();
  await ctx.db.prepare('DELETE FROM payments WHERE id = ?').bind(id).run();
  await agreementChanged(ctx, row.plan_id, 'payment plan');
  return json({ ok: true });
}

const BILLING = ['unbilled', 'billed', 'no_charge'];

async function createExtra(ctx, { id }) {
  const user = requireOwner(ctx);
  const plan = await requirePlanAccess(ctx, id);
  const body = await readJson(ctx.request);
  const hours = body.hours === undefined || body.hours === '' || body.hours === null ? null : Number(body.hours);
  if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 1000)) throw new HttpError(400, 'Hours must be a number');
  const extraId = newId();
  const title = text(body.title, 'What you did', { max: 300 });
  const billing = oneOf(body.billing || 'unbilled', BILLING.filter(b => b !== 'billed'), 'billing');
  await ctx.db.prepare(
    'INSERT INTO extras (id, plan_id, work_date, title, detail, hours, amount_cents, billing, visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    extraId, id, dateOrNull(body.work_date, 'Date') || now().slice(0, 10), title, text(body.detail, 'Detail', { max: 4000, required: false }),
    hours, toCents(body.amount, 'Amount', { required: false }), billing, body.visible === false ? 0 : 1, now(),
  ).run();
  await ctx.db.prepare('UPDATE plans SET updated_at = ? WHERE id = ?').bind(now(), id).run();
  await logActivity(ctx.db, { planId: id, ...userActor(user), action: 'extra_logged', refType: 'extra', refId: extraId, summary: `Extra work logged on ${plan.title}: ${title}` });
  return json({ id: extraId }, 201);
}

async function updateExtra(ctx, { id }) {
  const row = await ownedRow(ctx, 'extras', id);
  const body = await readJson(ctx.request);
  const billing = body.billing !== undefined ? oneOf(body.billing, BILLING, 'billing') : row.billing;
  if (row.billing === 'billed' && billing !== 'billed') throw new HttpError(409, 'This was billed. Delete its payment line to change it.');
  if (billing === 'billed' && row.billing !== 'billed') throw new HttpError(400, 'Use "Bill it" so the amount is added to the payments');
  await ctx.db.prepare('UPDATE extras SET work_date = ?, title = ?, detail = ?, hours = ?, amount_cents = ?, billing = ?, visible = ? WHERE id = ?').bind(
    body.work_date !== undefined ? dateOrNull(body.work_date, 'Date', { required: true }) : row.work_date,
    body.title !== undefined ? text(body.title, 'What you did', { max: 300 }) : row.title,
    body.detail !== undefined ? text(body.detail, 'Detail', { max: 4000, required: false }) : row.detail,
    body.hours !== undefined ? (body.hours === '' || body.hours === null ? null : Number(body.hours)) : row.hours,
    body.amount !== undefined ? toCents(body.amount, 'Amount', { required: false }) : row.amount_cents,
    billing,
    body.visible !== undefined ? (body.visible ? 1 : 0) : row.visible,
    id,
  ).run();
  return json({ ok: true });
}

async function deleteExtra(ctx, { id }) {
  const row = await ownedRow(ctx, 'extras', id);
  if (row.billing === 'billed') throw new HttpError(409, 'This was billed. Delete its payment line first.');
  await ctx.db.prepare('DELETE FROM extras WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// Turn logged extra work into a payment line, so it becomes part of the balance owed.
async function billExtra(ctx, { id }) {
  const row = await ownedRow(ctx, 'extras', id);
  if (row.billing === 'billed') throw new HttpError(409, 'Already billed');
  const body = await readJson(ctx.request);
  const amount = body.amount !== undefined ? toCents(body.amount, 'Amount') : row.amount_cents;
  if (!amount) throw new HttpError(400, 'Set an amount to bill');
  const payId = newId();
  await ctx.db.prepare('INSERT INTO payments (id, plan_id, label, amount_cents, due_date, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(payId, row.plan_id, `Extra: ${row.title}`.slice(0, 200), amount, dateOrNull(body.due_date, 'Due date'), await nextPos(ctx.db, 'payments', row.plan_id), now()).run();
  await ctx.db.prepare(`UPDATE extras SET billing = 'billed', amount_cents = ?, payment_id = ?, visible = 1 WHERE id = ?`).bind(amount, payId, id).run();
  await logActivity(ctx.db, { planId: row.plan_id, ...userActor(ctx.user), action: 'extra_billed', refType: 'payment', refId: payId, summary: `Extra work billed: ${row.title} (${dollars(amount)})` });
  return json({ payment_id: payId }, 201);
}
