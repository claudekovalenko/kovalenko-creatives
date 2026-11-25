// Accounts for people who sign in with Google. Each account remembers which projects it has added
// (by project code), so signing in again goes straight to their project.
// The session is an HttpOnly cookie; only a SHA-256 hash of it is stored in the database.
//
// Cloudflare settings: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (secret), OWNER_EMAILS (comma-separated;
// those Google accounts get the admin view). Google redirect URI: https://<site>/api/auth/callback
const enc = new TextEncoder();
export const SESSION_COOKIE = '__Host-kc_member';
export const STATE_COOKIE = '__Host-kc_oauth';
export const SESSION_DAYS = 60;

let ready = null;
export function ensureMemberTables(DB) {
  if (!ready) ready = (async () => {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS portal_members (
      email TEXT PRIMARY KEY, name TEXT NOT NULL, google_sub TEXT, created_at TEXT NOT NULL, last_seen_at TEXT)`).run();
    await DB.prepare(`CREATE TABLE IF NOT EXISTS portal_member_projects (
      email TEXT NOT NULL, plan_id TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (email, plan_id))`).run();
    await DB.prepare(`CREATE TABLE IF NOT EXISTS portal_sessions (
      token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`).run();
  })().catch(e => { ready = null; throw e; });
  return ready;
}

export async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function cookies(request) {
  const out = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const setCookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const ownerEmails = env => (env.OWNER_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
export const googleReady = env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

// Cookie-signed-in changes must come from this site (guards against cross-site requests).
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

// The signed-in member for this request, with the set of project ids they have added, or null.
export async function memberFromRequest(request, env) {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token || !env.DB) return null;
  await ensureMemberTables(env.DB);
  const row = await env.DB.prepare(
    `SELECT m.email, m.name FROM portal_sessions s JOIN portal_members m ON m.email = s.email
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256hex(token), new Date().toISOString()).first();
  if (!row) return null;
  const links = (await env.DB.prepare('SELECT plan_id FROM portal_member_projects WHERE email = ?').bind(row.email).all()).results;
  return { email: row.email, name: row.name, isOwner: ownerEmails(env).includes(row.email), projects: new Set(links.map(l => l.plan_id)) };
}

export async function startSession(env, email) {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO portal_sessions (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256hex(token), email, now.toISOString(), expires).run();
  await env.DB.prepare('DELETE FROM portal_sessions WHERE expires_at < ?').bind(now.toISOString()).run();
  return setCookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
}
