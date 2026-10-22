// Site check: run before every publish (`node tools/check.mjs`). Exits non-zero on any problem.
// It catches the mistakes an automated update is most likely to make: broken data, missing
// screenshots, broken page links, and private details that must never reach the public site.
import { readFileSync, existsSync } from 'node:fs';
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
const published = ['index.html', 'projects.js', 'app.js', 'chat.js'].map(f => [f, readFileSync(f, 'utf8')]);
for (const [file, text] of published) {
  if (/claude\.ai\/(code\/)?artifact\//.test(text)) fail(`${file} links to a private claude.ai artifact`);
  for (const [email] of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[a-z]{2,})+/gi)) {
    if (email !== STUDIO_EMAIL && !email.endsWith('example.com')) fail(`${file} contains an email address other than the studio's: ${email}`);
  }
  if (/\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/.test(text)) fail(`${file} contains what looks like a phone number`);
}

if (problems.length) {
  console.error(`Site check failed (${problems.length}):\n- ` + problems.join('\n- '));
  process.exit(1);
}
console.log(`Site check passed: ${PROJECTS.length} projects, ${BODY_OF_WORK.reduce((n, g) => n + g.count, 0)} counted, no private details found.`);
