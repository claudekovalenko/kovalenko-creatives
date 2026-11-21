// Portal API tests: run the real server code against a fresh local database and walk through
// sign-in, approvals, plans, chat, agents and the access rules. Run with `npm run test:portal`.
import { startDevServer } from './dev-server.mjs';

const { server, url: BASE } = await startDevServer({ port: 0 });
const failures = [];
const passes = [];
const check = (ok, label) => (ok ? passes : failures).push(label);

// A browser stand-in with its own cookies.
function person(email, name) {
  const jar = new Map();
  const send = async (path, { method = 'GET', body, origin = BASE, headers = {} } = {}) => {
    const h = { ...headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (method !== 'GET' && origin) h.origin = origin;
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      if (/Max-Age=0/.test(c)) jar.delete(k); else jar.set(k, v.join('='));
    }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : null, location: res.headers.get('location') };
  };
  return { send, signIn: () => send(`/auth/dev?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`) };
}

const agentCall = (token, path, { method = 'GET', body } = {}) =>
  fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, data: await r.json() }));

const owner = person('owner@example.com', 'Owner');
const member = person('member@example.com', 'Mia Member');
const stranger = person('stranger@example.com', 'Sam Stranger');

// Signed out
check((await owner.send('/api/me')).data.user === null, 'signed out: /api/me says nobody');
check((await owner.send('/api/plans')).status === 401, 'signed out: plans need sign-in');
check((await owner.send('/auth/google')).status === 503, 'Google sign-in reports when it is not configured');

// Owner
const ownerLogin = await owner.signIn();
check(ownerLogin.status === 302 && ownerLogin.location === '/portal/', 'owner: dev sign-in redirects to the portal');
const ownerMe = (await owner.send('/api/me')).data.user;
check(ownerMe.role === 'owner' && ownerMe.status === 'approved', 'owner: OWNER_EMAILS makes the account owner and approved');

const created = await owner.send('/api/plans', { method: 'POST', body: { title: 'Demo app', summary: 'A sample plan' } });
check(created.status === 201, 'owner: can create a plan');
const planId = created.data.id;
const phase = (await owner.send(`/api/plans/${planId}/phases`, { method: 'POST', body: { title: 'Stage 1' } })).data.id;
const t1 = (await owner.send(`/api/plans/${planId}/tasks`, { method: 'POST', body: { title: 'Home page', phase_id: phase } })).data.id;
await owner.send(`/api/plans/${planId}/tasks`, { method: 'POST', body: { title: 'Sign-in', phase_id: phase } });
check((await owner.send(`/api/tasks/${t1}`, { method: 'PATCH', body: { status: 'done' } })).status === 200, 'owner: can complete a task');
const plan = (await owner.send(`/api/plans/${planId}`)).data.plan;
check(plan.progress.total === 2 && plan.progress.done === 1 && plan.progress.percent === 50, 'plan progress is counted (1 of 2 = 50%)');
check((await owner.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { kind: 'update', body: 'Home page is live.' } })).status === 201, 'owner: can post a progress update');

// Security: changes must come from this site
check((await owner.send('/api/plans', { method: 'POST', body: { title: 'x' }, origin: 'https://evil.example.com' })).status === 403, 'security: a change from another site is refused');
check((await owner.send('/api/plans', { method: 'POST', body: { title: 'x' }, origin: null })).status === 403, 'security: a change with no origin is refused');
check((await owner.send('/api/plans', { method: 'POST', body: { title: '' } })).status === 400, 'validation: empty plan title is refused');

// New member: pending until approved
await member.signIn();
const pendingMe = (await member.send('/api/me')).data.user;
check(pendingMe.status === 'pending' && pendingMe.role === 'member', 'member: first sign-in is pending');
check((await member.send('/api/plans')).status === 403, 'member: pending people see no plans');
check((await member.send(`/api/plans/${planId}`)).status === 403, 'member: pending people cannot open a plan');
check((await member.send('/api/me/request', { method: 'POST', body: { note: 'From the church team' } })).status === 200, 'member: can leave a note with the access request');
check((await member.send('/api/admin/overview')).status === 403, 'member: cannot open the owner dashboard');

const overview = (await owner.send('/api/admin/overview')).data;
check(overview.pending_users.some(u => u.email === 'member@example.com' && u.request_note === 'From the church team'), 'owner: sees the pending person and their note');
check((await owner.send(`/api/admin/users/${pendingMe.id}`, { method: 'POST', body: { status: 'approved' } })).status === 200, 'owner: approves the person');

// Approved member: sees the plan listed, must ask to join it
const listed = (await member.send('/api/plans')).data.plans;
check(listed.length === 1 && listed[0].membership === null && listed[0].progress === undefined, 'member: sees listed plans by title only before joining');
check((await member.send(`/api/plans/${planId}`)).status === 403, 'member: cannot open a plan before joining');
check((await member.send(`/api/plans/${planId}/join`, { method: 'POST', body: { note: 'Please add me' } })).data.status === 'pending', 'member: can ask to join a plan');
const joins = (await owner.send('/api/admin/overview')).data.pending_joins;
check(joins.length === 1 && joins[0].note === 'Please add me', 'owner: sees the join request');
await owner.send('/api/admin/memberships', { method: 'POST', body: { plan_id: planId, user_id: pendingMe.id, status: 'approved' } });
const memberPlan = await member.send(`/api/plans/${planId}`);
check(memberPlan.status === 200 && memberPlan.data.plan.tasks.length === 2, 'member: sees the plan after the owner approves');

// Talking
const msg = await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { body: 'The sign-in button is hard to find on my phone.' } });
check(msg.status === 201, 'member: can post in the plan chat');
check((await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { kind: 'idea', body: 'Add a dark mode' } })).status === 201, 'member: can suggest an idea');
check((await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { body: 'Looks great', task_id: t1 } })).status === 201, 'member: can comment on a task');
check((await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { kind: 'update', body: 'x' } })).status === 403, 'member: cannot post owner progress updates');
check((await member.send(`/api/tasks/${t1}`, { method: 'PATCH', body: { status: 'todo' } })).status === 403, 'member: cannot change tasks');
const chat = (await owner.send(`/api/plans/${planId}/posts?kind=message`)).data.posts;
check(chat.length === 1 && chat[0].author_name === 'Mia Member', 'owner: sees the chat message (task comments kept separate)');
const comments = (await owner.send(`/api/plans/${planId}/posts?kind=message&task=${t1}`)).data.posts;
check(comments.length === 1 && comments[0].body === 'Looks great', 'task comments load per task');
const summary = (await owner.send('/api/admin/summary?days=7')).data.summary;
check(summary.plans[0].needs_reply === 2 && /Idea from Mia Member/.test(summary.text) && /1\/2 tasks done/.test(summary.text), 'summary: counts progress, ideas and messages and comments waiting for a reply');

// Someone not approved for the plan stays out even when approved generally
await stranger.signIn();
const strangerMe = (await stranger.send('/api/me')).data.user;
await owner.send(`/api/admin/users/${strangerMe.id}`, { method: 'POST', body: { status: 'approved' } });
check((await stranger.send(`/api/plans/${planId}/posts`)).status === 403, 'access: an approved person not in the plan cannot read its chat');
await owner.send(`/api/admin/users/${strangerMe.id}`, { method: 'POST', body: { status: 'blocked' } });
check((await stranger.send('/api/me')).data.user === null, 'access: blocking someone signs them out');

// Agents
const agentRes = await owner.send('/api/admin/agents', { method: 'POST', body: { name: 'Fix finder' } });
const token = agentRes.data.token;
check(agentRes.status === 201 && token.startsWith('kca_'), 'owner: can create an agent token');
check((await agentCall('kca_wrong', '/api/agent/activity')).status === 401, 'agents: a wrong token is refused');
check((await fetch(`${BASE}/api/agent/activity`)).status === 401, 'agents: no token is refused');
const feed = (await agentCall(token, '/api/agent/activity?after_id=0')).data;
const chatEvent = feed.activity.find(a => a.action === 'post_message');
check(chatEvent?.post?.body.includes('sign-in button'), 'agents: activity feed includes the full message');
const again = (await agentCall(token, `/api/agent/activity?after_id=${feed.next_after_id}`)).data;
check(again.activity.length === 0, 'agents: the cursor returns only new activity');
const prop = await agentCall(token, '/api/agent/proposals', { method: 'POST', body: { kind: 'fix', title: 'Make the sign-in button bigger on phones', body: 'I can change the CSS.', post_id: chatEvent.ref_id, confidence: 0.8 } });
check(prop.status === 201, 'agents: can send the owner a proposal');
check((await agentCall(token, '/api/agent/proposals', { method: 'POST', body: { kind: 'fix', title: 'dup', body: 'dup', post_id: chatEvent.ref_id } })).data.duplicate === true, 'agents: the same proposal about the same message is not filed twice');
check((await agentCall(token, `/api/agent/proposals/${prop.data.id}`, { method: 'PATCH', body: { status: 'in_progress' } })).status === 409, 'agents: cannot start work before the owner approves');
check((await agentCall(token, `/api/plans/${planId}`)).status === 401, 'agents: cannot use member routes');
check((await member.send('/api/admin/proposals')).status === 403, 'member: cannot see agent proposals');
const waiting = (await owner.send('/api/admin/overview')).data.proposals;
check(waiting.length === 1 && waiting[0].agent_name === 'Fix finder', 'owner: sees the proposal waiting for a decision');
await owner.send(`/api/admin/proposals/${prop.data.id}`, { method: 'POST', body: { status: 'approved', note: 'Yes, keep it on brand' } });
const approved = (await agentCall(token, '/api/agent/proposals?status=approved')).data.proposals;
check(approved.length === 1 && approved[0].owner_note === 'Yes, keep it on brand', 'agents: see approved work with the owner note');
check((await agentCall(token, `/api/agent/proposals/${prop.data.id}`, { method: 'PATCH', body: { status: 'done', note: 'Button is 48px now' } })).status === 200, 'agents: can report approved work as done');
await owner.send(`/api/admin/agents/${agentRes.data.id}`, { method: 'DELETE' });
check((await agentCall(token, '/api/agent/activity')).status === 401, 'agents: a revoked token stops working');

// Sign out
check((await member.send('/auth/logout', { method: 'POST' })).status === 200, 'sign out works');
check((await member.send('/api/me')).data.user === null, 'after sign-out the session is gone');

server.close();
for (const p of passes) console.log(`  ok    ${p}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\nPortal API: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
