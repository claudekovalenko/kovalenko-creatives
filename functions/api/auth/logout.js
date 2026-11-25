// Sign out of the Google account session on this device.
import { cookies, ensureMemberTables, sameOrigin, setCookie, sha256hex, SESSION_COOKIE } from '../_members.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return new Response(JSON.stringify({ error: 'Refused' }), { status: 403 });
  const token = cookies(request)[SESSION_COOKIE];
  if (token) {
    await ensureMemberTables(env.DB);
    await env.DB.prepare('DELETE FROM portal_sessions WHERE token_hash = ?').bind(await sha256hex(token)).run();
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': setCookie(SESSION_COOKIE, '', 0) } });
}
