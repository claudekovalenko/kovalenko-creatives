// Browser tests: load the real page in Chromium at phone, tablet and desktop sizes and check
// that nothing is broken, inaccessible or leaking. Run with `npm test` (after `npm install`).
// Exits non-zero on any failure, so the publish workflow refuses to deploy a broken page.
//
// Set CHROMIUM_PATH to use an already-installed Chromium instead of Playwright's own download.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const AXE = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain' };

// A tiny static server for the site folder, so the test needs nothing else installed.
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/index.html`;

const failures = [];
const passes = [];
const check = (ok, label) => (ok ? passes : failures).push(label);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

const SIZES = [
  ['small phone', { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true }],
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ['tablet', { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true }],
  ['desktop', { viewport: { width: 1280, height: 900 } }],
  ['desktop dark mode', { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' }],
];

for (const [name, opts] of SIZES) {
  // bypassCSP only lets the test inject its accessibility checker; the page's own policy is tested below.
  const ctx = await browser.newContext({ ...opts, bypassCSP: true });
  const page = await ctx.newPage();
  const errors = [];
  const thirdParty = new Set();
  const missing = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { const host = new URL(r.url()).hostname; if (host !== '127.0.0.1' && !r.url().startsWith('data:')) thirdParty.add(host); });
  page.on('response', r => { if (r.status() >= 400) missing.push(`${r.status()} ${new URL(r.url()).pathname}`); });

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // Layout
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(width <= opts.viewport.width, `${name}: no sideways scrolling (page ${width}px wide, screen ${opts.viewport.width}px)`);

  // Every screenshot actually loads once scrolled into view
  await page.evaluate(async () => { for (const img of document.images) img.loading = 'eager'; });
  await page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 10000 }).catch(() => {});
  const broken = await page.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src').slice(0, 40)));
  check(broken.length === 0, `${name}: all screenshots load${broken.length ? ` (broken: ${broken.join(', ')})` : ''}`);

  // Fonts come from the site itself
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family); });
  check(fonts.some(f => f.includes('Inter Tight')) && fonts.some(f => f.includes('JetBrains Mono')), `${name}: self-hosted fonts load`);

  // Project cards and carousel
  check(await page.locator('.proj').count() === 5, `${name}: all 5 project cards show`);
  const top = page.locator('.proj-top.has-shots').first();
  await top.scrollIntoViewIfNeeded();
  await top.locator('.dots button').nth(1).click();
  await page.waitForTimeout(700);
  const slide = await top.locator('.slides').evaluate(t => Math.round(t.scrollLeft / t.clientWidth));
  check(slide === 1, `${name}: carousel dot moves to the next screenshot`);
  await top.locator('.slides').evaluate(t => t.scrollTo({ left: t.clientWidth * 2, behavior: 'instant' }));
  await page.waitForTimeout(300);
  const dot = await top.locator('.dots button[aria-current="true"]').getAttribute('aria-label');
  check(dot === 'Show screen 3', `${name}: swiping keeps the dots in step`);

  // Questions assistant: every answer path ends at email
  await page.click('.chat-toggle');
  await page.getByRole('button', { name: 'What do you build?' }).click();
  await page.getByRole('button', { name: /get in touch/ }).click();
  const mail = await page.locator('.chat-cta').getAttribute('href');
  check(mail?.startsWith('mailto:kovalenkocreatives@gmail.com'), `${name}: assistant leads to the studio email`);
  const panel = await page.locator('.chat-panel').boundingBox();
  check(panel.x >= 0 && panel.x + panel.width <= opts.viewport.width, `${name}: assistant fits on screen`);

  // Accessibility (axe), with the assistant open so it is checked too
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(v => `${v.id} (${v.impact}, ${v.nodes.length}x)`));
  check(violations.length === 0, `${name}: no accessibility issues${violations.length ? ` (${violations.join('; ')})` : ''}`);

  check(errors.length === 0, `${name}: no page errors${errors.length ? ` (${errors.join(' | ')})` : ''}`);
  check(missing.length === 0, `${name}: no missing files${missing.length ? ` (${missing.join(', ')})` : ''}`);
  check(thirdParty.size === 0, `${name}: no requests to other companies${thirdParty.size ? ` (${[...thirdParty].join(', ')})` : ''}`);
  await ctx.close();
}

// Keyboard only: every link and button can be reached, and focus is always visible
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.waitForTimeout(500);
  const reached = new Set();
  let invisible = 0;
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const s = getComputedStyle(e);
      return { key: e.id || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30), ring: s.outlineStyle !== 'none' && s.outlineWidth !== '0px' };
    });
    if (!info) continue;
    reached.add(info.key);
    if (!info.ring) invisible++;
  }
  check(reached.has('Start a project') && reached.has('copy-email') && reached.has('Questions?'), 'keyboard: main buttons, email copy and assistant are reachable');
  check([...reached].some(k => /screenshots$/.test(k)), 'keyboard: screenshot carousels are reachable');
  check(invisible === 0, `keyboard: focus ring always visible${invisible ? ` (${invisible} stops without one)` : ''}`);
  await ctx.close();
}

// Zoomed to 200%: equivalent to a 320px-wide screen
{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.waitForTimeout(500);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(width <= 320, `200% zoom: no sideways scrolling (${width}px)`);
  await ctx.close();
}

// Reduced motion: nothing animates for visitors who ask their device for less motion
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.waitForTimeout(500);
  const smooth = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  check(smooth === 'auto', 'reduced motion: smooth scrolling turned off');
  await ctx.close();
}

// JavaScript off: the text still reads and the work list falls back
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  const headings = await page.locator('h1, h2').count();
  const fallback = await page.evaluate(() => document.querySelector('noscript')?.textContent || '');
  check(headings >= 6 && fallback.includes('Reading Plan'), 'no JavaScript: headings and project list still show');
  await ctx.close();
}

// Security policy is enforced: an injected inline script must be refused
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  const blocked = await page.addScriptTag({ content: 'window.__injected = true' }).then(() => false, () => true);
  check(blocked, 'security: injected scripts are blocked by the page policy');
  await ctx.close();
}

// What a search engine reads
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.waitForTimeout(500);
  const seo = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
    lang: document.documentElement.lang,
    h1: document.querySelectorAll('h1').length,
    emails: [...new Set((document.documentElement.outerHTML.match(/[\w.+-]+@[\w-]+(?:\.[a-z]{2,})+/gi) || []))],
  }));
  check(seo.title === 'Kovalenko Creatives', 'search: page title is set');
  check(seo.description.length >= 50 && seo.description.length <= 160, `search: description is a good length (${seo.description.length} characters)`);
  check(seo.lang === 'en', 'search: language is set');
  check(seo.h1 === 1, 'search: exactly one main headline');
  check(seo.emails.every(e => e === 'kovalenkocreatives@gmail.com'), `search: only the studio email appears (${seo.emails.join(', ')})`);
  await ctx.close();
}

await browser.close();
server.close();

for (const p of passes) console.log(`  ok    ${p}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
