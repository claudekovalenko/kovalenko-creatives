// Security tests for the client portal API: run the real Cloudflare functions against an in-memory
// database (Node's built-in SQLite) and check that nobody can read or change a project's posts
// without that project's pass. Run with `node tools/security-test.mjs` (part of `npm test`).
import { DatabaseSync } from 'node:sqlite';
import * as posts from '../functions/api/posts.js';
import * as projects from '../functions/api/projects.js';
import * as login from '../functions/api/admin-login.js';
import * as me from '../functions/api/me.js';
import * as googleStart from '../functions/api/auth/google.js';
import * as googleBack from '../functions/api/auth/callback.js';
import * as logout from '../functions/api/auth/logout.js';

process.removeAllListeners('warning');
const sqlite = new DatabaseSync(':memory:');
class Stmt {
  constructor(sql, p = []) { this.sql = sql; this.p = p; }
  bind(...p) { return new Stmt(this.sql, p.map(v => (v === undefined ? null : v))); }
  async first() { const r = sqlite.prepare(this.sql).get(...this.p); return r ? { ...r } : null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.p).map(r => ({ ...r })) }; }
  async run() { sqlite.prepare(this.sql).run(...this.p); return { success: true }; }
}
const env = { DB: { prepare: sql => new Stmt(sql) }, ADMIN_PASSWORD: 'test-admin-password-long-enough' };
const ORIGIN = 'https://portal.test';
const call = async (mod, path, { method = 'GET', body, headers = {} } = {}) => {
  const request = new Request(ORIGIN + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const fn = mod.onRequest || (method === 'POST' ? mod.onRequestPost : mod.onRequestGet);
  const res = await fn({ request, env });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  return { status: res.status, data };
};

const failures = [];
const passes = [];
const check = (ok, label) => (ok ? passes : failures).push(label);

// Set up: the admin signs in and posts; a client opens the project with its code.
const admin = (await call(login, '/api/admin-login', { method: 'POST', body: { password: env.ADMIN_PASSWORD } })).data.token;
const A = { Authorization: `Bearer ${admin}` };
await call(posts, '/api/posts', { method: 'POST', headers: A, body: { plan_id: 'jpn-mvp', author_name: 'Ivan', body: 'Private plan detail', kind: 'message', id: 'p1' } });
const opened = (await call(projects, '/api/projects?code=JPN2026')).data;
check(!!opened?.access, 'opening a project with its code gives a project pass');
const P = { 'X-Project-Access': opened.access, 'X-Portal-Name': 'Craig' };

// Without a pass: nothing.
check((await call(posts, '/api/posts?plan_id=jpn-mvp')).status === 401, 'reading posts without a pass is refused');
check((await call(posts, '/api/posts?plan_id=jpn-mvp&kind=message')).status === 401, 'reading messages without a pass is refused');
check((await call(posts, '/api/posts', { method: 'POST', body: { plan_id: 'jpn-mvp', author_name: 'Stranger', body: 'spam', kind: 'message' } })).status === 401, 'posting without a pass is refused');
check((await call(posts, '/api/posts?id=p1', { method: 'DELETE', headers: { 'X-Portal-Name': 'Ivan' } })).status === 401, 'deleting without a pass is refused');
check((await call(posts, '/api/posts?id=p1', { method: 'PATCH', body: { urgency: 'done' } })).status === 401, 'changing without a pass is refused');
check((await call(posts, '/api/posts?plan_id=jpn-mvp', { headers: { 'X-Project-Access': 'forged.jpn-mvp.abc' } })).status === 401, 'a made-up pass is refused');
const otherPlan = opened.access.replace('.jpn-mvp.', '.other-client.');
check((await call(posts, '/api/posts?plan_id=other-client', { headers: { 'X-Project-Access': otherPlan } })).status === 401, 'a pass edited to name another project is refused');
const expired = `${Date.now() - 1000}.jpn-mvp.${opened.access.split('.')[2]}`;
check((await call(posts, '/api/posts?plan_id=jpn-mvp', { headers: { 'X-Project-Access': expired } })).status === 401, 'an expired pass is refused');

// With the project's pass: the client works normally, but only in their own project.
const read = await call(posts, '/api/posts?plan_id=jpn-mvp', { headers: P });
check(read.status === 200 && read.data.length === 1, 'with the pass, the client reads their project');
check((await call(posts, '/api/posts', { method: 'POST', headers: P, body: { plan_id: 'jpn-mvp', author_name: 'Craig', body: 'Looks good', kind: 'message', id: 'c1' } })).status === 201, 'with the pass, the client can post');
check((await call(posts, '/api/posts?plan_id=another-project', { headers: P })).status === 401, 'a pass for one project cannot read another');
check((await call(posts, '/api/posts', { method: 'POST', headers: P, body: { plan_id: 'another-project', author_name: 'Craig', body: 'x', kind: 'message' } })).status === 401, 'a pass for one project cannot post to another');
check((await call(posts, '/api/posts?id=p1', { method: 'DELETE', headers: { ...P, 'X-Portal-Name': 'Ivan' } })).status === 403, 'a client cannot delete the admin’s posts');
check((await call(posts, '/api/posts', { method: 'POST', headers: P, body: { plan_id: 'jpn-mvp', author_name: 'Ivan', body: 'pretend', kind: 'message' } })).status === 403, 'a client cannot post as the admin');
check((await call(posts, '/api/posts', { method: 'POST', headers: P, body: { plan_id: 'jpn-mvp', author_name: 'Craig', body: 'x'.repeat(20001), kind: 'message' } })).status === 413, 'oversized posts are refused');

// The admin still sees everything.
check((await call(posts, '/api/posts?plan_id=jpn-mvp', { headers: A })).data.length === 2, 'the admin reads every project');
check((await call(projects, '/api/projects?all=1')).status === 401 && (await call(projects, '/api/projects?all=1', { headers: A })).status === 200, 'the all-projects view needs the admin sign-in');
check((await call(login, '/api/admin-login', { method: 'POST', body: { password: 'wrong' } })).status === 401, 'a wrong admin password is refused');

// Finishing tasks and project history
const newTask = await call(posts, '/api/posts', { method: 'POST', headers: A, body: { plan_id: 'jpn-mvp', task_id: 'sp1', author_name: 'Ivan', kind: 'task', body: JSON.stringify({ text: 'Contact page' }), urgency: 'open' } });
const taskId = newTask.data.id;
check((await call(posts, `/api/posts?id=${taskId}`, { method: 'PATCH', headers: P, body: { urgency: 'done' } })).status === 200, 'a client can mark a task done');
await call(posts, `/api/posts?id=${taskId}`, { method: 'PATCH', headers: A, body: { urgency: 'open' } });
let hist = (await call(posts, '/api/posts?plan_id=jpn-mvp&kind=history', { headers: P })).data.map(h => ({ ...h, d: JSON.parse(h.body) }));
check(hist.some(h => h.d.action === 'added' && h.d.text === 'Contact page' && h.author_name === 'Ivan'), 'history records who added a task');
check(hist.some(h => h.d.action === 'finished' && h.author_name === 'Craig'), 'history records who finished a task');
check(hist.some(h => h.d.action === 'reopened' && h.author_name === 'Ivan'), 'history records reopening');
check((await call(posts, '/api/posts?plan_id=jpn-mvp&kind=history')).status === 401, 'history needs the project pass too');
check((await call(posts, '/api/posts', { method: 'POST', headers: P, body: { plan_id: 'jpn-mvp', author_name: 'Craig', kind: 'history', body: '{"action":"finished","text":"fake"}' } })).status === 400, 'nobody can write fake history');
check((await call(posts, `/api/posts?id=${hist[0].id}`, { method: 'PATCH', headers: { ...P, 'X-Portal-Name': hist[0].author_name }, body: { body: 'changed' } })).status === 403, 'history cannot be edited');
check((await call(posts, `/api/posts?id=${hist[0].id}`, { method: 'DELETE', headers: { ...P, 'X-Portal-Name': hist[0].author_name } })).status === 403, 'a client cannot delete history');
await call(posts, `/api/posts?id=${taskId}`, { method: 'DELETE', headers: A });
hist = (await call(posts, '/api/posts?plan_id=jpn-mvp&kind=history', { headers: A })).data.map(h => JSON.parse(h.body));
check(hist.some(h => h.action === 'removed' && h.text === 'Contact page') && hist.some(h => h.action === 'finished'), 'removing a task keeps its history and records the removal');

// Google sign-in: accounts remember their projects
env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
env.GOOGLE_CLIENT_SECRET = 'secret';
env.OWNER_EMAILS = 'owner@example.com';
const raw = async (mod, path, { method = 'GET', headers = {}, body } = {}) => {
  const request = new Request(ORIGIN + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const fn = mod.onRequest || (method === 'POST' ? mod.onRequestPost : mod.onRequestGet);
  return fn({ request, env });
};
const cookieFrom = res => res.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => !c.endsWith('=')).join('; ');
// Stand-in for Google's token endpoint: returns an ID token for whoever we choose.
const realFetch = globalThis.fetch;
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
async function googleSignIn(email, name, { aud = env.GOOGLE_CLIENT_ID, verified = true } = {}) {
  const start = await raw(googleStart, '/api/auth/google');
  const loc = new URL(start.headers.get('location'));
  const stateCookie = cookieFrom(start);
  globalThis.fetch = async () => new Response(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64({ aud, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 600, email, email_verified: verified, name, sub: 'sub-' + email })}.sig` }), { status: 200 });
  try {
    const back = await raw(googleBack, `/api/auth/callback?code=abc&state=${loc.searchParams.get('state')}`, { headers: { cookie: stateCookie } });
    return { location: back.headers.get('location'), cookie: cookieFrom(back), startLocation: loc };
  } finally { globalThis.fetch = realFetch; }
}
const g = await googleSignIn('pat@example.com', 'Pat Rivera');
check(g.startLocation.hostname === 'accounts.google.com' && g.startLocation.searchParams.get('code_challenge_method') === 'S256', 'Google sign-in starts with a state and PKCE check');
check(g.location === `${ORIGIN}/portal/` && g.cookie.startsWith('__Host-kc_member='), 'Google sign-in creates a session and returns to the portal');
const forged = await raw(googleBack, '/api/auth/callback?code=abc&state=guess');
check(forged.headers.get('location').includes('signin=failed') && !cookieFrom(forged), 'a callback without the matching state is refused');
check((await googleSignIn('x@example.com', 'X', { aud: 'someone-else' })).location.includes('signin=failed'), 'an ID token meant for another app is refused');
check((await googleSignIn('y@example.com', 'Y', { verified: false })).location.includes('signin=failed'), 'an unverified Google email is refused');
const G = { cookie: g.cookie, origin: ORIGIN };
let mine = (await call(me, '/api/me', { headers: G })).data;
check(mine.signedIn && mine.name === 'Pat Rivera' && mine.projects.length === 0 && !mine.adminToken, 'a new Google account starts with no projects and no admin rights');
check((await call(posts, '/api/posts?plan_id=jpn-mvp', { headers: G })).status === 401, 'a Google account cannot read a project it has not added');
check((await call(me, '/api/me', { method: 'POST', headers: G, body: { code: 'WRONG' } })).status === 404, 'a wrong project code is refused');
check((await call(me, '/api/me', { method: 'POST', headers: { cookie: g.cookie, origin: 'https://evil.example' }, body: { code: 'JPN2026' } })).status === 403, 'adding a project from another site is refused');
check((await call(me, '/api/me', { method: 'POST', headers: G, body: { code: 'jpn2026' } })).status === 201, 'adding a project by its code works (any letter case)');
mine = (await call(me, '/api/me', { headers: G })).data;
check(mine.projects.length === 1 && mine.projects[0].id === 'jpn-mvp' && !!mine.projects[0].access, 'the account remembers the project for next time');
check((await call(posts, '/api/posts?plan_id=jpn-mvp', { headers: G })).status === 200, 'a Google account reads the projects it added');
check((await call(posts, '/api/posts?plan_id=oahu-seminary', { headers: G })).status === 401, 'but not other projects');
const asPat = await call(posts, '/api/posts', { method: 'POST', headers: G, body: { plan_id: 'jpn-mvp', author_name: 'Ivan', body: 'pretending', kind: 'message' } });
const patPost = (await call(posts, '/api/posts?plan_id=jpn-mvp&kind=message', { headers: G })).data.find(p => p.id === asPat.data?.id);
check(asPat.status === 201 && patPost?.author_name === 'Pat Rivera', 'posts from a Google account always carry its real name');
check((await call(posts, '/api/posts', { method: 'POST', headers: { cookie: g.cookie, origin: 'https://evil.example' }, body: { plan_id: 'jpn-mvp', author_name: 'x', body: 'x', kind: 'message' } })).status === 403, 'posting with the sign-in cookie from another site is refused');
await call(me, '/api/me', { method: 'POST', headers: G, body: { code: 'OAHU2026' } });
check((await call(me, '/api/me', { headers: G })).data.projects.length === 2, 'another project can be added with another code');
const owner = await googleSignIn('owner@example.com', 'Ivan Kovalenko');
const ownerMe = (await call(me, '/api/me', { headers: { cookie: owner.cookie } })).data;
check(ownerMe.isOwner && !!ownerMe.adminToken, 'the owner’s Google account gets the admin view');
await raw(logout, '/api/auth/logout', { method: 'POST', headers: G });
check((await call(me, '/api/me', { headers: G })).data.signedIn === false, 'signing out ends the session');

for (const p of passes) console.log(`  ok    ${p}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\nSecurity: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
