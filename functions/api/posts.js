const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const plan_id = url.searchParams.get('plan_id');
    const kind = url.searchParams.get('kind');
    const task_id = url.searchParams.get('task_id');

    if (!plan_id) return json({ error: 'Missing plan_id' }, 400);

    let sql = 'SELECT id, task_id, kind, author_name, body, urgency, created_at FROM posts WHERE plan_id = ?';
    const params = [plan_id];
    if (kind) { sql += ' AND kind = ?'; params.push(kind); }
    if (task_id) { sql += ' AND task_id = ?'; params.push(task_id); }
    sql += ' ORDER BY created_at ASC LIMIT 200';

    const result = await env.DB.prepare(sql).bind(...params).all();
    return new Response(JSON.stringify(result.results), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (request.method === 'POST') {
    let data;
    try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

    const { plan_id, author_name, body, kind, task_id, urgency } = data;
    if (!plan_id || !author_name || !body || !kind) return json({ error: 'Missing fields' }, 400);
    if (!['message', 'update', 'idea'].includes(kind)) return json({ error: 'Invalid kind' }, 400);

    const id = `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created_at = new Date().toISOString();

    await env.DB.prepare(
      'INSERT INTO posts (id, plan_id, task_id, kind, author_name, body, urgency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, plan_id, task_id || null, kind, author_name, body, urgency || 'normal', created_at).run();

    return json({ id, created_at }, 201);
  }

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);
    await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
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
