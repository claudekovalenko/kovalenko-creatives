// API for bots ("agents") that watch the portal and report to the owner.
// Agents authenticate with a token the owner creates on the dashboard (Authorization: Bearer kca_...).
// They can read plans and activity and send proposals to the owner. They cannot post to members,
// change plans or approve anything: every proposal waits for the owner's decision.
import { HttpError, json, now, newId, sha256Hex, readJson, text, oneOf } from './util.js';
import { route } from './router.js';
import { loadPlan, logActivity } from './data.js';
import { proposalRows, buildSummary } from './admin.js';

export async function currentAgent(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token.startsWith('kca_')) throw new HttpError(401, 'Agent token required');
  const agent = await env.DB.prepare('SELECT * FROM agents WHERE token_hash = ? AND revoked_at IS NULL').bind(await sha256Hex(token)).first();
  if (!agent) throw new HttpError(401, 'Agent token is invalid or revoked');
  await env.DB.prepare('UPDATE agents SET last_seen_at = ? WHERE id = ?').bind(now(), agent.id).run();
  return agent;
}

export const agentRoutes = ctx => route(ctx, [
  ['GET', '/api/agent/activity', activity],
  ['GET', '/api/agent/plans', plans],
  ['GET', '/api/agent/plans/:id', plan],
  ['GET', '/api/agent/summary', summary],
  ['GET', '/api/agent/proposals', listProposals],
  ['POST', '/api/agent/proposals', createProposal],
  ['PATCH', '/api/agent/proposals/:id', updateProposal],
]);

// New activity after a cursor. Agents remember the last id they handled and pass it back as after_id.
async function activity(ctx) {
  const after = Number(ctx.url.searchParams.get('after_id')) || 0;
  const limit = Math.min(Number(ctx.url.searchParams.get('limit')) || 100, 500);
  const rows = (await ctx.db.prepare(
    `SELECT a.id, a.plan_id, p.title AS plan_title, a.actor_type, a.actor_name, a.action, a.ref_type, a.ref_id, a.summary, a.created_at
     FROM activity a LEFT JOIN plans p ON p.id = a.plan_id
     WHERE a.id > ? AND NOT (a.actor_type = 'agent' AND a.actor_id = ?) ORDER BY a.id LIMIT ?`,
  ).bind(after, ctx.agent.id, limit).all()).results;
  // Post bodies in full, so the agent can judge comments and ideas.
  for (const r of rows) {
    if (r.ref_type === 'post') {
      const post = await ctx.db.prepare('SELECT kind, task_id, body FROM posts WHERE id = ?').bind(r.ref_id).first();
      if (post) r.post = post;
    }
  }
  return json({ activity: rows, next_after_id: rows.length ? rows[rows.length - 1].id : after });
}

async function plans(ctx) {
  return json({ plans: (await ctx.db.prepare('SELECT id, title, summary, status, updated_at FROM plans ORDER BY updated_at DESC').all()).results });
}

async function plan(ctx, { id }) {
  const row = await ctx.db.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Plan not found');
  const recent = (await ctx.db.prepare(
    'SELECT id, task_id, kind, author_name, body, created_at FROM posts WHERE plan_id = ? ORDER BY created_at DESC LIMIT 100',
  ).bind(id).all()).results.reverse();
  return json({ plan: await loadPlan(ctx.db, row), recent_posts: recent });
}

async function summary(ctx) {
  const days = Math.min(Math.max(Number(ctx.url.searchParams.get('days')) || 7, 1), 90);
  return json({ summary: await buildSummary(ctx.db, days) });
}

// This agent's own proposals, e.g. ?status=approved to pick up work the owner said yes to.
async function listProposals(ctx) {
  const status = ctx.url.searchParams.get('status');
  const rows = status
    ? await proposalRows(ctx.db, 'p.agent_id = ? AND p.status = ?', [ctx.agent.id, oneOf(status, ['proposed', 'approved', 'declined', 'in_progress', 'done'], 'status')])
    : await proposalRows(ctx.db, 'p.agent_id = ?', [ctx.agent.id]);
  return json({ proposals: rows });
}

async function createProposal(ctx) {
  const body = await readJson(ctx.request);
  const kind = oneOf(body.kind || 'fix', ['fix', 'summary', 'note'], 'kind');
  const title = text(body.title, 'title', { max: 200 });
  const detail = text(body.body, 'body', { max: 8000 });
  let planId = null;
  let taskId = null;
  let postId = null;
  if (body.plan_id) {
    const p = await ctx.db.prepare('SELECT id FROM plans WHERE id = ?').bind(body.plan_id).first();
    if (!p) throw new HttpError(400, 'Unknown plan_id');
    planId = p.id;
  }
  if (body.task_id) {
    const t = await ctx.db.prepare('SELECT id, plan_id FROM tasks WHERE id = ?').bind(body.task_id).first();
    if (!t) throw new HttpError(400, 'Unknown task_id');
    taskId = t.id;
    planId = planId || t.plan_id;
  }
  if (body.post_id) {
    const p = await ctx.db.prepare('SELECT id, plan_id FROM posts WHERE id = ?').bind(body.post_id).first();
    if (!p) throw new HttpError(400, 'Unknown post_id');
    postId = p.id;
    planId = planId || p.plan_id;
  }
  // The same agent should not file the same thing twice about the same post.
  if (postId) {
    const dup = await ctx.db.prepare(`SELECT id FROM proposals WHERE agent_id = ? AND post_id = ? AND kind = ?`).bind(ctx.agent.id, postId, kind).first();
    if (dup) return json({ id: dup.id, duplicate: true });
  }
  const confidence = typeof body.confidence === 'number' ? Math.min(Math.max(body.confidence, 0), 1) : null;
  const id = newId();
  const t = now();
  await ctx.db.prepare(
    `INSERT INTO proposals (id, agent_id, plan_id, task_id, post_id, kind, title, body, confidence, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
  ).bind(id, ctx.agent.id, planId, taskId, postId, kind, title, detail, confidence, t, t).run();
  await logActivity(ctx.db, { planId, actorType: 'agent', actorId: ctx.agent.id, actorName: ctx.agent.name, action: 'proposal_created', refType: 'proposal', refId: id, summary: `${ctx.agent.name} proposed: ${title}` });
  return json({ id }, 201);
}

// Agents report progress on work the owner approved: in_progress, then done (with a note on what changed).
async function updateProposal(ctx, { id }) {
  const p = await ctx.db.prepare('SELECT * FROM proposals WHERE id = ? AND agent_id = ?').bind(id, ctx.agent.id).first();
  if (!p) throw new HttpError(404, 'Proposal not found');
  const body = await readJson(ctx.request);
  const status = oneOf(body.status, ['in_progress', 'done'], 'status');
  if (!['approved', 'in_progress'].includes(p.status)) throw new HttpError(409, 'Only approved proposals can be worked on');
  const note = text(body.note, 'note', { max: 4000, required: false });
  await ctx.db.prepare('UPDATE proposals SET status = ?, agent_note = ?, updated_at = ? WHERE id = ?').bind(status, note || p.agent_note, now(), id).run();
  await logActivity(ctx.db, { planId: p.plan_id, actorType: 'agent', actorId: ctx.agent.id, actorName: ctx.agent.name, action: `proposal_${status}`, refType: 'proposal', refId: id, summary: `${ctx.agent.name} ${status === 'done' ? 'finished' : 'started'}: ${p.title}${note ? ` (${note.slice(0, 200)})` : ''}` });
  return json({ ok: true });
}
