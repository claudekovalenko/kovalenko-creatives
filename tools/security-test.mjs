// Security tests for the client portal API: run the real Cloudflare functions against an in-memory
// database (Node's built-in SQLite) and check that nobody can read or change a project's posts
// without that project's pass. Run with `node tools/security-test.mjs` (part of `npm test`).
import { DatabaseSync } from 'node:sqlite';
import * as posts from '../functions/api/posts.js';
import * as projects from '../functions/api/projects.js';
import * as login from '../functions/api/admin-login.js';

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
  const fn = mod.onRequest || (method === 'POST' ? mod.onRequestPost : null);
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

for (const p of passes) console.log(`  ok    ${p}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\nSecurity: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
