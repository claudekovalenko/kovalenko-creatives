// The signed-in Google account: who they are and the projects they have added.
//   GET            -> { signedIn, google, name, email, isOwner, adminToken?, projects: [...] }
//   POST {code}    -> add a project to the account by its code
//   DELETE ?plan_id -> remove a project from the account (it stays in the portal)
import { ensureMemberTables, googleReady, memberFromRequest, sameOrigin } from './_members.js';
import { PROJECTS, projectByCode } from './_projects.js';
import { makeAdminToken, makeProjectPass } from './_auth.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const view = async (env, p) => ({ id: p.id, name: p.name, client: p.client, code: p.code, access: await makeProjectPass(env, p.id) });

export async function onRequest({ request, env }) {
  await ensureMemberTables(env.DB);
  const member = await memberFromRequest(request, env);
  if (request.method === 'GET') {
    if (!member) return json({ signedIn: false, google: googleReady(env) });
    await env.DB.prepare('UPDATE portal_members SET last_seen_at = ? WHERE email = ?').bind(new Date().toISOString(), member.email).run();
    const projects = [];
    for (const id of member.projects) if (PROJECTS[id]) projects.push(await view(env, PROJECTS[id]));
    return json({
      signedIn: true, google: true, name: member.name, email: member.email, isOwner: member.isOwner,
      adminToken: member.isOwner && env.ADMIN_PASSWORD ? await makeAdminToken(env) : undefined,
      projects,
    });
  }
  if (!member) return json({ error: 'Please sign in first.' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Refused' }, 403);
  if (request.method === 'POST') {
    let data = {};
    try { data = await request.json(); } catch { /* empty */ }
    const p = projectByCode(data.code);
    // Same short delay for wrong codes, to slow down guessing.
    if (!p) { await new Promise(r => setTimeout(r, 400)); return json({ error: "That code doesn't match a project. Check the code Ivan sent you." }, 404); }
    await env.DB.prepare('INSERT OR IGNORE INTO portal_member_projects (email, plan_id, added_at) VALUES (?, ?, ?)')
      .bind(member.email, p.id, new Date().toISOString()).run();
    return json({ project: await view(env, p) }, 201);
  }
  if (request.method === 'DELETE') {
    const planId = new URL(request.url).searchParams.get('plan_id');
    await env.DB.prepare('DELETE FROM portal_member_projects WHERE email = ? AND plan_id = ?').bind(member.email, planId).run();
    return json({ ok: true });
  }
  return json({ error: 'Method not allowed' }, 405);
}
