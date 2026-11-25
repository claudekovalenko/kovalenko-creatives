import { PROJECTS } from './_projects.js';
import { isAdminRequest, makeProjectPass } from './_auth.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};



export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  if (url.searchParams.get('inbox') === '1') {
    if (!(await isAdminRequest(request, context.env))) return json({ error: 'unauthorized' }, 401);
    const since = new Date(Date.now() - 21 * 86400000).toISOString();
    const rows = (await context.env.DB.prepare(
      `SELECT id, plan_id, task_id, kind, author_name, body, urgency, created_at FROM portal_posts
       WHERE (urgency = 'pending' AND kind IN ('task','idea'))
          OR (kind = 'sitenote' AND urgency != 'done')
          OR (kind = 'message' AND lower(author_name) != 'ivan' AND created_at > ?)
       ORDER BY created_at DESC LIMIT 200`
    ).bind(since).all()).results;
    const names = Object.fromEntries(Object.values(PROJECTS).map(p => [p.id, p.name]));
    return json({ items: rows.filter(r => names[r.plan_id]).map(r => ({ ...r, project: names[r.plan_id] })) });
  }
  if (url.searchParams.get('all') === '1') {
    if (!(await isAdminRequest(request, context.env))) return json({ error: 'unauthorized' }, 401);
    const DB = context.env.DB;
    const out = [];
    for (const p of Object.values(PROJECTS)) {
      const rows = (await DB.prepare(
        `SELECT kind, urgency, task_id, COUNT(*) n, MAX(created_at) last FROM portal_posts WHERE plan_id = ? GROUP BY kind, urgency, task_id = 'client'`
      ).bind(p.id).all().catch(() => ({ results: [] }))).results;
      const sum = f => rows.filter(f).reduce((a, r) => a + r.n, 0);
      out.push({
        id: p.id, name: p.name, client: p.client, code: p.code,
        tasksDone: sum(r => r.kind === 'task' && r.urgency === 'done' && r.task_id !== 'client'),
        tasksTotal: sum(r => r.kind === 'task' && r.urgency !== 'pending' && r.task_id !== 'client'),
        waitingOnClient: sum(r => r.kind === 'task' && r.task_id === 'client' && r.urgency === 'open'),
        pending: sum(r => (r.kind === 'task' || r.kind === 'idea') && r.urgency === 'pending'),
        openNotes: sum(r => r.kind === 'sitenote' && r.urgency !== 'done'),
        messages: sum(r => r.kind === 'message'),
        lastActivity: rows.reduce((m, r) => (r.last > m ? r.last : m), ''),
      });
    }
    return json({ projects: out });
  }
  const code = url.searchParams.get('code');

  const project = Object.values(PROJECTS).find(p => p.code === code?.toUpperCase());
  if (!project) return json({ error: 'Invalid project code' }, 404);

  return json({ id: project.id, name: project.name, client: project.client, code: project.code, access: await makeProjectPass(context.env, project.id) });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
