// Access rules and shared queries for the portal.
import { HttpError, now } from './util.js';

export function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Please sign in');
  return ctx.user;
}

export function requireApproved(ctx) {
  const user = requireUser(ctx);
  if (user.status !== 'approved') throw new HttpError(403, 'Your access is waiting for approval');
  return user;
}

export function requireOwner(ctx) {
  const user = requireApproved(ctx);
  if (user.role !== 'owner') throw new HttpError(403, 'Only the owner can do that');
  return user;
}

export const isOwner = user => user?.role === 'owner' && user.status === 'approved';

// A plan's contents are visible to the owner and to members the owner approved for that plan.
export async function requirePlanAccess(ctx, planId) {
  const user = requireApproved(ctx);
  const plan = await ctx.db.prepare('SELECT * FROM plans WHERE id = ?').bind(planId).first();
  if (!plan) throw new HttpError(404, 'Plan not found');
  if (isOwner(user)) return plan;
  const m = await ctx.db.prepare('SELECT status FROM plan_members WHERE plan_id = ? AND user_id = ?').bind(planId, user.id).first();
  if (m?.status !== 'approved') throw new HttpError(403, 'You have not been approved for this plan yet');
  // Client silo: a plan that belongs to a client is only ever visible to that client's people.
  if (plan.client_id && plan.client_id !== user.client_id) throw new HttpError(403, 'You have not been approved for this plan yet');
  return plan;
}

export async function logActivity(db, { planId = null, actorType, actorId = null, actorName, action, refType = null, refId = null, summary }) {
  await db.prepare(
    `INSERT INTO activity (plan_id, actor_type, actor_id, actor_name, action, ref_type, ref_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(planId, actorType, actorId, actorName, action, refType, refId, summary.slice(0, 500), now()).run();
}

export const userActor = user => ({ actorType: 'user', actorId: user.id, actorName: user.name });

// The full plan as members see it: phases with their tasks, progress and comment counts.
export async function loadPlan(db, plan) {
  const [phases, tasks, counts] = await Promise.all([
    db.prepare('SELECT id, title, position FROM phases WHERE plan_id = ? ORDER BY position, title').bind(plan.id).all(),
    db.prepare('SELECT id, phase_id, title, status, position, done_at, updated_at FROM tasks WHERE plan_id = ? ORDER BY position, created_at').bind(plan.id).all(),
    db.prepare(`SELECT task_id, COUNT(*) AS n FROM posts WHERE plan_id = ? AND task_id IS NOT NULL GROUP BY task_id`).bind(plan.id).all(),
  ]);
  const commentCount = Object.fromEntries(counts.results.map(r => [r.task_id, r.n]));
  const list = tasks.results.map(t => ({ ...t, comments: commentCount[t.id] || 0 }));
  // Agreement terms and money are served only by the agreement routes (and never to agents).
  const { id, title, summary, status, client_id, agreement_status, created_at, updated_at } = plan;
  return { id, title, summary, status, client_id, agreement_status, created_at, updated_at, listed: !!plan.listed, progress: progressOf(list), phases: phases.results, tasks: list };
}

export function progressOf(tasks) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const doing = tasks.filter(t => t.status === 'doing').length;
  return { total, done, doing, percent: total ? Math.round((done / total) * 100) : 0 };
}

export const publicUser = u => u && ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, request_note: u.request_note || '', client_id: u.client_id || null });

// Money on a plan, in whole cents. Balance owed = unpaid payment lines. Extras not yet billed are
// listed separately, since they are not owed until the owner bills them.
export async function moneyOf(db, planId, { includeHidden = true } = {}) {
  const [payments, extras] = await Promise.all([
    db.prepare('SELECT label, amount_cents, due_date, paid_at FROM payments WHERE plan_id = ? ORDER BY position, created_at').bind(planId).all(),
    db.prepare(`SELECT amount_cents, hours, billing, visible FROM extras WHERE plan_id = ?${includeHidden ? '' : ' AND visible = 1'}`).bind(planId).all(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const lines = payments.results;
  const unpaid = lines.filter(p => !p.paid_at);
  const sum = list => list.reduce((n, p) => n + (p.amount_cents || 0), 0);
  const next = unpaid.filter(p => p.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null;
  const unbilled = extras.results.filter(e => e.billing === 'unbilled');
  return {
    total_cents: sum(lines),
    paid_cents: sum(lines.filter(p => p.paid_at)),
    owed_cents: sum(unpaid),
    due_now_cents: sum(unpaid.filter(p => p.due_date && p.due_date <= today)),
    next_due: next && { label: next.label, due_date: next.due_date, amount_cents: next.amount_cents },
    extras_count: extras.results.length,
    extras_unbilled_count: unbilled.length,
    extras_unbilled_cents: sum(unbilled),
    extras_unbilled_hours: unbilled.reduce((n, e) => n + (e.hours || 0), 0),
    extras_no_charge_count: extras.results.filter(e => e.billing === 'no_charge').length,
  };
}

export const dollars = cents => '$' + ((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Unread chat and comments for one person on one plan (their own posts never count).
export async function unreadOf(db, planId, userId) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM posts p WHERE p.plan_id = ? AND p.kind = 'message' AND (p.user_id IS NULL OR p.user_id != ?)
     AND p.created_at > COALESCE((SELECT last_read_at FROM plan_reads WHERE plan_id = ? AND user_id = ?), '')`,
  ).bind(planId, userId, planId, userId).first();
  return row.n;
}

export async function markRead(db, planId, userId) {
  await db.prepare(
    `INSERT INTO plan_reads (plan_id, user_id, last_read_at) VALUES (?, ?, ?) ON CONFLICT (plan_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
  ).bind(planId, userId, new Date().toISOString()).run();
}
