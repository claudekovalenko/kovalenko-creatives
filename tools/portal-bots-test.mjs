// Tests for the portal bots (bots/agent.mjs and bots/digest.mjs), with no real services:
// a stand-in for Supabase and the GitHub API, a local git repository as the "website",
// and a fake Claude Code that makes a predictable edit. Run: npm run test:bots
import { createServer } from 'node:http';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const failures = [], passes = [];
const check = (ok, label) => (ok ? passes : failures).push(label);
const root = resolve('.');
const work = mkdtempSync(join(tmpdir(), 'portal-bots-test-'));
const sh = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// The "website" repository, with a live branch called main.
const origin = join(work, 'origin', 'example', 'site.git');
sh(['init', '-q', '--bare', '-b', 'main', origin]);
const seed = join(work, 'seed');
sh(['init', '-q', '-b', 'main', seed]);
writeFileSync(join(seed, 'index.html'), '<h1>Welcome</h1>\n');
sh(['add', '.'], seed);
sh(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'seed'], seed);
sh(['push', '-q', origin, 'main'], seed);

// Fake Claude Code: refuses to run if it can see any key other than its own, then edits according to the request title.
const fake = join(work, 'fake-claude.mjs');
writeFileSync(fake, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
const leaked = ['PORTAL_GITHUB_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'].filter(k => process.env[k]);
if (leaked.length) { console.log(JSON.stringify({ is_error: true, result: 'saw ' + leaked.join(',') })); process.exit(1); }
const prompt = process.argv[process.argv.indexOf('-p') + 1];
const tools = process.argv[process.argv.indexOf('--allowedTools') + 1];
if (tools.includes('Bash')) { console.log(JSON.stringify({ is_error: true, result: 'had Bash' })); process.exit(1); }
if (prompt.includes('MODE:none')) { console.log(JSON.stringify({ result: 'Nothing to change.' })); process.exit(0); }
if (prompt.includes('MODE:github')) { mkdirSync('.github/workflows', { recursive: true }); writeFileSync('.github/workflows/x.yml', 'on: push'); }
else appendFileSync('index.html', '<a href="/give">Donate</a>\\n');
console.log(JSON.stringify({ result: 'Added a donate link under the headline.' }));
`);
chmodSync(fake, 0o755);

// Stand-in for Supabase (service role: no row rules) and the GitHub API.
const now = new Date().toISOString();
const data = {
  projects: [{ id: 1, name: 'Church website', archived: false }, { id: 2, name: 'Quiet project', archived: false }],
  project_repos: [{ project_id: 1, repo: 'example/site', production_branch: 'main', preview_url_template: 'https://{branch}.site.pages.dev' }],
  requests: [
    { id: 1, project_id: 1, title: 'Add a donate link', body: 'Please', status: 'accepted', hidden: false, created_at: now, updated_at: now },
    { id: 2, project_id: 1, title: 'MODE:github sneaky', body: '', status: 'accepted', hidden: false, created_at: now, updated_at: now },
    { id: 3, project_id: 1, title: 'MODE:none', body: '', status: 'accepted', hidden: false, created_at: now, updated_at: now },
    { id: 4, project_id: 1, title: 'Just an idea', body: '', status: 'new', hidden: false, created_at: now, updated_at: now },
  ],
  comments: [{ id: 1, request_id: 1, body: 'Under the headline', hidden: false, created_at: now }],
  agent_runs: [],
  digests: [],
};
const gh = { pulls: [], checks: [], merged: [], closed: [], deleted: [] };
let nextId = 1;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  for await (const chunk of req) body += chunk;
  body = body ? JSON.parse(body) : null;
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };

  if (url.pathname.startsWith('/rest/v1/')) {
    if (req.headers.authorization !== 'Bearer service-key') return send(401, {});
    const rows = data[url.pathname.slice(9)];
    const filters = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit'].includes(k));
    const match = row => filters.every(([k, v]) => {
      const val = row[k];
      if (v === 'not.is.null') return val != null;
      if (v.startsWith('eq.')) return String(val) === v.slice(3);
      if (v.startsWith('is.')) return String(val) === v.slice(3);
      if (v.startsWith('gte.')) return String(val) >= v.slice(4);
      if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(val));
      throw new Error(`filter not supported in test: ${k}=${v}`);
    });
    if (req.method === 'GET') return send(200, rows.filter(match));
    if (req.method === 'POST') {
      const row = { id: nextId++, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), branch: null, pr_number: null, summary: '', error: '', ...body };
      rows.push(row);
      return send(201, (req.headers.prefer || '').includes('return=representation') ? [row] : undefined);
    }
    if (req.method === 'PATCH') { rows.filter(match).forEach(r => Object.assign(r, body, { updated_at: new Date().toISOString() })); return send(204); }
  }
  let m;
  if (req.method === 'POST' && url.pathname === '/repos/example/site/pulls') {
    const pr = { number: gh.pulls.length + 1, html_url: `https://github.com/example/site/pull/${gh.pulls.length + 1}`, state: 'open', merged: false,
      head: { sha: sh(['rev-parse', `refs/heads/${body.head}`], origin), ref: body.head }, base: body.base, title: body.title, body: body.body, created_at: new Date().toISOString() };
    gh.pulls.push(pr);
    return send(201, pr);
  }
  if ((m = url.pathname.match(/^\/repos\/example\/site\/pulls\/(\d+)$/))) {
    const pr = gh.pulls[m[1] - 1];
    if (!pr) return send(404, {});
    if (req.method === 'PATCH') { pr.state = body.state; gh.closed.push(pr.number); }
    return send(200, pr);
  }
  if ((m = url.pathname.match(/^\/repos\/example\/site\/pulls\/(\d+)\/merge$/))) { const pr = gh.pulls[m[1] - 1]; pr.merged = true; pr.state = 'closed'; gh.merged.push(pr.number); return send(200, { merged: true }); }
  if (url.pathname.match(/\/commits\/[0-9a-f]+\/check-runs$/)) return send(200, { check_runs: gh.checks });
  if (req.method === 'DELETE' && url.pathname.includes('/git/refs/heads/')) { gh.deleted.push(decodeURIComponent(url.pathname.split('/git/refs/heads/')[1])); return send(204); }
  send(404, { message: `not in test: ${req.method} ${url.pathname}` });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const env = { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'service-key', PORTAL_GITHUB_TOKEN: 'gh-token',
  GITHUB_API_URL: base, GIT_BASE_URL: `file://${join(work, 'origin')}`, ANTHROPIC_API_KEY: 'test', CLAUDE_BIN: fake, AGENT_MAX_STARTS: '5' };
// Async, so this process's stand-in server can answer the bot while it runs.
const run = async script => {
  try { return (await promisify(execFile)('node', [join(root, 'bots', script)], { env, encoding: 'utf8', timeout: 60000 })).stdout; }
  catch (e) { failures.push(`${script} crashed: ${e.stderr || e.message}`); return ''; }
};

// Round 1: start on the three accepted requests; leave the new one alone.
const out1 = await run('agent.mjs');
const runFor = id => data.agent_runs.find(r => r.request_id === id);
const r1 = runFor(1);
check(r1?.status === 'ready' && data.requests[0].status === 'review', 'agent: accepted request becomes a change ready for review');
check(r1?.pr_url === 'https://github.com/example/site/pull/1' && /^https:\/\/portal-request-1-\d+\.site\.pages\.dev$/.test(r1?.preview_url || ''), 'agent: pull request and preview links saved');
check(r1?.summary === 'Added a donate link under the headline.', 'agent: Claude\'s summary saved for the owner');
check(sh(['show', `${r1?.branch}:index.html`], origin).includes('Donate'), 'agent: the edit is on its own branch');
check(!sh(['show', 'main:index.html'], origin).includes('Donate'), 'agent: the live branch is untouched before approval');
check(runFor(2)?.status === 'failed' && /\.github/.test(runFor(2)?.error) && !sh(['branch', '--list'], origin).includes('request-2-'), 'agent: refuses changes to .github/ and pushes nothing');
check(runFor(3)?.status === 'failed' && runFor(3)?.error === 'The agent made no change.', 'agent: no change is reported, not pushed');
check(!runFor(4) && data.requests[3].status === 'new', 'agent: does not touch requests the owner has not accepted');
check(!/Donate|Please|Under the headline|gh-token|service-key/.test(out1), 'agent: logs contain no request text or keys');

// Round 2: the owner approves; checks still running, so nothing is merged yet.
r1.status = 'approved';
gh.checks = [{ name: 'check', status: 'in_progress', conclusion: null }];
await run('agent.mjs');
check(r1.status === 'approved' && gh.merged.length === 0, 'agent: waits for the repository checks before publishing');

// Round 3: checks pass → merged, request live, branch removed.
gh.checks = [{ name: 'check', status: 'completed', conclusion: 'success' }];
await run('agent.mjs');
check(r1.status === 'merged' && data.requests[0].status === 'live' && gh.merged.includes(1), 'agent: publishes after approval once checks pass');
check(gh.deleted.includes(r1.branch), 'agent: removes the published branch');

// Round 4: a rejected change gets its pull request closed; a failed check stops publishing.
data.requests[0].status = 'accepted';
await run('agent.mjs');
const again = data.agent_runs.filter(r => r.request_id === 1).at(-1);
check(again.id !== r1.id && again.status === 'ready', 'agent: a request accepted again gets a fresh attempt');
again.status = 'rejected';
await run('agent.mjs');
check(gh.closed.includes(again.pr_number), 'agent: closes the pull request of a rejected change');

data.requests[0].status = 'accepted';
await run('agent.mjs');
const third = data.agent_runs.filter(r => r.request_id === 1).at(-1);
third.status = 'approved';
gh.checks = [{ name: 'check', status: 'completed', conclusion: 'failure' }];
await run('agent.mjs');
check(third.status === 'failed' && /checks failed/.test(third.error) && data.requests[0].status === 'in_progress' && !gh.merged.includes(third.pr_number), 'agent: failing checks block publishing and hand back to the owner');

// Weekly summary without a Claude key: a plain list per project with activity.
delete env.ANTHROPIC_API_KEY;
const out2 = await run('digest.mjs');
check(data.digests.length === 1 && data.digests[0].project_id === 1, 'digest: one summary, only for the project with activity');
check(/Add a donate link/.test(data.digests[0]?.body) && /Comments \(1\)/.test(data.digests[0]?.body), 'digest: lists the requests and comments');
check(!/Add a donate link|Under the headline/.test(out2), 'digest: logs contain no request text');

server.close();
rmSync(work, { recursive: true, force: true });
for (const p of passes) console.log(`  ok    ${p}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\nBots: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
