import { isAdminRequest, isNotesRequest } from './_auth.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Portal-Name',
};

let ready = null;
function ensureTable(DB) {
  if (!ready) ready = (async () => {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS portal_posts (
      id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, task_id TEXT, kind TEXT NOT NULL,
      author_name TEXT NOT NULL, body TEXT NOT NULL, urgency TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL)`).run();
    await DB.prepare('CREATE INDEX IF NOT EXISTS portal_posts_plan ON portal_posts (plan_id, kind, created_at)').run();
    const has = await DB.prepare('SELECT 1 FROM portal_posts LIMIT 1').first();
    if (!has) await DB.prepare(`INSERT OR IGNORE INTO portal_posts (id, plan_id, task_id, kind, author_name, body, urgency, created_at)
      SELECT id, plan_id, task_id, kind, author_name, body, urgency, created_at FROM posts`).run().catch(() => {});
  })().catch(e => { ready = null; throw e; });
  return ready;
}

export async function onRequest(context) {
  const { request, env } = context;
  await ensureTable(env.DB);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const admin = await isAdminRequest(request, env);
  const notesAdmin = !admin && await isNotesRequest(request, env);
  const caller = (request.headers.get('x-portal-name') || '').trim().toLowerCase();
  const isIvan = n => String(n || '').trim().toLowerCase() === 'ivan';
  const rowById = id => env.DB.prepare('SELECT author_name, urgency, kind FROM portal_posts WHERE id = ?').bind(id).first();
  const forbidden = () => json({ error: 'Only Ivan can do that. Sign in as Ivan with the admin password.' }, 403);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const plan_id = url.searchParams.get('plan_id');
    const kind = url.searchParams.get('kind');
    const task_id = url.searchParams.get('task_id');

    if (!plan_id) return json({ error: 'Missing plan_id' }, 400);

    let sql = 'SELECT id, task_id, kind, author_name, body, urgency, created_at FROM portal_posts WHERE plan_id = ?';
    const params = [plan_id];
    if (kind) { sql += ' AND kind = ?'; params.push(kind); }
    if (task_id) { sql += ' AND task_id = ?'; params.push(task_id); }
    sql += ' ORDER BY created_at ASC LIMIT 500';

    const result = await env.DB.prepare(sql).bind(...params).all();
    return new Response(JSON.stringify(result.results), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (request.method === 'POST') {
    let data;
    try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

    const { plan_id, author_name, body, kind, task_id, urgency, id: clientId } = data;
    if (!plan_id || !author_name || !body || !kind) return json({ error: 'Missing fields' }, 400);
    if (!['message', 'update', 'idea', 'task', 'link', 'sitenote'].includes(kind)) return json({ error: 'Invalid kind' }, 400);

    const notesOk = notesAdmin && (kind === 'sitenote' || kind === 'message');
    if (!admin && !notesOk && isIvan(author_name)) return forbidden();
    if (!admin && ['update', 'link'].includes(kind)) return forbidden();
    const safeUrgency = !admin && (kind === 'task' || kind === 'idea') ? 'pending' : urgency;

    const id = clientId || `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created_at = (typeof data.created_at === 'string' && !isNaN(Date.parse(data.created_at)))
      ? new Date(data.created_at).toISOString() : new Date().toISOString();

    if (await rowById(id)) return json({ id, existed: true }, 200);
    await env.DB.prepare(
      'INSERT INTO portal_posts (id, plan_id, task_id, kind, author_name, body, urgency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, plan_id, task_id || null, kind, author_name, body, safeUrgency || 'open', created_at).run();

    return json({ id, created_at }, 201);
  }

  if (request.method === 'PATCH') {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);
    let data;
    try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const { urgency, body } = data;
    if (!urgency && !body) return json({ error: 'Missing urgency or body' }, 400);
    const row = await rowById(id);
    if (!row) return json({ error: 'Not found' }, 404);
    if (!admin) {
      if (row.urgency === 'pending' || urgency === 'pending') return forbidden();
      const own = caller && caller === String(row.author_name).toLowerCase() && !isIvan(row.author_name);
      const tickOnly = !body || row.kind === 'task';
      if (!own && !(tickOnly && ['done', 'open'].includes(urgency))) return forbidden();
      if (body && row.kind !== 'task' && !own) return forbidden();
    }
    if (urgency) await env.DB.prepare('UPDATE portal_posts SET urgency = ? WHERE id = ?').bind(urgency, id).run();
    if (body) await env.DB.prepare('UPDATE portal_posts SET body = ? WHERE id = ?').bind(body, id).run();
    return json({ updated: id });
  }

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);
    if (!admin) {
      const row = await rowById(id);
      if (!row) return json({ deleted: id });
      const own = caller && caller === String(row.author_name).toLowerCase() && !isIvan(row.author_name);
      if (!own) return forbidden();
    }
    await env.DB.prepare('DELETE FROM portal_posts WHERE id = ?').bind(id).run();
    // Also delete comments on this task
    await env.DB.prepare('DELETE FROM portal_posts WHERE task_id = ?').bind(id).run();
    return json({ deleted: id });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
