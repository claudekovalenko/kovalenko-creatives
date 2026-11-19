// Browser tests for the client portal (portal/). Runs the real page in Chromium against a small
// stand-in for Supabase, so no real project, account or network is needed. Part of `npm test`.
// The database rules themselves are tested separately against Postgres: `npm run test:db`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const AXE = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const PORTAL = `${ORIGIN}/portal/index.html`;
const SUPA = 'https://test.supabase.co';

const failures = [], passes = [];
const check = (ok, label) => (ok ? passes : failures).push(label);

const OWNER = '00000000-0000-0000-0000-00000000000a', MEMBER = '00000000-0000-0000-0000-00000000000b', PENDING = '00000000-0000-0000-0000-00000000000e';
function freshData() {
  return {
    profiles: [
      { id: OWNER, email: 'owner@example.com', full_name: 'Olena Owner', access: 'approved', is_owner: true, created_at: '2026-11-01T10:00:00Z' },
      { id: MEMBER, email: 'member@example.com', full_name: 'Mark Member', access: 'approved', is_owner: false, created_at: '2026-11-02T10:00:00Z' },
      { id: PENDING, email: 'new@example.com', full_name: 'Nina New', access: 'pending', is_owner: false, created_at: '2026-11-03T10:00:00Z' },
    ],
    projects: [{ id: 1, name: 'Church website', description: 'Main site', archived: false }],
    project_repos: [],
    project_members: [{ project_id: 1, user_id: MEMBER }],
    requests: [{ id: 1, project_id: 1, author_id: MEMBER, title: 'Change the hero photo', body: 'Use the summer one', status: 'review', hidden: false, created_at: '2026-11-10T10:00:00Z' }],
    comments: [],
    agent_runs: [{ id: 1, request_id: 1, status: 'ready', pr_url: 'https://github.com/example/site/pull/3', preview_url: 'https://portal-request-1.site.pages.dev', summary: 'Swapped the hero image.', error: '', created_at: '2026-11-11T10:00:00Z' }],
    digests: [],
  };
}

// A stand-in for the parts of Supabase the page uses: who is signed in, and simple table reads and writes.
function fakeSupabase(data, userId, log) {
  let nextId = 100;
  return async route => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body === undefined ? '' : JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.pathname === '/auth/v1/user') return json(200, { id: userId });
    if (url.pathname === '/auth/v1/logout') return json(204);
    const table = url.pathname.replace('/rest/v1/', '');
    if (table === 'portal_people') return json(200, data.profiles.map(p => ({ id: p.id, full_name: p.full_name })));
    const rows = data[table];
    if (!rows) return json(404, { message: 'no such table' });
    const filters = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
    const match = row => filters.every(([k, v]) => {
      const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
      if (op === 'eq') return String(row[k]) === val;
      if (op === 'is') return String(row[k]) === val;
      return true;
    });
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    log.push(`${req.method()} ${table}${body ? ' ' + JSON.stringify(body) : ''}`);
    if (req.method() === 'GET') return json(200, rows.filter(match));
    if (req.method() === 'POST') {
      if (table === 'project_repos') { const i = rows.findIndex(r => r.project_id === body.project_id); if (i >= 0) rows.splice(i, 1); }
      const row = { id: nextId++, created_at: new Date().toISOString(), hidden: false, status: table === 'requests' ? 'new' : undefined, ...body };
      rows.push(row);
      return json(201, (req.headers().prefer || '').includes('return=representation') ? [row] : undefined);
    }
    if (req.method() === 'PATCH') { rows.filter(match).forEach(r => Object.assign(r, body)); return json(204); }
    if (req.method() === 'DELETE') { data[table] = rows.filter(r => !match(r)); return json(204); }
    return json(405, {});
  };
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function open({ userId, configured = true, viewport = { width: 1280, height: 900 }, colorScheme, data = freshData(), signedIn = true }) {
  const ctx = await browser.newContext({ viewport, colorScheme, bypassCSP: true });
  const page = await ctx.newPage();
  const errors = [], log = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/portal/config.js', r => r.fulfill({ contentType: 'text/javascript', body: configured ? `window.PORTAL_CONFIG = { supabaseUrl: '${SUPA}', publishableKey: 'test-key' };` : `window.PORTAL_CONFIG = { supabaseUrl: '', publishableKey: '' };` }));
  await page.route(`${SUPA}/**`, fakeSupabase(data, userId, log));
  if (signedIn) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await page.goto(`${PORTAL}#access_token=tok&refresh_token=ref&expires_at=${exp}&token_type=bearer`);
  } else {
    await page.goto(PORTAL);
  }
  await page.waitForTimeout(400);
  return { ctx, page, errors, log, data };
}
async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.nodes.length}x: ${x.nodes.map(n => n.target.join(" ")).join(", ")})`));
  check(v.length === 0, `${label}: no accessibility issues${v.length ? ` (${v.join('; ')})` : ''}`);
}
const noSideways = async (page, w, label) => {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(width <= w, `${label}: no sideways scrolling (${width}px)`);
};

// Not set up yet
{
  const { ctx, page, errors } = await open({ configured: false, signedIn: false });
  check(await page.getByText('not connected yet').isVisible(), 'not set up: says the portal is not connected');
  check(errors.length === 0, `not set up: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

// Signed out: one button that goes to Google through Supabase, and back to this page
{
  const { ctx, page, errors } = await open({ signedIn: false });
  await axe(page, 'signed out');
  let target = '';
  await page.route(`${SUPA}/auth/v1/authorize**`, r => { target = r.request().url(); r.fulfill({ status: 200, body: 'ok' }); });
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await page.waitForTimeout(300);
  const u = new URL(target || 'http://x');
  check(u.searchParams.get('provider') === 'google' && u.searchParams.get('redirect_to') === PORTAL, 'signed out: sign-in goes to Google and returns to the portal');
  check(errors.length === 0, `signed out: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

// Pending person: told they are waiting, sees nothing else; tokens are cleared from the address bar
{
  const { ctx, page, errors } = await open({ userId: PENDING });
  check(await page.getByText('waiting for approval').isVisible(), 'pending: told access is waiting for approval');
  check(!page.url().includes('access_token'), 'pending: sign-in tokens removed from the address');
  check(await page.locator('a[href="#/"]').count() === 0, 'pending: no project links');
  check(errors.length === 0, `pending: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

// Member on a phone: sees the project, posts a request and a comment; no owner controls
for (const [label, viewport, colorScheme] of [['member phone', { width: 360, height: 740 }], ['member desktop dark', { width: 1280, height: 900 }, 'dark']]) {
  const { ctx, page, errors, data } = await open({ userId: MEMBER, viewport, colorScheme });
  check(await page.getByRole('link', { name: /Church website/ }).isVisible(), `${label}: sees their project`);
  check(await page.locator('a[href="#/people"]').count() === 0, `${label}: no People page link`);
  await noSideways(page, viewport.width, `${label} projects`);
  await page.getByRole('link', { name: /Church website/ }).click();
  await page.waitForTimeout(300);
  await axe(page, `${label} project page`);
  await page.getByLabel('What do you need?').fill('Add a donate button');
  await page.getByLabel('Details (optional)').fill('Under the sermon list\nplease');
  await page.getByRole('button', { name: 'Post request' }).click();
  await page.waitForTimeout(400);
  check(data.requests.some(r => r.title === 'Add a donate button' && r.author_id === MEMBER), `${label}: request saved as theirs`);
  check(await page.getByRole('heading', { name: 'Add a donate button' }).isVisible(), `${label}: lands on the new request`);
  check(await page.locator('#rq-status').count() === 0 && await page.locator('.agent').count() === 0, `${label}: no owner controls or agent panel`);
  await page.getByLabel('Add a comment').fill('<img src=x onerror=alert(1)> thanks');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await page.waitForTimeout(400);
  check(await page.getByText('<img src=x onerror=alert(1)> thanks').isVisible(), `${label}: comment shows as plain text, never as code`);
  await noSideways(page, viewport.width, `${label} request`);
  await page.goto(`${PORTAL}#/p/1`);
  await page.waitForTimeout(300);
  check(!/\b(false|true|null|undefined)\b/.test(await page.locator('body').innerText()), `${label}: no stray "false" or "undefined" text`);
  await page.goBack();
  await page.waitForTimeout(300);
  await axe(page, `${label} request page`);
  check(errors.length === 0, `${label}: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

// Owner: approves a person, adds them to a project, approves an agent change
{
  const { ctx, page, errors, log, data } = await open({ userId: OWNER });
  await page.setViewportSize({ width: 360, height: 740 });
  check(await page.locator('a[href="#/people"]').isVisible() && await page.locator('a[href="#/updates"]').isVisible(), 'owner: menu links stay visible on a phone');
  await noSideways(page, 360, 'owner phone');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('a[href="#/people"]');
  await page.waitForTimeout(300);
  await axe(page, 'owner people page');
  await page.getByLabel('Access for Nina New').selectOption('approved');
  await page.waitForTimeout(400);
  check(data.profiles.find(p => p.id === PENDING).access === 'approved', 'owner: approves a pending person');
  await page.locator('.person', { hasText: 'Nina New' }).getByLabel('Church website').check();
  await page.waitForTimeout(300);
  check(data.project_members.some(m => m.user_id === PENDING && m.project_id === 1), 'owner: adds the person to a project');

  await page.goto(`${PORTAL}#/r/1`);
  await page.waitForTimeout(400);
  check(await page.getByText('Ready for your review').isVisible(), 'owner: sees the agent change waiting');
  check(await page.getByRole('link', { name: 'Open preview' }).getAttribute('href') === 'https://portal-request-1.site.pages.dev', 'owner: preview link shown');
  await axe(page, 'owner request page');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Approve and publish' }).click();
  await page.waitForTimeout(400);
  check(data.agent_runs[0].status === 'approved', 'owner: approving marks the change for publishing');
  check(log.some(l => l.startsWith('PATCH agent_runs {"status":"approved"}')), 'owner: only the status is sent');

  await page.goto(`${PORTAL}#/updates`);
  await page.waitForTimeout(300);
  check(await page.getByRole('heading', { name: /Changes to review/ }).isVisible(), 'owner: updates page loads');
  await page.goto(`${PORTAL}#/p/1`);
  await page.waitForTimeout(300);
  await page.locator('summary', { hasText: 'Project settings' }).click();
  await page.getByLabel(/GitHub repository/).fill('example/church-site');
  await page.getByLabel(/Preview address/).fill('https://{branch}.church-site.pages.dev');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.waitForTimeout(400);
  check(data.project_repos.some(r => r.repo === 'example/church-site'), 'owner: sets the project repository');
  check(errors.length === 0, `owner: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

// The page's own security policy applies: injected scripts are refused, Supabase is the only other host
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(PORTAL);
  const blocked = await page.addScriptTag({ content: 'window.__x = 1' }).then(() => false, () => true);
  check(blocked, 'security: injected scripts are blocked by the portal policy');
  const robots = await page.locator('meta[name="robots"]').getAttribute('content');
  check(/noindex/.test(robots), 'search: the portal is kept out of search engines');
  await ctx.close();
}

await browser.close();
server.close();
for (const p of passes) console.log(`  ok    ${p}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\nPortal: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
