// Portal browser tests: load the members portal in Chromium as a visitor, a member and the owner,
// at phone, desktop and dark-mode sizes. Checks layout, accessibility, errors, privacy, the
// installable-app setup and the security policy. Run with `npm test` (after `npm install`).
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startDevServer } from './dev-server.mjs';

const require = createRequire(import.meta.url);
const AXE = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const { server, url: BASE } = await startDevServer({ port: 0 });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [];
const passes = [];
const check = (ok, label) => (ok ? passes : failures).push(label);

// Sample data, created through the API as the owner and a member.
async function signedIn(email, name, opts = {}) {
  const ctx = await browser.newContext({ ...opts, bypassCSP: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth/dev?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`);
  return { ctx, page };
}
const call = (page, path, method = 'GET', body) => page.evaluate(async ([p, m, b]) => {
  const r = await fetch(p, { method: m, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
  return r.json();
}, [path, method, body]);

const seed = await signedIn('owner@example.com', 'Owner');
const { id: planId } = await call(seed.page, '/api/plans', 'POST', { title: 'Sample plan', summary: 'A plan used by the browser tests.' });
const { id: phaseId } = await call(seed.page, `/api/plans/${planId}/phases`, 'POST', { title: 'Stage 1' });
const { id: taskId } = await call(seed.page, `/api/plans/${planId}/tasks`, 'POST', { title: 'Home page', phase_id: phaseId });
await call(seed.page, `/api/tasks/${taskId}`, 'PATCH', { status: 'done' });
await call(seed.page, `/api/plans/${planId}/tasks`, 'POST', { title: 'Sign-in', phase_id: phaseId });
await call(seed.page, `/api/plans/${planId}/posts`, 'POST', { body: 'Welcome to the plan chat.' });
const pending = await signedIn('waiting@example.com', 'Wren Waiting');
const memberSeed = await signedIn('member@example.com', 'Mia Member');
const users = (await call(seed.page, '/api/admin/users')).users;
await call(seed.page, `/api/admin/users/${users.find(u => u.email === 'member@example.com').id}`, 'POST', { status: 'approved', plan_ids: [planId] });
await Promise.all([seed.ctx.close(), pending.ctx.close(), memberSeed.ctx.close()]);

const SIZES = [
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ['desktop', { viewport: { width: 1280, height: 900 } }],
  ['desktop dark mode', { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' }],
];
const VIEWS = [
  ['signed out', null, '/portal/', '.btn.google'],
  ['waiting', ['waiting@example.com', 'Wren Waiting'], '/portal/', 'textarea'],
  ['member plan', ['member@example.com', 'Mia Member'], `/portal/#/plan/${planId}/progress`, '.task'],
  ['member chat', ['member@example.com', 'Mia Member'], `/portal/#/plan/${planId}/chat`, '.post'],
  ['owner dashboard', ['owner@example.com', 'Owner'], '/portal/#/owner', '.summary-text'],
  ['owner plan', ['owner@example.com', 'Owner'], `/portal/#/plan/${planId}`, '.status-select'],
];

for (const [size, opts] of SIZES) {
  for (const [view, who, path, ready] of VIEWS) {
    const { ctx, page } = who ? await signedIn(who[0], who[1], opts) : await (async () => {
      const c = await browser.newContext({ ...opts, bypassCSP: true });
      return { ctx: c, page: await c.newPage() };
    })();
    const errors = [];
    const thirdParty = new Set();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { const host = new URL(r.url()).hostname; if (!['127.0.0.1', 'localhost'].includes(host) && !r.url().startsWith('data:')) thirdParty.add(host); });
    await page.goto(BASE + path);
    const shown = await page.waitForSelector(ready, { timeout: 5000 }).then(() => true, () => false);
    check(shown, `${size} / ${view}: page shows`);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    check(width <= opts.viewport.width, `${size} / ${view}: no sideways scrolling (${width}px)`);
    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(v => `${v.id} (${v.nodes.length}x)`));
    check(violations.length === 0, `${size} / ${view}: no accessibility issues${violations.length ? ` (${violations.join('; ')})` : ''}`);
    check(errors.length === 0, `${size} / ${view}: no page errors${errors.length ? ` (${errors.join(' | ')})` : ''}`);
    check(thirdParty.size === 0, `${size} / ${view}: no requests to other companies${thirdParty.size ? ` (${[...thirdParty].join(', ')})` : ''}`);
    await ctx.close();
  }
}

// Sign-in button goes to Google through this site, with a safe return address.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/portal/`);
  const href = await page.locator('.btn.google').getAttribute('href');
  check(href.startsWith('/auth/google?return=%2Fportal%2F'), 'sign-in: button starts Google sign-in on this site');
  await ctx.close();
}

// A member can chat, and the owner sees the message.
{
  const member = await signedIn('member@example.com', 'Mia Member', { viewport: { width: 390, height: 844 } });
  await member.page.goto(`${BASE}/portal/#/plan/${planId}/chat`);
  await member.page.fill('.composer textarea', 'Testing the chat from a phone.');
  await member.page.click('.composer button');
  await member.page.waitForSelector('text=Testing the chat from a phone.');
  const owner = await signedIn('owner@example.com', 'Owner');
  await owner.page.goto(`${BASE}/portal/#/plan/${planId}/chat`);
  const seen = await owner.page.waitForSelector('text=Testing the chat from a phone.', { timeout: 5000 }).then(() => true, () => false);
  check(seen, 'chat: the owner sees a member’s message');
  await owner.page.goto(`${BASE}/portal/#/owner`);
  await owner.page.waitForSelector('.summary-text');
  check(/1 message from members/.test(await owner.page.textContent('.summary-text')), 'summary: shows the new message waiting for a reply');
  await member.ctx.close();
  await owner.ctx.close();
}

// Installable app: manifest, icons and service worker.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/portal/`);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  check(manifest.start_url === '/portal/' && manifest.display === 'standalone', 'app: manifest opens the portal as a standalone app');
  const icons = await page.evaluate(async list => Promise.all(list.map(async i => (await fetch(i.src)).ok)), manifest.icons);
  check(icons.every(Boolean) && manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'), 'app: all icons load, including a maskable one');
  const sw = await page.evaluate(async () => { await navigator.serviceWorker.ready; return !!(await navigator.serviceWorker.getRegistration('/')); });
  check(sw, 'app: service worker is active');
  const cached = await page.evaluate(async () => (await caches.keys()).length ? (await (await caches.open((await caches.keys())[0])).keys()).map(r => new URL(r.url).pathname) : []);
  check(cached.includes('/portal/') && !cached.some(p => p.startsWith('/api/')), 'app: portal shell is cached, plan data is not');
  await ctx.close();
}

// Security: the portal's policy refuses injected scripts, and robots stay out.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/portal/`);
  const blocked = await page.addScriptTag({ content: 'window.__x = 1' }).then(() => false, () => true);
  check(blocked, 'security: injected scripts are blocked in the portal');
  check(await page.locator('meta[name="robots"][content*="noindex"]').count() === 1, 'search: the portal asks not to be indexed');
  await ctx.close();
}

// Keyboard: the sign-in button can be reached and shows focus.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/portal/`);
  await page.waitForSelector('.btn.google');
  let found = false;
  for (let i = 0; i < 8 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate(() => document.activeElement?.classList.contains('google') && getComputedStyle(document.activeElement).outlineStyle !== 'none');
  }
  check(found, 'keyboard: sign-in button is reachable with a visible focus ring');
  await ctx.close();
}

await browser.close();
server.close();
for (const p of passes) console.log(`  ok    ${p}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\nPortal browser: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
