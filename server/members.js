// What signed-in people can do: see their status, ask to join, view plans, chat, comment and suggest ideas.
// Owner-only plan editing (phases, tasks, updates) also lives here because it uses the same plan routes.
import { HttpError, json, now, newId, readJson, text, oneOf } from './util.js';
import { route } from './router.js';
import { requireUser, requireApproved, requireOwner, requirePlanAccess, isOwner, logActivity, userActor, loadPlan, progressOf, publicUser, moneyOf, unreadOf, markRead } from './data.js';
import { summarizeLater } from './summarize.js';
import { agreementRoutes } from './agreements.js';

export const memberRoutes = ctx => route(ctx, [
  ['GET', '/api/me', me],
  ['POST', '/api/me/request', requestAccess],
  ['GET', '/api/plans', listPlans],
  ['POST', '/api/plans', createPlan],
  ['GET', '/api/plans/:id', getPlan],
  ['PATCH', '/api/plans/:id', updatePlan],
  ['POST', '/api/plans/:id/join', joinPlan],
  ['POST', '/api/plans/:id/phases', createPhase],
  ['PATCH', '/api/phases/:id', updatePhase],
  ['POST', '/api/plans/:id/tasks', createTask],
  ['PATCH', '/api/tasks/:id', updateTask],
  ['DELETE', '/api/tasks/:id', deleteTask],
  ['GET', '/api/plans/:id/posts', listPosts],
  ['POST', '/api/plans/:id/posts', createPost],
  ['DELETE', '/api/posts/:id', deletePost],
  ...agreementRoutes,
]);

async function me(ctx) {
  return json({ user: publicUser(ctx.user) });
}

// A pending person can leave a short note for the owner ("I'm from the church team").
async function requestAccess(ctx) {
  const user = requireUser(ctx);
  if (user.status !== 'pending') throw new HttpError(400, 'Your access has already been decided');
  const note = text((await readJson(ctx.request)).note, 'Note', { max: 500, required: false });
  await ctx.db.prepare('UPDATE users SET request_note = ? WHERE id = ?').bind(note, user.id).run();
  await logActivity(ctx.db, { ...userActor(user), action: 'requested_access', refType: 'user', refId: user.id, summary: `${user.name} asked for access${note ? `: "${note}"` : ''}` });
  return json({ ok: true });
}

async function listPlans(ctx) {
  const user = requireApproved(ctx);
  // Members only ever see plans of their own client (or plans with no client they were approved for).
  const plans = isOwner(user)
    ? (await ctx.db.prepare(
      `SELECT p.*, 'approved' AS membership, c.name AS client_name FROM plans p LEFT JOIN clients c ON c.id = p.client_id
       ORDER BY p.status = 'done', p.updated_at DESC`,
    ).all()).results
    : (await ctx.db.prepare(
      `SELECT p.*, m.status AS membership, c.name AS client_name FROM plans p
       LEFT JOIN plan_members m ON m.plan_id = p.id AND m.user_id = ? LEFT JOIN clients c ON c.id = p.client_id
       WHERE (p.client_id IS NULL OR p.client_id = ?)
         AND (m.status = 'approved' OR (p.listed = 1 AND p.status != 'done' AND p.client_id IS NOT NULL))
       ORDER BY p.updated_at DESC`,
    ).bind(user.id, user.client_id || '').all()).results;
  const out = [];
  for (const p of plans) {
    const canSee = p.membership === 'approved';
    const item = { id: p.id, title: p.title, status: p.status, listed: !!p.listed, membership: p.membership || null, updated_at: p.updated_at, client_id: p.client_id, client_name: p.client_name || null };
    if (canSee) {
      const tasks = (await ctx.db.prepare('SELECT status FROM tasks WHERE plan_id = ?').bind(p.id).all()).results;
      const showMoney = isOwner(user) || p.agreement_status !== 'draft';
      Object.assign(item, {
        summary: p.summary,
        progress: progressOf(tasks),
        unread: await unreadOf(ctx.db, p.id, user.id),
        agreement_status: p.agreement_status,
        money: showMoney ? await moneyOf(ctx.db, p.id, { includeHidden: isOwner(user) }) : null,
      });
    }
    out.push(item);
  }
  return json({ plans: out });
}

async function createPlan(ctx) {
  const user = requireOwner(ctx);
  const body = await readJson(ctx.request);
  const id = newId();
  const t = now();
  await ctx.db.prepare('INSERT INTO plans (id, title, summary, status, listed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, text(body.title, 'Title', { max: 120 }), text(body.summary, 'Summary', { max: 2000, required: false }), 'active', body.listed === false ? 0 : 1, t, t).run();
  await logActivity(ctx.db, { planId: id, ...userActor(user), action: 'plan_created', refType: 'plan', refId: id, summary: `New plan: ${body.title}` });
  return json({ id }, 201);
}

async function getPlan(ctx, { id }) {
  const plan = await requirePlanAccess(ctx, id);
  const client = plan.client_id ? await ctx.db.prepare('SELECT name FROM clients WHERE id = ?').bind(plan.client_id).first() : null;
  return json({ plan: { ...(await loadPlan(ctx.db, plan)), client_name: client?.name || null, unread: await unreadOf(ctx.db, id, ctx.user.id) } });
}

async function updatePlan(ctx, { id }) {
  const user = requireOwner(ctx);
  const plan = await requirePlanAccess(ctx, id);
  const body = await readJson(ctx.request);
  const next = {
    title: body.title !== undefined ? text(body.title, 'Title', { max: 120 }) : plan.title,
    summary: body.summary !== undefined ? text(body.summary, 'Summary', { max: 2000, required: false }) : plan.summary,
    status: body.status !== undefined ? oneOf(body.status, ['active', 'paused', 'done'], 'Status') : plan.status,
    listed: body.listed !== undefined ? (body.listed ? 1 : 0) : plan.listed,
    client_id: body.client_id !== undefined ? await clientOrNull(ctx.db, body.client_id) : plan.client_id,
  };
  await ctx.db.prepare('UPDATE plans SET title = ?, summary = ?, status = ?, listed = ?, client_id = ?, updated_at = ? WHERE id = ?')
    .bind(next.title, next.summary, next.status, next.listed, next.client_id, now(), id).run();
  await logActivity(ctx.db, { planId: id, ...userActor(user), action: 'plan_updated', refType: 'plan', refId: id, summary: `Plan details updated: ${next.title}` });
  return json({ ok: true });
}

// "Ask to join": an approved member asks for a listed plan; the owner decides.
async function joinPlan(ctx, { id }) {
  const user = requireApproved(ctx);
  const plan = await ctx.db.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();
  // Only listed plans of the person's own client can be asked for, so clients never see each other's work.
  if (!plan || (!isOwner(user) && (!plan.listed || !plan.client_id || plan.client_id !== user.client_id))) throw new HttpError(404, 'Plan not found');
  const existing = await ctx.db.prepare('SELECT status FROM plan_members WHERE plan_id = ? AND user_id = ?').bind(id, user.id).first();
  if (existing?.status === 'approved') return json({ status: 'approved' });
  const note = text((await readJson(ctx.request)).note, 'Note', { max: 500, required: false });
  await ctx.db.prepare(
    `INSERT INTO plan_members (plan_id, user_id, status, note, requested_at) VALUES (?, ?, 'pending', ?, ?)
     ON CONFLICT (plan_id, user_id) DO UPDATE SET status = 'pending', note = excluded.note, requested_at = excluded.requested_at, decided_at = NULL`,
  ).bind(id, user.id, note, now()).run();
  await logActivity(ctx.db, { planId: id, ...userActor(user), action: 'join_requested', refType: 'plan', refId: id, summary: `${user.name} asked to join ${plan.title}${note ? `: "${note}"` : ''}` });
  return json({ status: 'pending' });
}

async function createPhase(ctx, { id }) {
  const user = requireOwner(ctx);
  await requirePlanAccess(ctx, id);
  const body = await readJson(ctx.request);
  const pos = (await ctx.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM phases WHERE plan_id = ?').bind(id).first()).p;
  const phaseId = newId();
  const title = text(body.title, 'Phase name', { max: 120 });
  await ctx.db.prepare('INSERT INTO phases (id, plan_id, title, position) VALUES (?, ?, ?, ?)').bind(phaseId, id, title, pos).run();
  await touchPlan(ctx.db, id);
  await logActivity(ctx.db, { planId: id, ...userActor(user), action: 'phase_created', refType: 'phase', refId: phaseId, summary: `New phase: ${title}` });
  return json({ id: phaseId }, 201);
}

async function updatePhase(ctx, { id }) {
  requireOwner(ctx);
  const phase = await ctx.db.prepare('SELECT * FROM phases WHERE id = ?').bind(id).first();
  if (!phase) throw new HttpError(404, 'Phase not found');
  const title = text((await readJson(ctx.request)).title, 'Phase name', { max: 120 });
  await ctx.db.prepare('UPDATE phases SET title = ? WHERE id = ?').bind(title, id).run();
  await touchPlan(ctx.db, phase.plan_id);
  return json({ ok: true });
}

async function createTask(ctx, { id }) {
  const user = requireOwner(ctx);
  const plan = await requirePlanAccess(ctx, id);
  const body = await readJson(ctx.request);
  const title = text(body.title, 'Task', { max: 300 });
  const phaseId = body.phase_id ? await phaseOf(ctx.db, plan.id, body.phase_id) : null;
  const pos = (await ctx.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE plan_id = ?').bind(id).first()).p;
  const taskId = newId();
  const t = now();
  await ctx.db.prepare('INSERT INTO tasks (id, plan_id, phase_id, title, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(taskId, id, phaseId, title, 'todo', pos, t, t).run();
  await touchPlan(ctx.db, id);
  await logActivity(ctx.db, { planId: id, ...userActor(user), action: 'task_created', refType: 'task', refId: taskId, summary: `New task: ${title}` });
  return json({ id: taskId }, 201);
}

async function phaseOf(db, planId, phaseId) {
  const p = await db.prepare('SELECT id FROM phases WHERE id = ? AND plan_id = ?').bind(phaseId, planId).first();
  if (!p) throw new HttpError(400, 'That phase is not part of this plan');
  return p.id;
}

const STATUS_WORDS = { todo: 'moved back to to-do', doing: 'started', done: 'completed' };

async function updateTask(ctx, { id }) {
  const user = requireOwner(ctx);
  const task = await ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!task) throw new HttpError(404, 'Task not found');
  const body = await readJson(ctx.request);
  const status = body.status !== undefined ? oneOf(body.status, ['todo', 'doing', 'done'], 'Status') : task.status;
  const title = body.title !== undefined ? text(body.title, 'Task', { max: 300 }) : task.title;
  const phaseId = body.phase_id !== undefined ? (body.phase_id ? await phaseOf(ctx.db, task.plan_id, body.phase_id) : null) : task.phase_id;
  const doneAt = status === 'done' ? (task.status === 'done' ? task.done_at : now()) : null;
  await ctx.db.prepare('UPDATE tasks SET title = ?, status = ?, phase_id = ?, done_at = ?, updated_at = ? WHERE id = ?')
    .bind(title, status, phaseId, doneAt, now(), id).run();
  await touchPlan(ctx.db, task.plan_id);
  if (status !== task.status) {
    await logActivity(ctx.db, { planId: task.plan_id, ...userActor(user), action: `task_${status}`, refType: 'task', refId: id, summary: `Task ${STATUS_WORDS[status]}: ${title}` });
  }
  return json({ ok: true });
}

async function deleteTask(ctx, { id }) {
  const user = requireOwner(ctx);
  const task = await ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!task) throw new HttpError(404, 'Task not found');
  await ctx.db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  await touchPlan(ctx.db, task.plan_id);
  await logActivity(ctx.db, { planId: task.plan_id, ...userActor(user), action: 'task_deleted', refType: 'task', refId: id, summary: `Task removed: ${task.title}` });
  return json({ ok: true });
}

// Posts: kind=message (chat, or a task comment when task_id is given), update (owner only), idea.
async function listPosts(ctx, { id }) {
  await requirePlanAccess(ctx, id);
  const kind = ctx.url.searchParams.get('kind') || 'message';
  oneOf(kind, ['message', 'update', 'idea'], 'kind');
  const task = ctx.url.searchParams.get('task');
  const after = ctx.url.searchParams.get('after') || '';
  const rows = (await ctx.db.prepare(
    `SELECT p.id, p.task_id, p.kind, p.user_id, p.author_name, p.body, p.summary, p.created_at, u.role AS author_role
     FROM posts p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.plan_id = ? AND p.kind = ? AND ${task ? 'p.task_id = ?' : 'p.task_id IS NULL'} AND p.created_at > ?
     ORDER BY p.created_at DESC LIMIT 200`,
  ).bind(...[id, kind, task, after].filter(v => v !== null)).all()).results.reverse();
  if (kind === 'message' && !task) await markRead(ctx.db, id, ctx.user.id);
  return json({ posts: rows.map(r => ({ ...r, mine: r.user_id === ctx.user.id })) });
}

const KIND_WORDS = { message: 'wrote', update: 'posted an update', idea: 'suggested an idea' };

async function createPost(ctx, { id }) {
  const plan = await requirePlanAccess(ctx, id);
  const user = ctx.user;
  const body = await readJson(ctx.request);
  const kind = oneOf(body.kind || 'message', ['message', 'update', 'idea'], 'kind');
  if (kind === 'update' && !isOwner(user)) throw new HttpError(403, 'Only the owner posts progress updates');
  let taskId = null;
  let taskTitle = '';
  if (body.task_id) {
    const task = await ctx.db.prepare('SELECT id, title FROM tasks WHERE id = ? AND plan_id = ?').bind(body.task_id, id).first();
    if (!task) throw new HttpError(400, 'That task is not part of this plan');
    if (kind !== 'message') throw new HttpError(400, 'Task comments are plain messages');
    taskId = task.id;
    taskTitle = task.title;
  }
  const text_ = text(body.body, 'Message', { max: 4000 });
  const postId = newId();
  const t = now();
  await ctx.db.prepare('INSERT INTO posts (id, plan_id, task_id, kind, user_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(postId, id, taskId, kind, user.id, user.name, text_, t).run();
  await touchPlan(ctx.db, id);
  const where = taskId ? ` on "${taskTitle}"` : ` in ${plan.title}`;
  await logActivity(ctx.db, {
    planId: id, ...userActor(user), action: taskId ? 'task_comment' : `post_${kind}`, refType: 'post', refId: postId,
    summary: `${user.name} ${taskId ? 'commented' : KIND_WORDS[kind]}${where}: ${text_.slice(0, 300)}`,
  });
  summarizeLater(ctx, postId, text_);
  return json({ post: { id: postId, task_id: taskId, kind, user_id: user.id, author_name: user.name, author_role: user.role, body: text_, created_at: t, mine: true } }, 201);
}

async function deletePost(ctx, { id }) {
  const user = requireApproved(ctx);
  const post = await ctx.db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
  if (!post) throw new HttpError(404, 'Not found');
  if (post.user_id !== user.id && !isOwner(user)) throw new HttpError(403, 'You can only remove your own posts');
  await requirePlanAccess(ctx, post.plan_id);
  await ctx.db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function clientOrNull(db, clientId) {
  if (!clientId) return null;
  const c = await db.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first();
  if (!c) throw new HttpError(400, 'Unknown client');
  return c.id;
}

const touchPlan = (db, id) => db.prepare('UPDATE plans SET updated_at = ? WHERE id = ?').bind(now(), id).run();
