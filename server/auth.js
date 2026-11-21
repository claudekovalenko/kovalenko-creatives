// Sign-in with Google (OAuth 2.0 authorization code flow with PKCE) and cookie sessions.
//
// Settings (Cloudflare Pages > Settings > Variables and secrets):
//   GOOGLE_CLIENT_ID      OAuth client ID from Google Cloud Console (Web application)
//   GOOGLE_CLIENT_SECRET  its secret (store as an encrypted secret)
//   OWNER_EMAILS          comma-separated Google accounts that get the owner dashboard
// Authorized redirect URI to register with Google: https://<your domain>/auth/google/callback
import { HttpError, json, now, newId, randomToken, sha256Hex, sha256B64url, parseCookies, setCookie } from './util.js';

const SESSION_DAYS = 30;
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

// Sessions use a __Host- cookie (HTTPS only, this host only). Plain-HTTP local development sets COOKIE_INSECURE=1.
const secureCookies = env => env.COOKIE_INSECURE !== '1';
const sessionCookieName = env => (secureCookies(env) ? '__Host-kc_session' : 'kc_session');
const stateCookieName = env => (secureCookies(env) ? '__Host-kc_oauth' : 'kc_oauth');

const ownerEmails = env => (env.OWNER_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// Only same-site pages may be returned to after sign-in.
const safeReturn = path => (typeof path === 'string' && /^\/portal\/[\w\-/#?=&.%]*$/.test(path) ? path : '/portal/');

export async function currentUser(request, env) {
  const token = parseCookies(request.headers.get('cookie'))[sessionCookieName(env)];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256Hex(token), now()).first();
  return row || null;
}

export async function authRoutes(request, env, url) {
  const path = url.pathname;
  if (path === '/auth/google' && request.method === 'GET') return startGoogle(env, url);
  if (path === '/auth/google/callback' && request.method === 'GET') return finishGoogle(request, env, url);
  if (path === '/auth/logout' && request.method === 'POST') return logout(request, env, url);
  if (path === '/auth/dev' && request.method === 'GET') return devLogin(env, url);
  if (path === '/auth/invite' && request.method === 'GET') return useInvite(env, url);
  throw new HttpError(404, 'Not found');
}

async function startGoogle(env, url) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new HttpError(503, 'Google sign-in is not set up yet');
  const state = randomToken(24);
  const verifier = randomToken(48);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: await sha256B64url(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  const back = safeReturn(url.searchParams.get('return'));
  return new Response(null, {
    status: 302,
    headers: {
      location: `${GOOGLE_AUTH}?${params}`,
      'set-cookie': setCookie(stateCookieName(env), `${state}.${verifier}.${back}`, { maxAge: 600, secure: secureCookies(env) }),
      'cache-control': 'no-store',
    },
  });
}

async function finishGoogle(request, env, url) {
  const stored = parseCookies(request.headers.get('cookie'))[stateCookieName(env)] || '';
  const [state, verifier, ...rest] = stored.split('.');
  const back = safeReturn(rest.join('.'));
  if (url.searchParams.get('error')) return redirect('/portal/#/signin-cancelled', env);
  if (!state || state !== url.searchParams.get('state') || !url.searchParams.get('code')) {
    throw new HttpError(400, 'Sign-in expired or was tampered with. Please try again.');
  }

  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code'),
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/auth/google/callback`,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) throw new HttpError(502, 'Google did not accept the sign-in. Please try again.');
  const { id_token } = await tokenRes.json();

  // The ID token came straight from Google's token endpoint over TLS, so its claims can be read
  // directly (OpenID Connect Core 3.1.3.7). Still check who it was issued to and that it is current.
  const claims = decodeJwtPayload(id_token);
  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.exp < nowSec) {
    throw new HttpError(400, 'Sign-in could not be verified. Please try again.');
  }
  if (!claims.email || claims.email_verified !== true) throw new HttpError(403, 'Your Google account email is not verified.');

  const user = await upsertUser(env, { sub: claims.sub, email: claims.email, name: claims.name || claims.email.split('@')[0] });
  return startSession(env, user, back, [setCookie(stateCookieName(env), '', { maxAge: 0, secure: secureCookies(env) })]);
}

function decodeJwtPayload(jwt) {
  const part = (jwt || '').split('.')[1];
  if (!part) throw new HttpError(502, 'Google sent an unexpected response.');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
}

export async function upsertUser(env, { sub, email, name }) {
  email = email.toLowerCase();
  const isOwner = ownerEmails(env).includes(email);
  const db = env.DB;
  let user = await db.prepare('SELECT * FROM users WHERE google_sub = ? OR email = ?').bind(sub, email).first();
  const t = now();
  if (!user) {
    const id = newId();
    await db.prepare(
      `INSERT INTO users (id, google_sub, email, name, role, status, created_at, approved_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, sub, email, name, isOwner ? 'owner' : 'member', isOwner ? 'approved' : 'pending', t, isOwner ? t : null, t).run();
    await db.prepare(
      `INSERT INTO activity (actor_type, actor_id, actor_name, action, ref_type, ref_id, summary, created_at) VALUES ('user', ?, ?, 'signed_up', 'user', ?, ?, ?)`,
    ).bind(id, name, id, `${name} signed in for the first time${isOwner ? ' (owner)' : ' and is waiting for approval'}`, t).run();
    user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  } else {
    // Owner status always follows OWNER_EMAILS, so it can be granted or removed from settings.
    const role = isOwner ? 'owner' : user.role === 'owner' ? 'member' : user.role;
    const status = isOwner ? 'approved' : user.status;
    await db.prepare('UPDATE users SET google_sub = ?, name = ?, role = ?, status = ?, last_seen_at = ? WHERE id = ?')
      .bind(sub, name, role, status, t, user.id).run();
    user = { ...user, google_sub: sub, name, role, status };
  }
  return user;
}

async function startSession(env, user, back, extraCookies = []) {
  if (user.status === 'blocked') return redirect('/portal/#/blocked', env, extraCookies);
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), user.id, now(), expires).run();
  // Housekeeping: drop expired sessions.
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()).run();
  return redirect(back, env, [
    ...extraCookies,
    setCookie(sessionCookieName(env), token, { maxAge: SESSION_DAYS * 86400, secure: secureCookies(env) }),
  ]);
}

function redirect(location, env, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

async function logout(request, env, url) {
  const token = parseCookies(request.headers.get('cookie'))[sessionCookieName(env)];
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': setCookie(sessionCookieName(env), '', { maxAge: 0, secure: secureCookies(env) }) });
}

// Local development and tests only: sign in as any email without Google.
// Refused unless DEV_LOGIN=1 is set AND the request comes to localhost, so it can never work on the live site.
async function devLogin(env, url) {
  if (env.DEV_LOGIN !== '1' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new HttpError(404, 'Not found');
  const email = url.searchParams.get('email') || 'owner@example.com';
  const user = await upsertUser(env, { sub: `dev:${email}`, email, name: url.searchParams.get('name') || email.split('@')[0] });
  return startSession(env, user, safeReturn(url.searchParams.get('return')));
}

// Invite links: /auth/invite?t=<secret>. Each link signs one person in once, within 14 days.
export const INVITE_DAYS = 14;

export async function createInvite(env, userId) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString();
  await env.DB.prepare('INSERT INTO invites (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now(), expires).run();
  return { token, expires };
}

async function useInvite(env, url) {
  const token = url.searchParams.get('t') || '';
  const invite = token ? await env.DB.prepare('SELECT * FROM invites WHERE token_hash = ?').bind(await sha256Hex(token)).first() : null;
  if (!invite || invite.used_at || invite.expires_at < now()) return redirect('/portal/#/invite-expired', env);
  // Mark it used first, so the same link can never start two sessions.
  const res = await env.DB.prepare('UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').bind(now(), invite.token_hash).run();
  if (!res.meta.changes) return redirect('/portal/#/invite-expired', env);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(invite.user_id).first();
  if (!user) return redirect('/portal/#/invite-expired', env);
  await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now(), user.id).run();
  return startSession(env, user, '/portal/');
}
