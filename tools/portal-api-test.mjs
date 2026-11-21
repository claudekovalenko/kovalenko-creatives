// Portal API tests: run the real server code against a fresh local database and walk through
// sign-in, approvals, plans, chat, agents and the access rules. Run with `npm run test:portal`.
import { startDevServer } from './dev-server.mjs';

// Long posts get a short version; the test stands in for Claude so nothing is sent anywhere.
// Phone notifications are captured instead of sent.
const pushed = [];
const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const VAPID_PUBLIC_KEY = Buffer.from(await crypto.subtle.exportKey('raw', vapid.publicKey)).toString('base64url');
const VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d;
const { server, url: BASE } = await startDevServer({ port: 0, env: {
  SUMMARIZE_FN: async body => `Short: ${body.slice(0, 20)}`,
  PUSH_FN: async (sub, msg) => { pushed.push(msg); return 201; },
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
} });
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
const clientA = (await owner.send('/api/admin/clients', { method: 'POST', body: { name: 'Client A' } })).data.id;
const clientB = (await owner.send('/api/admin/clients', { method: 'POST', body: { name: 'Client B' } })).data.id;
check((await owner.send(`/api/plans/${planId}`, { method: 'PATCH', body: { client_id: clientA } })).status === 200, 'owner: can assign a plan to a client');
const planB = (await owner.send('/api/plans', { method: 'POST', body: { title: 'Client B secret project' } })).data.id;
await owner.send(`/api/plans/${planB}`, { method: 'PATCH', body: { client_id: clientB } });
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
check((await owner.send(`/api/admin/users/${pendingMe.id}`, { method: 'POST', body: { status: 'approved', client_id: clientA } })).status === 200, 'owner: approves the person as part of Client A');

// Approved member: sees the plan listed, must ask to join it
const listed = (await member.send('/api/plans')).data.plans;
check(listed.length === 1 && listed[0].id === planId && listed[0].membership === null && listed[0].progress === undefined, 'member: sees listed plans by title only before joining');
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

// Client silos
check((await member.send(`/api/plans/${planB}`)).status === 403, 'silo: Client A people cannot open Client B plans');
check((await member.send(`/api/plans/${planB}/join`, { method: 'POST', body: {} })).status === 404, 'silo: Client A people cannot even ask to join Client B plans');
check((await owner.send('/api/admin/memberships', { method: 'POST', body: { plan_id: planB, user_id: pendingMe.id, status: 'approved' } })).status === 409, 'silo: the owner is stopped from adding a Client A person to a Client B plan');
const boardRes = (await owner.send('/api/admin/board')).data;
const groupA = boardRes.clients.find(c => c.id === clientA);
check(groupA.projects.length === 1 && groupA.projects[0].progress.percent === 50 && boardRes.clients.find(c => c.id === clientB).projects[0].id === planB, 'board: each client shows its own projects and progress');
check((await member.send('/api/admin/board')).status === 403, 'board: members cannot see the client board');

// Agreement, payments and the balance owed
check((await member.send(`/api/plans/${planId}/agreement`)).data.agreement.shared === false, 'agreement: a draft is hidden from the client');
await owner.send(`/api/plans/${planId}/scope`, { method: 'POST', body: { title: 'Five-page website', detail: 'Home, about, services, contact, blog' } });
await owner.send(`/api/plans/${planId}/agreement`, { method: 'PATCH', body: { terms: 'Two rounds of changes included.' } });
const dep = (await owner.send(`/api/plans/${planId}/payments`, { method: 'POST', body: { label: 'Deposit', amount: '1,500', due_date: '2026-01-01' } })).data.id;
await owner.send(`/api/plans/${planId}/payments`, { method: 'POST', body: { label: 'On launch', amount: 2500.5, due_date: '2099-01-01' } });
check((await owner.send(`/api/plans/${planId}/payments`, { method: 'POST', body: { label: 'Bad', amount: 'lots' } })).status === 400, 'agreement: a nonsense amount is refused');
check((await member.send(`/api/plans/${planId}/agreement/accept`, { method: 'POST', body: {} })).status === 409, 'agreement: cannot be accepted before it is shared');
await owner.send(`/api/plans/${planId}/agreement`, { method: 'PATCH', body: { status: 'shared' } });
let ag = (await member.send(`/api/plans/${planId}/agreement`)).data.agreement;
check(ag.shared && ag.scope.length === 1 && ag.terms.includes('Two rounds') && ag.money.total_cents === 400050, 'agreement: the client sees scope, terms and the $4,000.50 total');
check(ag.money.owed_cents === 400050 && ag.money.due_now_cents === 150000, 'agreement: balance owed and the amount due now are worked out');
check((await member.send(`/api/plans/${planId}/agreement/accept`, { method: 'POST', body: {} })).status === 200, 'agreement: the client can accept it');
check((await owner.send(`/api/plans/${planId}/agreement`)).data.agreement.accepted_by.startsWith('Mia Member'), 'agreement: records who accepted and when');
check((await member.send(`/api/payments/${dep}`, { method: 'PATCH', body: { paid: true } })).status === 403, 'payments: only the owner marks payments');
await owner.send(`/api/payments/${dep}`, { method: 'PATCH', body: { paid: true } });
ag = (await member.send(`/api/plans/${planId}/agreement`)).data.agreement;
check(ag.status === 'accepted' && ag.money.owed_cents === 250050 && ag.money.paid_cents === 150000, 'payments: marking the deposit paid lowers the balance and keeps the agreement accepted');
await owner.send(`/api/plans/${planId}/scope`, { method: 'POST', body: { title: 'Logo refresh' } });
check((await member.send(`/api/plans/${planId}/agreement`)).data.agreement.status === 'shared', 'agreement: changing the scope asks the client to accept again');

// Extra work log
const ex1 = (await owner.send(`/api/plans/${planId}/extras`, { method: 'POST', body: { title: 'Fixed their email DNS', hours: 1.5, amount: 120, work_date: '2026-11-10' } })).data.id;
await owner.send(`/api/plans/${planId}/extras`, { method: 'POST', body: { title: 'Quick favicon swap', billing: 'no_charge' } });
await owner.send(`/api/plans/${planId}/extras`, { method: 'POST', body: { title: 'Internal: tried a new host', visible: false } });
ag = (await member.send(`/api/plans/${planId}/agreement`)).data.agreement;
check(ag.extras.length === 2 && !ag.extras.some(e => e.title.startsWith('Internal')), 'extras: the client sees logged extra work, not items the owner kept private');
check(ag.money.extras_unbilled_cents === 12000 && ag.money.owed_cents === 250050, 'extras: unbilled extra work is shown but not added to the balance');
check((await owner.send(`/api/extras/${ex1}/bill`, { method: 'POST', body: { due_date: '2099-02-01' } })).status === 201, 'extras: the owner can bill an extra');
ag = (await member.send(`/api/plans/${planId}/agreement`)).data.agreement;
check(ag.money.owed_cents === 262050 && ag.payments.some(p => p.label === 'Extra: Fixed their email DNS'), 'extras: billing adds it to payments and the balance owed');
const ownerSummary = (await owner.send('/api/admin/summary?days=7')).data.summary.text;
check(/Money: \$2,620\.50 owed of \$4,120\.50/.test(ownerSummary), 'summary: shows money owed for the owner');

// Unread messages and long posts
const before = (await member.send('/api/plans')).data.plans.find(p => p.id === planId).unread;
await owner.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { body: 'Thanks, looking at it now.' } });
const after = (await member.send('/api/plans')).data.plans.find(p => p.id === planId).unread;
check(after === before + 1, 'unread: a new message from the studio shows as unread');
await member.send(`/api/plans/${planId}/posts?kind=message`);
check((await member.send('/api/plans')).data.plans.find(p => p.id === planId).unread === 0, 'unread: opening the chat marks it read');
const long = 'We met with the team and here is everything we think about the launch. '.repeat(15);
const longPost = (await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { body: long } })).data.post;
await new Promise(r => setTimeout(r, 100));
const withSummary = (await owner.send(`/api/plans/${planId}/posts?kind=message`)).data.posts.find(p => p.id === longPost.id);
check(withSummary.summary === `Short: ${long.slice(0, 20)}`, 'long posts: a short version is saved alongside the full text');

// Agents never see money or agreement terms
const tok = (await owner.send('/api/admin/agents', { method: 'POST', body: { name: 'Money check' } })).data.token;
const agentPlan = (await agentCall(tok, `/api/agent/plans/${planId}`)).data.plan;
const agentSummary = (await agentCall(tok, '/api/agent/summary')).data.summary;
check(agentPlan.terms === undefined && !JSON.stringify(agentPlan).includes('Two rounds') && !/Money:|\$/.test(agentSummary.text), 'agents: never see agreement terms or money');

// Urgency, notifications and studio hours
const wait = () => new Promise(r => setTimeout(r, 80));
await owner.send('/api/admin/push/subscribe', { method: 'POST', body: { subscription: { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'x', auth: 'y' } }, label: 'Phone' } });
check((await member.send('/api/admin/settings', { method: 'PUT', body: { text_enabled: true } })).status === 403, 'settings: members cannot change the owner settings');
check((await owner.send('/api/admin/settings', { method: 'PUT', body: { text_enabled: true } })).status === 400, 'settings: texting needs a phone number first');
const ALL_DAY = { days: [0, 1, 2, 3, 4, 5, 6], hours_start: '00:00', hours_end: '23:59', timezone: 'UTC' };
const CLOSED = { days: [], hours_start: '09:00', hours_end: '17:00', timezone: 'UTC' };
await owner.send('/api/admin/settings', { method: 'PUT', body: { ...CLOSED, notify_urgent: 'hours', text_enabled: true, text_phone: '+1 808 555 0100', text_hours_only: true } });
let r = await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { body: 'The site is down!', urgency: 'urgent' } });
await wait();
check(r.status === 201 && r.data.post.urgency === 'urgent', 'urgency: a member can mark a message urgent');
check(pushed.length === 0 && r.data.contact && r.data.contact.text_phone === null && r.data.contact.open === false, 'off hours: no notification and no phone number, by default');
let log = (await owner.send('/api/admin/notifications')).data.notifications;
check(log[0].sent === 0 && /Outside studio hours/.test(log[0].reason), 'off hours: the held notification is logged with the reason');
await owner.send('/api/admin/settings', { method: 'PUT', body: ALL_DAY });
r = await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { body: 'Checkout is broken', urgency: 'urgent' } });
const urgentId = r.data.post.id;
await wait();
check(pushed.length === 1 && /Urgent/.test(pushed[0].title) && pushed[0].url.includes(planId), 'studio hours: an urgent message notifies the owner');
check(r.data.contact.text_phone === '+1 808 555 0100', 'studio hours: texting is offered only after an urgent message');
check(!JSON.stringify((await member.send('/api/contact')).data).includes('555'), 'contact: the phone number is never sent before an urgent message');
await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { body: 'Can we talk this week?', urgency: 'soon' } });
await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { body: 'Normal note' } });
await wait();
check(pushed.length === 1, 'notifications: "soon" and normal messages do not notify unless turned on');
check((await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { kind: 'idea', body: 'x', urgency: 'urgent' } })).status === 400, 'urgency: only messages can be urgent');
let att = (await owner.send('/api/admin/attention')).data.items;
check(att.length === 3 && att[0].urgency === 'urgent' && att[2].urgency === 'soon', 'attention list: urgent first, then soon');
check((await member.send(`/api/posts/${urgentId}`, { method: 'PATCH', body: { handled: true } })).status === 403, 'attention list: only the owner marks things handled');
await owner.send(`/api/posts/${urgentId}`, { method: 'PATCH', body: { handled: true } });
check((await owner.send('/api/admin/attention')).data.items.length === 2, 'attention list: handled messages drop off');
await owner.send('/api/admin/settings', { method: 'PUT', body: { notify_urgent: 'off' } });
await member.send(`/api/plans/${planId}/posts`, { method: 'POST', body: { body: 'Another urgent one', urgency: 'urgent' } });
await wait();
check(pushed.length === 1, 'notifications: the owner can turn urgent notifications off');
await owner.send('/api/admin/settings', { method: 'PUT', body: { notify_urgent: 'hours' } });

// An agent drafts a reply; the owner edits and sends it with the approval
const helper = (await owner.send('/api/admin/agents', { method: 'POST', body: { name: 'Helper' } })).data.token;
const feed2 = (await agentCall(helper, '/api/agent/activity?after_id=0&limit=500')).data.activity;
const soonEvent = feed2.find(a => a.post?.urgency === 'soon');
check(!!soonEvent, 'agents: activity shows how urgent each message is');
const urgentLeft = (await owner.send('/api/admin/attention')).data.items.find(i => i.urgency === 'urgent');
const before2 = pushed.length;
const draftProp = (await agentCall(helper, '/api/agent/proposals', { method: 'POST', body: { kind: 'note', title: 'Answer about the outage', body: 'Looks like a DNS issue.', post_id: urgentLeft.id, reply_draft: 'Thanks, we are looking at it now.' } })).data.id;
await wait();
check(pushed.length === before2 + 1, 'agents: a suggestion about an urgent message notifies the owner');
const memberChatBefore = (await member.send(`/api/plans/${planId}/posts?kind=message`)).data.posts.length;
await owner.send(`/api/admin/proposals/${draftProp}`, { method: 'POST', body: { status: 'approved', reply: 'Thanks, I am looking at it now.' } });
const memberChat = (await member.send(`/api/plans/${planId}/posts?kind=message`)).data.posts;
check(memberChat.length === memberChatBefore + 1 && memberChat.at(-1).body === 'Thanks, I am looking at it now.' && memberChat.at(-1).author_role === 'owner', 'agents: the approved (edited) reply reaches the member from the owner');
check(!(await owner.send('/api/admin/attention')).data.items.some(i => i.id === urgentLeft.id), 'agents: sending the reply marks the message handled');

// Web Push encryption, checked against an independent decoder (RFC 8291) using Node's own crypto
{
  const { encryptPayload, vapidAuthorization } = await import('../server/webpush.js');
  const nodeCrypto = await import('node:crypto');
  const ua = nodeCrypto.createECDH('prime256v1');
  ua.generateKeys();
  const authSecret = nodeCrypto.randomBytes(16);
  const sub = { endpoint: 'https://push.example.com/x', p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };
  const body = Buffer.from(await encryptPayload(sub, '{"title":"Hello"}'));
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const hmac = (key, data) => nodeCrypto.createHmac('sha256', key).update(data).digest();
  const ecdh = ua.computeSecret(asPublic);
  const prkKey = hmac(authSecret, ecdh);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])])).subarray(0, 32);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const decipher = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  check(plain.at(-1) === 2 && plain.subarray(0, -1).toString() === '{"title":"Hello"}' && body.readUInt32BE(16) === 4096, 'push: the message decrypts with the standard Web Push method');
  const authz = await vapidAuthorization({ VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY }, sub.endpoint);
  const [, jwt] = authz.match(/t=([^,]+)/);
  const [h, c, sig] = jwt.split('.');
  const verifyKey = nodeCrypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(VAPID_PUBLIC_KEY, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(VAPID_PUBLIC_KEY, 'base64url').subarray(33).toString('base64url') }, format: 'jwk' });
  const ok = nodeCrypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: verifyKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  check(ok && claims.aud === 'https://push.example.com' && authz.includes(`k=${VAPID_PUBLIC_KEY}`), 'push: the VAPID signature verifies and names the push service');
}

// Invite links: sign in without Google
check((await owner.send('/api/me')).data.google === false, 'invites: the portal says when Google sign-in is not set up');
const inv = await owner.send('/api/admin/invites', { method: 'POST', body: { name: 'Ivy Invited', email: 'ivy@example.com', client_id: clientA, plan_ids: [planId] } });
check(inv.status === 201 && /\/auth\/invite\?t=/.test(inv.data.link), 'invites: the owner gets a private sign-in link');
check((await member.send('/api/admin/invites', { method: 'POST', body: { name: 'x', email: 'x@example.com' } })).status === 403, 'invites: members cannot invite people');
check((await owner.send('/api/admin/invites', { method: 'POST', body: { name: 'Bad', email: 'not-an-email' } })).status === 400, 'invites: a real email is required');
check((await owner.send('/api/admin/invites', { method: 'POST', body: { name: 'Wrong', email: 'ivy@example.com', client_id: clientB } })).status === 409, 'invites: a person cannot be invited into another client');
const ivy = person('ivy@example.com', 'Ivy Invited');
const invPath = new URL(inv.data.link).pathname + new URL(inv.data.link).search;
const used = await ivy.send(invPath);
check(used.status === 302 && used.location === '/portal/', 'invites: opening the link signs the person in');
const ivyMe = (await ivy.send('/api/me')).data.user;
check(ivyMe.status === 'approved' && (await ivy.send(`/api/plans/${planId}`)).status === 200 && (await ivy.send(`/api/plans/${planB}`)).status === 403, 'invites: they see their client’s plan and nothing else');
const reused = await person('someone@example.com', 'Someone').send(invPath);
check(reused.status === 302 && reused.location === '/portal/#/invite-expired', 'invites: a link works only once');
check((await ivy.send('/auth/invite?t=made-up')).location === '/portal/#/invite-expired', 'invites: a made-up link does nothing');
const fresh = await owner.send(`/api/admin/users/${ivyMe.id}/invite`, { method: 'POST', body: {} });
check(fresh.status === 201 && fresh.data.link !== inv.data.link, 'invites: the owner can send a new link');
await owner.send(`/api/admin/users/${ivyMe.id}`, { method: 'POST', body: { status: 'blocked' } });
const blockedUse = await person('ivy2@example.com', 'x').send(new URL(fresh.data.link).pathname + new URL(fresh.data.link).search);
check(blockedUse.location === '/portal/#/blocked', 'invites: a blocked person’s link does not sign them in');

// Sign out
check((await member.send('/auth/logout', { method: 'POST' })).status === 200, 'sign out works');
check((await member.send('/api/me')).data.user === null, 'after sign-out the session is gone');

server.close();
for (const p of passes) console.log(`  ok    ${p}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\nPortal API: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
