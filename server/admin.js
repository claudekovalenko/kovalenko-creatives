// Owner dashboard: approvals, people, agent proposals, agent tokens, activity and the summary digest.
import { HttpError, json, now, newId, randomToken, sha256Hex, readJson, text, oneOf } from './util.js';
import { route } from './router.js';
import { getSettings, saveSettings, contactFor, withinHours, hoursText } from './settings.js';
import { notifyOwner } from './notify.js';
import { createInvite, INVITE_DAYS } from './auth.js';
import { requireOwner, logActivity, userActor, progressOf, publicUser, moneyOf, dollars, unreadOf } from './data.js';

export const adminRoutes = ctx => {
  requireOwner(ctx);
  return route(ctx, [
    ['GET', '/api/admin/overview', overview],
    ['GET', '/api/admin/users', listUsers],
    ['POST', '/api/admin/users/:id', decideUser],
    ['POST', '/api/admin/memberships', decideMembership],
    ['GET', '/api/admin/activity', activity],
    ['GET', '/api/admin/proposals', listProposals],
    ['POST', '/api/admin/proposals/:id', decideProposal],
    ['GET', '/api/admin/agents', listAgents],
    ['POST', '/api/admin/agents', createAgent],
    ['DELETE', '/api/admin/agents/:id', revokeAgent],
    ['GET', '/api/admin/summary', summary],
    ['GET', '/api/admin/board', board],
    ['POST', '/api/admin/invites', invitePerson],
    ['POST', '/api/admin/users/:id/invite', reinvite],
    ['GET', '/api/admin/attention', attention],
    ['GET', '/api/admin/settings', readSettings],
    ['PUT', '/api/admin/settings', writeSettings],
    ['GET', '/api/admin/push/key', pushKey],
    ['POST', '/api/admin/push/subscribe', pushSubscribe],
    ['POST', '/api/admin/push/unsubscribe', pushUnsubscribe],
    ['POST', '/api/admin/push/test', pushTest],
    ['GET', '/api/admin/notifications', notificationLog],
    ['GET', '/api/admin/clients', listClients],
    ['POST', '/api/admin/clients', createClient],
    ['PATCH', '/api/admin/clients/:id', updateClient],
  ]);
};

// Everything that needs the owner's attention, in one request.
async function overview(ctx) {
  const db = ctx.db;
  const [pendingUsers, pendingJoins, proposals, digest] = await Promise.all([
    db.prepare(`SELECT * FROM users WHERE status = 'pending' ORDER BY created_at`).all(),
    db.prepare(
      `SELECT m.plan_id, m.user_id, m.note, m.requested_at, u.name, u.email, p.title AS plan_title
       FROM plan_members m JOIN users u ON u.id = m.user_id JOIN plans p ON p.id = m.plan_id
       WHERE m.status = 'pending' AND u.status = 'approved' ORDER BY m.requested_at`,
    ).all(),
    proposalRows(db, `p.status = 'proposed'`),
    buildSummary(db, 7, { money: true }),
  ]);
  return json({
    pending_users: pendingUsers.results.map(publicUser).map((u, i) => ({ ...u, created_at: pendingUsers.results[i].created_at })),
    pending_joins: pendingJoins.results,
    proposals,
    summary: digest,
  });
}

async function listUsers(ctx) {
  const rows = (await ctx.db.prepare(`SELECT * FROM users ORDER BY role = 'owner' DESC, status, name`).all()).results;
  const memberships = (await ctx.db.prepare(
    `SELECT m.plan_id, m.user_id, m.status, p.title FROM plan_members m JOIN plans p ON p.id = m.plan_id`,
  ).all()).results;
  return json({
    users: rows.map(u => ({ ...publicUser(u), created_at: u.created_at, last_seen_at: u.last_seen_at, plans: memberships.filter(m => m.user_id === u.id) })),
  });
}

// Approve or block a person's account; optionally approve them for some plans at the same time.
async function decideUser(ctx, { id }) {
  const owner = ctx.user;
  const body = await readJson(ctx.request);
  const status = oneOf(body.status, ['approved', 'blocked', 'pending'], 'status');
  const user = await ctx.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!user) throw new HttpError(404, 'Person not found');
  if (user.role === 'owner') throw new HttpError(400, 'Owner access is set with OWNER_EMAILS');
  if (body.client_id !== undefined) {
    const clientId = body.client_id ? (await ctx.db.prepare('SELECT id FROM clients WHERE id = ?').bind(body.client_id).first())?.id : null;
    if (body.client_id && !clientId) throw new HttpError(400, 'Unknown client');
    if (clientId !== user.client_id) {
      // Moving someone to another client ends their access to the old client's plans.
      await ctx.db.prepare('UPDATE users SET client_id = ? WHERE id = ?').bind(clientId, id).run();
      await ctx.db.prepare(`UPDATE plan_members SET status = 'declined' WHERE user_id = ? AND plan_id IN (SELECT id FROM plans WHERE client_id IS NOT NULL AND client_id IS NOT ?)`).bind(id, clientId).run();
    }
  }
  const t = now();
  await ctx.db.prepare('UPDATE users SET status = ?, approved_at = ? WHERE id = ?').bind(status, status === 'approved' ? t : null, id).run();
  if (status === 'blocked') await ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  for (const planId of Array.isArray(body.plan_ids) ? body.plan_ids.slice(0, 50) : []) {
    await setMembership(ctx.db, planId, id, 'approved');
  }
  await logActivity(ctx.db, { ...userActor(owner), action: `user_${status}`, refType: 'user', refId: id, summary: `${owner.name} ${status === 'approved' ? 'approved' : status === 'blocked' ? 'blocked' : 'reset'} ${user.name}` });
  return json({ ok: true });
}

// Client silo: a person can only be approved for plans of their own client. Someone with no
// client yet joins the plan's client the first time they are approved for one of its plans.
async function setMembership(db, planId, userId, status) {
  const plan = await db.prepare('SELECT id, client_id, title FROM plans WHERE id = ?').bind(planId).first();
  if (!plan) throw new HttpError(400, 'Unknown plan');
  if (status === 'approved' && plan.client_id) {
    const user = await db.prepare('SELECT client_id, name FROM users WHERE id = ?').bind(userId).first();
    if (user.client_id && user.client_id !== plan.client_id) throw new HttpError(409, `${user.name} belongs to another client, so they can't be added to ${plan.title}`);
    if (!user.client_id) await db.prepare('UPDATE users SET client_id = ? WHERE id = ?').bind(plan.client_id, userId).run();
  }
  const t = now();
  await db.prepare(
    `INSERT INTO plan_members (plan_id, user_id, status, requested_at, decided_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (plan_id, user_id) DO UPDATE SET status = excluded.status, decided_at = excluded.decided_at`,
  ).bind(planId, userId, status, t, t).run();
}

async function decideMembership(ctx) {
  const owner = ctx.user;
  const body = await readJson(ctx.request);
  const status = oneOf(body.status, ['approved', 'declined'], 'status');
  const user = await ctx.db.prepare('SELECT * FROM users WHERE id = ?').bind(String(body.user_id || '')).first();
  if (!user) throw new HttpError(404, 'Person not found');
  await setMembership(ctx.db, String(body.plan_id || ''), user.id, status);
  if (status === 'approved' && user.status === 'pending') {
    await ctx.db.prepare(`UPDATE users SET status = 'approved', approved_at = ? WHERE id = ?`).bind(now(), user.id).run();
  }
  const plan = await ctx.db.prepare('SELECT title FROM plans WHERE id = ?').bind(body.plan_id).first();
  await logActivity(ctx.db, { planId: body.plan_id, ...userActor(owner), action: `join_${status}`, refType: 'user', refId: user.id, summary: `${owner.name} ${status} ${user.name} for ${plan.title}` });
  return json({ ok: true });
}

async function activity(ctx) {
  const limit = Math.min(Number(ctx.url.searchParams.get('limit')) || 50, 200);
  const rows = (await ctx.db.prepare(
    `SELECT a.*, p.title AS plan_title FROM activity a LEFT JOIN plans p ON p.id = a.plan_id ORDER BY a.id DESC LIMIT ?`,
  ).bind(limit).all()).results;
  return json({ activity: rows });
}

export async function proposalRows(db, where, binds = []) {
  return (await db.prepare(
    `SELECT p.*, a.name AS agent_name, pl.title AS plan_title, t.title AS task_title
     FROM proposals p JOIN agents a ON a.id = p.agent_id LEFT JOIN plans pl ON pl.id = p.plan_id LEFT JOIN tasks t ON t.id = p.task_id
     WHERE ${where} ORDER BY p.created_at DESC LIMIT 100`,
  ).bind(...binds).all()).results;
}

async function listProposals(ctx) {
  const status = ctx.url.searchParams.get('status');
  const rows = status
    ? await proposalRows(ctx.db, 'p.status = ?', [oneOf(status, ['proposed', 'approved', 'declined', 'in_progress', 'done'], 'status')])
    : await proposalRows(ctx.db, '1 = 1');
  return json({ proposals: rows });
}

async function decideProposal(ctx, { id }) {
  const owner = ctx.user;
  const body = await readJson(ctx.request);
  const status = oneOf(body.status, ['approved', 'declined', 'done'], 'status');
  const note = text(body.note, 'Note', { max: 2000, required: false });
  const p = await ctx.db.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'Proposal not found');
  // Approving with a reply posts it to the member, as the owner, in the same place they wrote.
  let replyPostId = p.reply_post_id;
  const reply = body.reply !== undefined ? text(body.reply, 'Reply', { max: 4000, required: false }) : '';
  if (status === 'approved' && reply && !p.reply_post_id) {
    if (!p.plan_id) throw new HttpError(400, 'This proposal is not tied to a plan, so there is nowhere to send a reply');
    const original = p.post_id ? await ctx.db.prepare('SELECT task_id FROM posts WHERE id = ?').bind(p.post_id).first() : null;
    replyPostId = newId();
    const t = now();
    await ctx.db.prepare(`INSERT INTO posts (id, plan_id, task_id, kind, user_id, author_name, body, urgency, created_at) VALUES (?, ?, ?, 'message', ?, ?, ?, 'normal', ?)`)
      .bind(replyPostId, p.plan_id, original?.task_id || null, owner.id, owner.name, reply, t).run();
    if (p.post_id) await ctx.db.prepare('UPDATE posts SET handled_at = ? WHERE id = ? AND handled_at IS NULL').bind(t, p.post_id).run();
    await logActivity(ctx.db, { planId: p.plan_id, ...userActor(owner), action: 'post_message', refType: 'post', refId: replyPostId, summary: `${owner.name} replied (drafted by an agent): ${reply.slice(0, 200)}` });
  }
  await ctx.db.prepare('UPDATE proposals SET status = ?, owner_note = ?, reply_post_id = ?, updated_at = ? WHERE id = ?').bind(status, note || p.owner_note, replyPostId, now(), id).run();
  await logActivity(ctx.db, { planId: p.plan_id, ...userActor(owner), action: `proposal_${status}`, refType: 'proposal', refId: id, summary: `${owner.name} ${status === 'done' ? 'closed' : status} proposal: ${p.title}${note ? ` (${note.slice(0, 200)})` : ''}` });
  return json({ ok: true });
}

// What needs the owner, most urgent first: unhandled urgent and soon messages, then plans
// where members are waiting on a reply.
async function attention(ctx) {
  const rows = (await ctx.db.prepare(
    `SELECT p.id, p.plan_id, p.task_id, p.author_name, p.body, p.summary, p.urgency, p.created_at, pl.title AS plan_title, c.name AS client_name, t.title AS task_title,
       (SELECT COUNT(*) FROM proposals x WHERE x.post_id = p.id AND x.status = 'proposed') AS proposals
     FROM posts p JOIN plans pl ON pl.id = p.plan_id LEFT JOIN clients c ON c.id = pl.client_id LEFT JOIN tasks t ON t.id = p.task_id
     WHERE p.urgency != 'normal' AND p.handled_at IS NULL
     ORDER BY p.urgency = 'urgent' DESC, p.created_at ASC LIMIT 100`,
  ).all()).results;
  const s = await getSettings(ctx.db);
  return json({ items: rows, open: withinHours(s), hours: hoursText(s) });
}

async function readSettings(ctx) {
  const s = await getSettings(ctx.db);
  const devices = (await ctx.db.prepare('SELECT endpoint, label, created_at, last_ok_at FROM push_subscriptions WHERE user_id = ?').bind(ctx.user.id).all()).results;
  return json({ settings: s, open: withinHours(s), hours: hoursText(s), push_ready: !!(ctx.env.VAPID_PUBLIC_KEY && ctx.env.VAPID_PRIVATE_KEY), devices: devices.map(d => ({ ...d, endpoint: d.endpoint.slice(0, 40) + '…', id: d.endpoint })) });
}

async function writeSettings(ctx) {
  const s = await saveSettings(ctx.db, await readJson(ctx.request));
  await logActivity(ctx.db, { ...userActor(ctx.user), action: 'settings_changed', refType: 'settings', summary: 'Availability and notification settings changed' });
  return json({ settings: s, hours: hoursText(s), contact_preview: contactFor(s) });
}

async function pushKey(ctx) {
  if (!ctx.env.VAPID_PUBLIC_KEY) throw new HttpError(503, 'Phone notifications are not set up yet (VAPID keys missing in Cloudflare settings)');
  return json({ key: ctx.env.VAPID_PUBLIC_KEY });
}

async function pushSubscribe(ctx) {
  const body = await readJson(ctx.request);
  const sub = body.subscription || {};
  const endpoint = text(sub.endpoint, 'endpoint', { max: 1000 });
  if (!/^https:\/\//.test(endpoint)) throw new HttpError(400, 'Invalid subscription');
  const p256dh = text(sub.keys?.p256dh, 'p256dh', { max: 200 });
  const auth = text(sub.keys?.auth, 'auth', { max: 100 });
  await ctx.db.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
  ).bind(endpoint, ctx.user.id, p256dh, auth, text(body.label, 'label', { max: 80, required: false }) || 'This device', now()).run();
  return json({ ok: true }, 201);
}

async function pushUnsubscribe(ctx) {
  const endpoint = text((await readJson(ctx.request)).endpoint, 'endpoint', { max: 1000 });
  await ctx.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, ctx.user.id).run();
  return json({ ok: true });
}

async function pushTest(ctx) {
  const result = await notifyOwner(ctx.env, ctx.db, { title: 'Kovalenko Creatives', body: 'Test notification: this device will get alerts for urgent messages.', url: '/portal/#/owner', urgency: 'urgent', force: true });
  return json(result);
}

async function notificationLog(ctx) {
  return json({ notifications: (await ctx.db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 30').all()).results });
}

// Invite someone by name and email: they are approved for the chosen client's plans straight away
// and get a private sign-in link. If they already have an account, they get a fresh link.
async function invitePerson(ctx) {
  const body = await readJson(ctx.request);
  const name = text(body.name, 'Name', { max: 120 });
  const email = text(body.email, 'Email', { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a real email address, so the same person can also sign in with Google later');
  const clientId = body.client_id ? (await ctx.db.prepare('SELECT id FROM clients WHERE id = ?').bind(body.client_id).first())?.id : null;
  if (body.client_id && !clientId) throw new HttpError(400, 'Unknown client');
  let user = await ctx.db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const t = now();
  if (!user) {
    const id = newId();
    await ctx.db.prepare(`INSERT INTO users (id, email, name, role, status, client_id, created_at, approved_at) VALUES (?, ?, ?, 'member', 'approved', ?, ?, ?)`)
      .bind(id, email, name, clientId, t, t).run();
    user = await ctx.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  } else {
    if (user.role === 'owner') throw new HttpError(400, 'That is the owner account');
    if (user.client_id && clientId && user.client_id !== clientId) throw new HttpError(409, `${user.name} belongs to another client`);
    await ctx.db.prepare(`UPDATE users SET status = 'approved', approved_at = COALESCE(approved_at, ?), client_id = COALESCE(client_id, ?) WHERE id = ?`).bind(t, clientId, user.id).run();
  }
  for (const planId of Array.isArray(body.plan_ids) ? body.plan_ids.slice(0, 50) : []) await setMembership(ctx.db, planId, user.id, 'approved');
  const { token, expires } = await createInvite(ctx.env, user.id);
  await logActivity(ctx.db, { ...userActor(ctx.user), action: 'invite_created', refType: 'user', refId: user.id, summary: `${ctx.user.name} invited ${name}` });
  return json({ user_id: user.id, link: `${ctx.url.origin}/auth/invite?t=${token}`, expires, days: INVITE_DAYS }, 201);
}

async function reinvite(ctx, { id }) {
  const user = await ctx.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!user || user.role === 'owner') throw new HttpError(404, 'Person not found');
  if (user.status === 'blocked') throw new HttpError(409, 'Unblock this person first');
  const { token, expires } = await createInvite(ctx.env, user.id);
  return json({ link: `${ctx.url.origin}/auth/invite?t=${token}`, expires, days: INVITE_DAYS }, 201);
}

async function listAgents(ctx) {
  const rows = (await ctx.db.prepare('SELECT id, name, created_at, last_seen_at, revoked_at FROM agents ORDER BY created_at DESC').all()).results;
  return json({ agents: rows });
}

// The token is shown once. Only its hash is stored, so a lost token is replaced, not recovered.
async function createAgent(ctx) {
  const name = text((await readJson(ctx.request)).name, 'Agent name', { max: 80 });
  const id = newId();
  const token = `kca_${randomToken(32)}`;
  await ctx.db.prepare('INSERT INTO agents (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').bind(id, name, await sha256Hex(token), now()).run();
  await logActivity(ctx.db, { ...userActor(ctx.user), action: 'agent_created', refType: 'agent', refId: id, summary: `Agent added: ${name}` });
  return json({ id, name, token }, 201);
}

async function revokeAgent(ctx, { id }) {
  const res = await ctx.db.prepare('UPDATE agents SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now(), id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Agent not found');
  return json({ ok: true });
}

async function summary(ctx) {
  const days = Math.min(Math.max(Number(ctx.url.searchParams.get('days')) || 7, 1), 90);
  return json({ summary: await buildSummary(ctx.db, days, { money: true }) });
}

async function listClients(ctx) {
  return json({ clients: (await ctx.db.prepare('SELECT * FROM clients ORDER BY name').all()).results });
}

async function createClient(ctx) {
  const body = await readJson(ctx.request);
  const id = newId();
  const name = text(body.name, 'Client name', { max: 120 });
  await ctx.db.prepare('INSERT INTO clients (id, name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, name, text(body.notes, 'Notes', { max: 4000, required: false }), now(), now()).run();
  await logActivity(ctx.db, { ...userActor(ctx.user), action: 'client_created', refType: 'client', refId: id, summary: `New client: ${name}` });
  return json({ id }, 201);
}

async function updateClient(ctx, { id }) {
  const row = await ctx.db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Client not found');
  const body = await readJson(ctx.request);
  await ctx.db.prepare('UPDATE clients SET name = ?, notes = ?, updated_at = ? WHERE id = ?').bind(
    body.name !== undefined ? text(body.name, 'Client name', { max: 120 }) : row.name,
    body.notes !== undefined ? text(body.notes, 'Notes', { max: 4000, required: false }) : row.notes,
    now(), id,
  ).run();
  return json({ ok: true });
}

// Every client with every project: progress, money, agreement and conversation status at a glance.
async function board(ctx) {
  const db = ctx.db;
  const [clients, plans, people] = await Promise.all([
    db.prepare('SELECT id, name, notes FROM clients ORDER BY name').all(),
    db.prepare('SELECT * FROM plans ORDER BY status = \'done\', updated_at DESC').all(),
    db.prepare(`SELECT client_id, COUNT(*) AS n FROM users WHERE client_id IS NOT NULL AND status = 'approved' GROUP BY client_id`).all(),
  ]);
  const projects = [];
  for (const p of plans.results) {
    const tasks = (await db.prepare('SELECT status FROM tasks WHERE plan_id = ?').bind(p.id).all()).results;
    const lastOwner = await db.prepare(`SELECT MAX(p.created_at) AS t FROM posts p JOIN users u ON u.id = p.user_id WHERE p.plan_id = ? AND u.role = 'owner'`).bind(p.id).first();
    const needsReply = (await db.prepare(
      `SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id WHERE p.plan_id = ? AND p.kind IN ('message', 'idea') AND u.role != 'owner' AND p.created_at > ?`,
    ).bind(p.id, lastOwner?.t || '').first()).n;
    projects.push({
      id: p.id, title: p.title, status: p.status, client_id: p.client_id, updated_at: p.updated_at,
      agreement_status: p.agreement_status, accepted_at: p.accepted_at,
      progress: progressOf(tasks), money: await moneyOf(db, p.id), needs_reply: needsReply, unread: await unreadOf(db, p.id, ctx.user.id),
    });
  }
  const peopleBy = Object.fromEntries(people.results.map(r => [r.client_id, r.n]));
  const group = (client, list) => ({
    ...client, people: client.id ? peopleBy[client.id] || 0 : 0, projects: list,
    owed_cents: list.reduce((n, p) => n + p.money.owed_cents, 0),
    due_now_cents: list.reduce((n, p) => n + p.money.due_now_cents, 0),
    unbilled_cents: list.reduce((n, p) => n + p.money.extras_unbilled_cents, 0),
  });
  const groups = clients.results.map(c => group(c, projects.filter(p => p.client_id === c.id)));
  const loose = projects.filter(p => !p.client_id || !clients.results.some(c => c.id === p.client_id));
  if (loose.length) groups.push(group({ id: null, name: 'No client yet', notes: '' }, loose));
  const active = projects.filter(p => p.status === 'active');
  return json({
    clients: groups,
    totals: {
      active_projects: active.length,
      owed_cents: projects.reduce((n, p) => n + p.money.owed_cents, 0),
      due_now_cents: projects.reduce((n, p) => n + p.money.due_now_cents, 0),
      unbilled_cents: projects.reduce((n, p) => n + p.money.extras_unbilled_cents, 0),
      needs_reply: projects.reduce((n, p) => n + p.needs_reply, 0),
    },
  });
}

// A plain digest of the last N days across every plan: progress, what got done, what people said,
// what is waiting on the owner. Shown on the dashboard and copyable as text.
export async function buildSummary(db, days, { money = false } = {}) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const plans = (await db.prepare(`SELECT * FROM plans WHERE status != 'done' OR updated_at > ? ORDER BY updated_at DESC`).bind(since).all()).results;
  const out = [];
  for (const p of plans) {
    const [tasks, posts, lastOwner] = await Promise.all([
      db.prepare('SELECT title, status, done_at FROM tasks WHERE plan_id = ?').bind(p.id).all(),
      db.prepare(
        `SELECT p.kind, p.task_id, p.author_name, p.body, p.created_at, u.role FROM posts p LEFT JOIN users u ON u.id = p.user_id
         WHERE p.plan_id = ? AND p.created_at > ? ORDER BY p.created_at`,
      ).bind(p.id, since).all(),
      db.prepare(`SELECT MAX(p.created_at) AS t FROM posts p JOIN users u ON u.id = p.user_id WHERE p.plan_id = ? AND u.role = 'owner'`).bind(p.id).first(),
    ]);
    const list = tasks.results;
    const memberPosts = posts.results.filter(x => x.role !== 'owner');
    const needsReply = (await db.prepare(
      `SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id WHERE p.plan_id = ? AND p.kind = 'message' AND u.role != 'owner' AND p.created_at > ?`,
    ).bind(p.id, lastOwner?.t || '').first()).n;
    out.push({
      id: p.id,
      title: p.title,
      status: p.status,
      progress: progressOf(list),
      completed: list.filter(t => t.status === 'done' && t.done_at > since).map(t => t.title),
      in_progress: list.filter(t => t.status === 'doing').map(t => t.title),
      messages: memberPosts.filter(x => x.kind === 'message').length,
      ideas: memberPosts.filter(x => x.kind === 'idea').map(x => `${x.author_name}: ${x.body.slice(0, 160)}`),
      needs_reply: needsReply,
      money: money ? await moneyOf(db, p.id) : null,
    });
  }
  const [pendingPeople, pendingJoins, waitingProposals, approvedWork] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'pending'`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM plan_members m JOIN users u ON u.id = m.user_id WHERE m.status = 'pending' AND u.status = 'approved'`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE status = 'proposed'`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE status IN ('approved', 'in_progress')`).first(),
  ]);
  const waiting = { people: pendingPeople.n, joins: pendingJoins.n, proposals: waitingProposals.n, agent_work_in_progress: approvedWork.n };
  return { days, since, plans: out, waiting, text: summaryText(days, out, waiting) };
}

function summaryText(days, plans, waiting) {
  const lines = [`Summary: last ${days} day${days === 1 ? '' : 's'}`, ''];
  const asks = [];
  if (waiting.people) asks.push(`${waiting.people} ${waiting.people === 1 ? 'person' : 'people'} waiting for access`);
  if (waiting.joins) asks.push(`${waiting.joins} join request${waiting.joins === 1 ? '' : 's'}`);
  if (waiting.proposals) asks.push(`${waiting.proposals} agent proposal${waiting.proposals === 1 ? '' : 's'} to review`);
  lines.push(asks.length ? `Waiting on you: ${asks.join(', ')}.` : 'Nothing is waiting on you.');
  if (waiting.agent_work_in_progress) lines.push(`Agents working on ${waiting.agent_work_in_progress} approved item${waiting.agent_work_in_progress === 1 ? '' : 's'}.`);
  for (const p of plans) {
    lines.push('', `${p.title}: ${p.progress.done}/${p.progress.total} tasks done (${p.progress.percent}%)${p.status !== 'active' ? `, ${p.status}` : ''}`);
    if (p.completed.length) lines.push(`  Done: ${p.completed.join('; ')}`);
    if (p.in_progress.length) lines.push(`  In progress: ${p.in_progress.join('; ')}`);
    if (p.money && (p.money.total_cents || p.money.extras_count)) {
      const m = p.money;
      const bits = [`${dollars(m.owed_cents)} owed of ${dollars(m.total_cents)}`];
      if (m.due_now_cents) bits.push(`${dollars(m.due_now_cents)} due now`);
      if (m.extras_unbilled_count) bits.push(`${m.extras_unbilled_count} extra item${m.extras_unbilled_count === 1 ? '' : 's'} not billed yet${m.extras_unbilled_cents ? ` (${dollars(m.extras_unbilled_cents)})` : ''}`);
      lines.push(`  Money: ${bits.join(', ')}`);
    }
    if (p.messages) lines.push(`  ${p.messages} message${p.messages === 1 ? '' : 's'} from members${p.needs_reply ? `, ${p.needs_reply} since your last reply` : ''}`);
    for (const idea of p.ideas) lines.push(`  Idea from ${idea}`);
    if (!p.completed.length && !p.in_progress.length && !p.messages && !p.ideas.length) lines.push('  No activity.');
  }
  return lines.join('\n');
}
