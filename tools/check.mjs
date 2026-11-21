// Site check: run before every publish (`node tools/check.mjs`). Exits non-zero on any problem.
// It catches the mistakes an automated update is most likely to make: broken data, missing
// screenshots, broken page links, and private details that must never reach the public site.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import vm from 'node:vm';

const problems = [];
const fail = msg => problems.push(msg);

// 1. projects.js must load and have the expected shape.
const ctx = {};
try {
  vm.runInNewContext(readFileSync('projects.js', 'utf8') + '\n;this.BODY_OF_WORK = BODY_OF_WORK; this.PROJECTS = PROJECTS;', ctx);
} catch (e) {
  fail(`projects.js does not load: ${e.message}`);
}
const { BODY_OF_WORK = [], PROJECTS = [] } = ctx;

for (const g of BODY_OF_WORK) {
  if (!g.label || !Number.isInteger(g.count) || g.count < 1) fail(`BODY_OF_WORK entry is invalid: ${JSON.stringify(g)}`);
  if (!/^#[0-9a-f]{6}$/i.test(g.color || '')) fail(`BODY_OF_WORK "${g.label}" needs a 6-digit hex color`);
}
for (const p of PROJECTS) {
  for (const field of ['title', 'comment', 'status', 'description']) {
    if (!p[field]) fail(`Project "${p.title || '?'}" is missing ${field}`);
  }
  if (!Array.isArray(p.slides)) fail(`Project "${p.title}" needs a slides list (it may be empty)`);
  for (const slide of p.slides || []) {
    if (/^images\//.test(slide) && !existsSync(slide)) fail(`Project "${p.title}" points to a missing image: ${slide}`);
  }
}

// 2. Every local file the page loads must exist, and every in-page link must have a target.
const html = readFileSync('index.html', 'utf8');
for (const [, src] of html.matchAll(/(?:src|href)="(?!https?:|mailto:|#|data:)([^"]+)"/g)) {
  if (!existsSync(src)) fail(`index.html loads a missing file: ${src}`);
}
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) {
  if (!ids.has(anchor)) fail(`index.html links to #${anchor}, which does not exist`);
}

// 3. Privacy: nothing private may be published.
const STUDIO_EMAIL = 'kovalenkocreatives@gmail.com';
const published = ['index.html', 'projects.js', 'app.js', 'chat.js', 'portal/index.html', 'portal/portal.js', 'sw.js', 'manifest.webmanifest'].map(f => [f, readFileSync(f, 'utf8')]);
for (const [file, text] of published) {
  if (/claude\.ai\/(code\/)?artifact\//.test(text)) fail(`${file} links to a private claude.ai artifact`);
  for (const [email] of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[a-z]{2,})+/gi)) {
    if (email !== STUDIO_EMAIL && !email.endsWith('example.com')) fail(`${file} contains an email address other than the studio's: ${email}`);
  }
  if (/\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/.test(text)) fail(`${file} contains what looks like a phone number`);
}

// 4. Claims the owner has chosen not to make (see CLAUDE.md). Visible copy only: page text and assistant answers.
const visibleCopy = [
  ['index.html', html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ')],
  ['chat.js', readFileSync('chat.js', 'utf8')],
  ['projects.js', readFileSync('projects.js', 'utf8')],
];
const RISKY = [
  [/\bguarantee/i, 'a guarantee'],
  [/\bfunnel/i, 'a lead-generation funnel offer'],
  [/lead[- ]gen(eration)? (service|package|campaign)s?/i, 'a lead-generation service offer'],
  [/tested on (any|every)|works on (any|every) (phone|device)/i, 'a promise about every device'],
  [/\b\d+\s*(leads|customers|sales)\s*(a|per)\s*(day|week|month)/i, 'a promised number of leads or sales'],
  [/\b(in|within)\s+\d+\s*(days?|weeks?)\b/i, 'a promised turnaround time'],
  [/\b(#1|number one|best in (the )?(world|industry))\b/i, 'an unprovable "best" claim'],
  [/available (now|today) to the public|download (it )?now/i, 'a claim that the private apps are available'],
];
for (const [file, text] of visibleCopy) {
  for (const [pattern, what] of RISKY) {
    const m = text.match(pattern);
    if (m) fail(`${file} contains ${what}: "${m[0]}"`);
  }
}
// 4b. The portal stays out of search results, and its server code never ships secrets.
if (!/<meta name="robots" content="noindex/.test(readFileSync('portal/index.html', 'utf8'))) fail('portal/index.html must tell search engines not to index it');
for (const f of readdirSync('server')) {
  const code = readFileSync(`server/${f}`, 'utf8');
  if (/GOCSPX-|sk-ant-|kca_[A-Za-z0-9_-]{20,}/.test(code)) fail(`server/${f} contains what looks like a secret; secrets belong in Cloudflare settings`);
}
if (!/sample/i.test(html.slice(html.indexOf('class="panel"'), html.indexOf('</figure>')))) fail('The hero panel must stay labelled as a sample');

// 5. What goes online: build the live site and check that crawlers can reach only the website itself.
// The members portal is a separate site (the "hub", tools/build-hub.sh) and must never ship with the public one.
const listFiles = (dir, root = dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? listFiles(`${dir}/${e.name}`, root) : [`${dir}/${e.name}`.slice(root.length + 1)]);
function checkBuild(dir, allowed, label) {
  for (const f of listFiles(dir)) {
    if (!allowed.test(f)) fail(`The ${label} build would publish ${f}, which does not belong there`);
    if (!/\.(html|js|css)$/.test(f)) continue;
    const text = readFileSync(`${dir}/${f}`, 'utf8');
    if (/\.(html|js)$/.test(f) && /^\s*\/\/|<!--/m.test(text)) fail(`The ${label} build of ${f} still contains developer comments`);
    for (const [url] of text.matchAll(/https?:\/\/[^\s"'`)<]+/g)) {
      if (!url.startsWith('http://www.w3.org/')) fail(`The ${label} build of ${f} links to ${url}; it links only to its own pages and email`);
    }
  }
}
execSync('sh tools/build.sh');
checkBuild('_site', /^(index\.html|styles\.css|app\.js|chat\.js|projects\.js|images\/[\w-]+\.webp|fonts\/[\w-]+\.(woff2|txt))$/, 'public site');
if (/portal|\/members|manifest/i.test(html)) fail('index.html mentions the members portal; it lives on its own private address, not on the public site');
if (existsSync('functions')) fail('A functions/ folder at the top would run server code on the public site; portal code belongs in hub/functions/');
execSync('sh tools/build-hub.sh');
checkBuild('hub/dist', /^(index\.html|robots\.txt|_headers|styles\.css|sw\.js|manifest\.webmanifest|portal\/(index\.html|portal\.js|portal\.css)|icons\/[\w-]+\.(png|svg)|fonts\/[\w-]+\.(woff2|txt))$/, 'portal');
if (!/X-Robots-Tag: noindex/.test(readFileSync('hub/dist/_headers', 'utf8'))) fail('The portal must tell search engines not to index any of it');

if (problems.length) {
  console.error(`Site check failed (${problems.length}):\n- ` + problems.join('\n- '));
  process.exit(1);
}
console.log(`Site check passed: ${PROJECTS.length} projects, ${BODY_OF_WORK.reduce((n, g) => n + g.count, 0)} counted, no private details found.`);
