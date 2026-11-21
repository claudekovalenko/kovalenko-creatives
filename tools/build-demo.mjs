// Builds a one-file, clickable demo of the members portal for previewing before it is deployed:
// `node tools/build-demo.mjs OUT.html`. It runs the real portal page and the real server code in the
// browser, with an in-browser SQLite database (sql.js) filled with sample data. Nothing is sent
// anywhere and the demo resets when the page reloads. Never put real client data in it.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) throw new Error('Usage: node tools/build-demo.mjs OUT.html');
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// Server modules in dependency order, each wrapped in its own scope (they share some function names).
const ORDER = ['util', 'router', 'settings', 'webpush', 'notify', 'data', 'summarize', 'agreements', 'admin', 'agents', 'auth', 'members', 'app'];
const SUMMARIZE_STUB = `export const LONG_POST = 700;\nexport function summarizeLater() {}\n`; // no AI calls in the demo
let server = 'const __m = {};\n';
for (const name of ORDER) {
  let src = name === 'summarize' ? SUMMARIZE_STUB : read(`server/${name}.js`);
  src = src.replace(/^import \{([^}]+)\} from '\.\/(\w+)\.js';$/gm, (_, names, from) => `const {${names}} = __m.${from};`);
  if (/^import /m.test(src)) throw new Error(`server/${name}.js has an import the demo build cannot handle`);
  const exported = [...src.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(m => m[1]);
  src = src.replace(/^export /gm, '');
  server += `__m.${name} = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();\n`;
}

const migrations = readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort().map(f => read(`migrations/${f}`));

// Same look as the live portal: the site's own fonts, inlined.
const font = f => `url(data:font/woff2;base64,${readFileSync(new URL(`../fonts/${f}`, import.meta.url)).toString('base64')})`;
const styles = read('styles.css').replace(/url\('fonts\/([\w-]+\.woff2)'\)/g, (_, f) => font(f));

let portal = read('portal/portal.js');
if (!/\n  start\(\);\n\}\)\(\);\s*$/.test(portal)) throw new Error('portal.js no longer ends with start(); the demo hook needs updating');
portal = portal.replace(/\n  start\(\);\n\}\)\(\);\s*$/, '\n  window.__portalStart = start;\n  start();\n})();\n');
// No service worker inside the demo (it can't run in the preview frame).
portal = portal.replace("if ('serviceWorker' in navigator) {", 'if (false) {');

const page = `<title>Kovalenko Members Demo</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${styles}
${read('portal/portal.css')}
/* Demo bar */
.demo-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 90; background: var(--code-bg); color: var(--code-fg); border-top: 1px solid rgb(255 255 255 / .1);
  padding: 8px max(16px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font: 400 12px var(--mono); }
.demo-bar b { color: var(--code-hi); font-weight: 500; }
.demo-bar button { border: 1px solid rgb(255 255 255 / .2); background: transparent; color: var(--code-fg); font: inherit; padding: 5px 9px; border-radius: 6px; cursor: pointer; }
.demo-bar button[aria-pressed="true"] { background: var(--code-hi); color: var(--code-bg); border-color: var(--code-hi); }
.demo-bar .demo-note { color: var(--code-dim); }
body { padding-bottom: 64px; }
.toast { bottom: max(76px, calc(env(safe-area-inset-bottom) + 64px)); }
</style>
<header class="site-header">
  <div class="wrap">
    <a class="logo" href="#/"><i aria-hidden="true"></i>Kovalenko Creatives</a>
    <nav aria-label="Portal" id="portal-nav"></nav>
  </div>
</header>
<main id="app" class="wrap portal" tabindex="-1"><p class="muted">Loading the demo…</p></main>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<div class="demo-bar" role="region" aria-label="Demo controls">
  <b>Demo · sample data</b>
  <span>View as:</span>
  <button type="button" data-as="owner">You (owner)</button>
  <button type="button" data-as="client">A client</button>
  <button type="button" data-as="out">Signed out</button>
  <span class="demo-note">Nothing is sent anywhere. Reload to reset.</span>
</div>
<script src="https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-asm.js"></script>
<script>
(async () => {
'use strict';
${server}
const { handle } = __m.app;
const { upsertUser } = __m.auth;
const { sha256Hex, randomToken } = __m.util;
const MIGRATIONS = ${JSON.stringify(migrations)};

// In-browser stand-in for Cloudflare D1.
const SQL = await initSqlJs();
const raw = new SQL.Database();
raw.run('PRAGMA foreign_keys = ON');
for (const m of MIGRATIONS) raw.exec(m);
class Stmt {
  constructor(sql, p = []) { this.sql = sql; this.p = p; }
  bind(...p) { return new Stmt(this.sql, p.map(v => v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)); }
  rows() { const st = raw.prepare(this.sql); st.bind(this.p); const r = []; while (st.step()) r.push(st.getAsObject()); st.free(); return r; }
  async first(c) { const r = this.rows()[0]; return r ? (c ? r[c] : r) : null; }
  async all() { return { results: this.rows(), success: true }; }
  async run() { raw.run(this.sql, this.p); return { success: true, meta: { changes: raw.getRowsModified(), last_row_id: raw.exec('SELECT last_insert_rowid()')[0].values[0][0] } }; }
}
const env = { DB: { prepare: s => new Stmt(s), batch: async ss => { const o = []; for (const s of ss) o.push(await s.run()); return o; } }, COOKIE_INSECURE: '1', OWNER_EMAILS: 'owner@example.com' };

// The portal's /api and /auth calls go to the server code running here instead of the network.
const ORIGIN = 'https://portal.example';
let token = null;
const realFetch = window.fetch.bind(window);
async function local(path, { method = 'GET', body, auth } = {}) {
  const headers = new Headers({ origin: ORIGIN });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (auth) headers.set('authorization', auth); else if (token) headers.set('cookie', 'kc_session=' + token);
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return handle({ url: ORIGIN + path, method, headers, text: async () => text }, env, p => p);
}
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!/^\\/(api|auth)\\//.test(url.pathname)) return realFetch(input, init);
  const res = await local(url.pathname + url.search, { method: init.method || 'GET', body: init.body });
  if (url.pathname === '/auth/logout') { token = null; markBar(); }
  return res;
};

async function sessionFor(email, name) {
  const user = await upsertUser(env, { sub: 'demo:' + email, email, name });
  const t = randomToken(24);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(t), user.id, new Date().toISOString(), '2999-01-01T00:00:00Z').run();
  return { t, user };
}
const json = r => r.json();

// Sample data, created through the real API.
const owner = await sessionFor('owner@example.com', 'You');
const client = await sessionFor('pat@example.com', 'Pat Rivera');
token = owner.t;
const post = (p, b) => local(p, { method: 'POST', body: b }).then(json);
const patch = (p, b) => local(p, { method: 'PATCH', body: b }).then(json);
await local('/api/admin/settings', { method: 'PUT', body: { days: [1, 2, 3, 4, 5], hours_start: '09:00', hours_end: '17:00', timezone: 'America/Los_Angeles' } });
const church = (await post('/api/admin/clients', { name: 'Sample Church' })).id;
const bakery = (await post('/api/admin/clients', { name: 'Sample Bakery' })).id;
const site = (await post('/api/plans', { title: 'Church website', summary: 'A new website with sermons, events and a contact form.' })).id;
await patch('/api/plans/' + site, { client_id: church });
const s1 = (await post('/api/plans/' + site + '/phases', { title: 'Stage 1: Design' })).id;
const s2 = (await post('/api/plans/' + site + '/phases', { title: 'Stage 2: Build and launch' })).id;
for (const [t, ph, st] of [['Home page design', s1, 'done'], ['Sermons page design', s1, 'done'], ['Events calendar', s2, 'doing'], ['Contact form', s2, 'done'], ['Launch on the church domain', s2, 'todo']]) {
  const id = (await post('/api/plans/' + site + '/tasks', { title: t, phase_id: ph })).id;
  if (st !== 'todo') await patch('/api/tasks/' + id, { status: st });
}
await post('/api/plans/' + site + '/scope', { title: 'Five-page website', detail: 'Home, about, sermons, events, contact' });
await post('/api/plans/' + site + '/scope', { title: 'Sermon audio player', detail: 'Upload a recording each week' });
await patch('/api/plans/' + site + '/agreement', { terms: 'Two rounds of changes are included in each stage. New requests are quoted before work starts.' });
const dep = (await post('/api/plans/' + site + '/payments', { label: 'Deposit', amount: 1200, due_date: '2026-10-01' })).id;
await patch('/api/payments/' + dep, { paid: true });
await post('/api/plans/' + site + '/payments', { label: 'On launch', amount: 1200, due_date: '2027-01-15' });
await post('/api/plans/' + site + '/extras', { title: 'Set up email forwarding for the office', hours: 1, amount: 75, work_date: '2026-11-12' });
await post('/api/plans/' + site + '/extras', { title: 'Fixed a typo on the events page', billing: 'no_charge', work_date: '2026-11-14' });
await patch('/api/plans/' + site + '/agreement', { status: 'shared' });
await post('/api/plans/' + site + '/posts', { kind: 'update', body: 'Design is approved and the events calendar is in progress. Next up: launch prep.' });
await post('/api/plans/' + site + '/posts', { body: 'Welcome! Ask anything here.' });
const users = (await local('/api/admin/users').then(json)).users;
await local('/api/admin/users/' + users.find(u => u.email === 'pat@example.com').id, { method: 'POST', body: { status: 'approved', client_id: church, plan_ids: [site] } });
const bake = (await post('/api/plans', { title: 'Bakery ordering site', summary: 'Menu and pickup orders.' })).id;
await patch('/api/plans/' + bake, { client_id: bakery });
for (const t of ['Menu page', 'Pickup order form', 'Owner order emails']) await post('/api/plans/' + bake + '/tasks', { title: t });
const app = (await post('/api/plans', { title: 'Church reading plan app', summary: 'Sermon companion app.' })).id;
await patch('/api/plans/' + app, { client_id: church, status: 'done' });
await sessionFor('jordan@example.com', 'Jordan Lee');
const agent = await post('/api/admin/agents', { name: 'Helpdesk bot' });

token = client.t;
await post('/api/plans/' + site + '/posts', { body: 'Could we add a page for the youth group?', urgency: 'soon' });
const urgent = (await post('/api/plans/' + site + '/posts', { body: 'The contact form says "sent" but nothing arrives in our inbox since this morning.', urgency: 'urgent' })).post;
await post('/api/plans/' + site + '/posts', { kind: 'idea', body: 'A prayer request form would be great someday.' });
token = null;
await local('/api/me/request', { method: 'POST', body: { note: 'I help run the bakery website.' } });
await local('/api/agent/proposals', { method: 'POST', auth: 'Bearer ' + agent.token, body: { kind: 'fix', title: 'Contact form emails are being blocked', body: 'The form sends, but the mail provider is rejecting messages from the site address. I can add the sender record to the domain settings and resend the stuck messages.', confidence: 0.8, post_id: urgent.id, reply_draft: 'Thanks for flagging this. We found the cause (an email setting on the domain) and are fixing it now. We will let you know as soon as messages are arriving again.' } });

// Demo controls
const who = { owner: owner.t, client: client.t, out: null };
function markBar() { for (const b of document.querySelectorAll('[data-as]')) b.setAttribute('aria-pressed', String(who[b.dataset.as] === token)); }
document.querySelector('.demo-bar').addEventListener('click', e => {
  const b = e.target.closest('[data-as]');
  if (!b) return;
  token = who[b.dataset.as];
  location.hash = b.dataset.as === 'owner' ? '#/owner' : '#/';
  markBar();
  window.__portalStart();
});
// "Continue with Google" in the demo signs in a new person, who then waits for approval.
document.addEventListener('click', async e => {
  const a = e.target.closest('a[href^="/auth/google"]');
  if (!a) return;
  e.preventDefault();
  token = (await sessionFor('sam@example.com', 'Sam Taylor')).t;
  location.hash = '#/';
  markBar();
  window.__portalStart();
}, true);
// The viewer has no pop-up dialogs, so the demo accepts confirmations and suggested values.
window.confirm = () => true;
window.prompt = (msg, value) => value || '';

token = owner.t;
location.hash = '#/owner';
markBar();
${portal}
})().catch(err => {
  document.getElementById('app').textContent = 'The demo could not start: ' + err.message;
  console.error(err);
});
</script>
`;
writeFileSync(out, page);
console.log(`Demo written to ${out} (${Math.round(page.length / 1024)} KB)`);
