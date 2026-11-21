/* Members portal: sign in with Google, follow development plans, chat, and (for the owner) approve people,
   review agent proposals and read the summary. Talks only to this site's /api. Every element is built with
   textContent, never raw HTML, so nothing anyone types can inject markup. */
(() => {
  'use strict';

  const app = document.getElementById('app');
  const nav = document.getElementById('portal-nav');
  const toastEl = document.getElementById('toast');
  const state = { user: null, pollTimer: null, installPrompt: null, ownerCount: 0 };

  /* ---------- helpers ---------- */

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
  }

  // Run an action from a button: disables it while working and reports errors.
  async function act(button, fn) {
    if (button) button.disabled = true;
    try {
      await fn();
    } catch (e) {
      toast(e.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  function ago(iso) {
    if (!iso) return '';
    const s = (new Date(iso) - Date.now()) / 1000;
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
    return 'just now';
  }
  const when = iso => h('time', { datetime: iso, title: new Date(iso).toLocaleString() }, ago(iso));
  const money = cents => '$' + ((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

  function progressBar(p, label) {
    return h('div', { class: 'progress' },
      h('div', { class: 'bar', role: 'progressbar', 'aria-label': label || 'Progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p.percent) },
        h('span', { style: `width:${p.percent}%` })),
      h('span', { class: 'mono small' }, `${p.done}/${p.total} done · ${p.percent}%`));
  }

  function field(label, input) {
    const id = `f${Math.random().toString(36).slice(2, 9)}`;
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label), input);
  }

  function initials(name) {
    return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function setView(title, ...nodes) {
    stopPolling();
    document.title = `${title} · Kovalenko Creatives`;
    app.replaceChildren(...nodes);
  }

  function stopPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  /* ---------- header ---------- */

  function renderNav() {
    const items = [];
    const u = state.user;
    if (u && u.status === 'approved') {
      items.push(h('a', { href: '#/' }, '/plans'));
      if (u.role === 'owner') {
        items.push(h('a', { href: '#/owner' }, '/owner', state.ownerCount ? h('span', { class: 'badge', 'aria-label': `${state.ownerCount} waiting` }, String(state.ownerCount)) : null));
      }
    }
    if (state.installPrompt) {
      items.push(h('button', { type: 'button', class: 'linkish', onclick: installApp }, 'Install app'));
    }
    if (u) {
      items.push(h('button', { type: 'button', class: 'cta', onclick: signOut }, 'Sign out'));
    }
    nav.replaceChildren(...items);
  }

  async function signOut() {
    await act(null, async () => {
      await api('/auth/logout', { method: 'POST' });
      state.user = null;
      location.hash = '#/';
      await start();
    });
  }

  /* ---------- signed out / waiting ---------- */

  function signInView() {
    const back = `/portal/${location.hash || '#/'}`;
    const cancelled = location.hash === '#/signin-cancelled';
    setView('Members',
      h('section', { class: 'hero-card' },
        h('span', { class: 'path' }, '/members'),
        h('h1', {}, 'Members portal'),
        h('p', { class: 'lede' }, 'Follow your project’s development plan, see what’s done and what’s next, leave comments and talk with the studio.'),
        cancelled ? h('p', { class: 'notice' }, 'Sign-in was cancelled. You can try again any time.') : null,
        h('a', { class: 'btn google', href: `/auth/google?return=${encodeURIComponent(back)}` }, googleMark(), 'Continue with Google'),
        h('p', { class: 'muted small' }, 'New here? Sign in with Google and the studio will approve your access. Only your name and email are used.')));
  }

  function googleMark() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 18 18');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    const parts = [
      ['#4285F4', 'M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z'],
      ['#34A853', 'M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z'],
      ['#FBBC05', 'M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z'],
      ['#EA4335', 'M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z'],
    ];
    for (const [fill, d] of parts) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('fill', fill);
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  function pendingView() {
    const u = state.user;
    const note = h('textarea', { rows: '3', maxlength: '500', placeholder: 'Optional: who you are and which project you’re part of' });
    note.value = u.request_note || '';
    const send = h('button', { type: 'submit', class: 'btn' }, u.request_note ? 'Update note' : 'Send note');
    setView('Waiting for approval',
      h('section', { class: 'hero-card' },
        h('span', { class: 'path' }, '/members/waiting'),
        h('h1', {}, `Thanks, ${u.name.split(' ')[0]}.`),
        h('p', { class: 'lede' }, 'Your access is waiting for approval. You’ll see your project here as soon as the studio approves it.'),
        h('p', { class: 'muted small' }, `Signed in as ${u.email}`),
        h('form', {
          class: 'stack', onsubmit: e => {
            e.preventDefault();
            act(send, async () => {
              await api('/api/me/request', { method: 'POST', body: { note: note.value } });
              u.request_note = note.value;
              toast('Note sent to the studio');
            });
          },
        }, field('A note for the studio', note), h('div', {}, send))));
    // Move on by itself as soon as the studio decides.
    state.pollTimer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const { user } = await api('/api/me');
        if (!user || user.status !== 'pending') start();
      } catch { /* offline: try again later */ }
    }, 15000);
  }

  function blockedView() {
    setView('No access',
      h('section', { class: 'hero-card' },
        h('h1', {}, 'No access'),
        h('p', { class: 'lede' }, 'This account doesn’t have access to the members portal. If you think that’s a mistake, email the studio.'),
        h('a', { class: 'btn ghost', href: 'mailto:kovalenkocreatives@gmail.com' }, 'Email the studio')));
  }

  /* ---------- plans list ---------- */

  async function plansView() {
    const { plans } = await api('/api/plans');
    const isOwner = state.user.role === 'owner';
    const cards = plans.map(p => {
      const open = p.membership === 'approved';
      return h('article', { class: 'plan-card' },
        h('div', { class: 'plan-top' },
          h('span', { class: 'mono small' }, `// ${[isOwner ? p.client_name || 'no client' : null, p.status, isOwner && !p.listed ? 'unlisted' : null].filter(Boolean).join(' · ')}`),
          h('h2', {}, open ? h('a', { href: `#/plan/${p.id}` }, p.title) : p.title)),
        open ? h('p', { class: 'muted' }, p.summary || 'No summary yet.') : h('p', { class: 'muted' }, 'Ask to join to see this plan.'),
        open ? progressBar(p.progress, `${p.title} progress`) : null,
        open && p.money && p.money.total_cents ? h('p', { class: 'small money-line' }, h('b', {}, money(p.money.owed_cents)), ' balance owed', p.money.due_now_cents ? h('span', { class: 'chip due' }, `${money(p.money.due_now_cents)} due now`) : null) : null,
        h('div', { class: 'row' },
          open
            ? h('a', { class: 'btn small', href: `#/plan/${p.id}${p.unread ? '/chat' : ''}` }, p.unread ? `${p.unread} new message${p.unread === 1 ? '' : 's'}` : 'Open plan')
            : p.membership === 'pending'
              ? h('span', { class: 'chip' }, 'Request sent')
              : joinButton(p),
          h('span', { class: 'muted small' }, 'Updated ', when(p.updated_at))));
    });
    const content = [
      h('div', { class: 'sec-head' },
        h('div', {}, h('span', { class: 'path' }, '/plans'), h('h1', {}, 'Development plans')),
        h('p', {}, isOwner ? 'Every plan. Members see the ones you approve them for.' : 'Plans you’re part of, and others you can ask to join.')),
      cards.length ? h('div', { class: 'plan-grid' }, cards) : h('p', { class: 'empty' }, isOwner ? 'No plans yet. Create the first one below.' : 'No plans to show yet.'),
    ];
    if (isOwner) content.push(newPlanForm());
    setView('Plans', ...content);
  }

  function joinButton(p) {
    const b = h('button', { type: 'button', class: 'btn small ghost' }, 'Ask to join');
    b.addEventListener('click', () => act(b, async () => {
      const note = prompt(`Ask to join “${p.title}”. Add a note for the studio (optional):`, '');
      if (note === null) return;
      await api(`/api/plans/${p.id}/join`, { method: 'POST', body: { note } });
      toast('Request sent');
      route();
    }));
    return b;
  }

  function newPlanForm() {
    const title = h('input', { type: 'text', maxlength: '120', required: true });
    const summary = h('textarea', { rows: '2', maxlength: '2000' });
    const btn = h('button', { type: 'submit', class: 'btn' }, 'Create plan');
    return h('details', { class: 'panel-box' },
      h('summary', {}, 'New plan'),
      h('form', {
        class: 'stack', onsubmit: e => {
          e.preventDefault();
          act(btn, async () => {
            const { id } = await api('/api/plans', { method: 'POST', body: { title: title.value, summary: summary.value } });
            location.hash = `#/plan/${id}`;
          });
        },
      }, field('Title', title), field('Summary', summary), h('div', {}, btn)));
  }

  /* ---------- one plan ---------- */

  const TABS = [['progress', 'Progress'], ['chat', 'Chat'], ['updates', 'Updates'], ['ideas', 'Ideas'], ['agreement', 'Agreement']];

  async function planView(id, tab) {
    tab = TABS.some(t => t[0] === tab) ? tab : 'progress';
    const { plan } = await api(`/api/plans/${id}`);
    const isOwner = state.user.role === 'owner';
    const clients = isOwner ? (await api('/api/admin/clients')).clients : [];
    const panel = h('div', { class: 'tab-panel', role: 'tabpanel', id: 'tab-panel', 'aria-labelledby': `tab-${tab}` });
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Plan sections' },
      TABS.map(([key, label]) => h('a', {
        href: `#/plan/${id}/${key}`, role: 'tab', id: `tab-${key}`, 'aria-selected': String(key === tab), 'aria-controls': 'tab-panel',
        class: key === tab ? 'active' : '',
      }, label, key === 'chat' && plan.unread && tab !== 'chat' ? h('span', { class: 'badge', 'aria-label': `${plan.unread} unread` }, String(plan.unread)) : null)));
    setView(plan.title,
      h('a', { class: 'back mono small', href: '#/' }, '← all plans'),
      h('section', { class: 'plan-head' },
        h('div', {},
          h('span', { class: 'path' }, `/${plan.client_name ? plan.client_name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'plans'}/${plan.status}`),
          h('h1', {}, plan.title),
          plan.summary ? h('p', { class: 'lede' }, plan.summary) : null),
        h('div', { class: 'plan-meter' },
          h('b', {}, `${plan.progress.percent}%`),
          progressBar(plan.progress, 'Plan progress'),
          isOwner ? planSettings(plan, clients) : null)),
      tabs, panel);
    if (tab === 'progress') renderProgress(panel, plan, isOwner);
    if (tab === 'chat') renderPosts(panel, plan, 'message');
    if (tab === 'updates') renderPosts(panel, plan, 'update');
    if (tab === 'ideas') renderPosts(panel, plan, 'idea');
    if (tab === 'agreement') await renderAgreement(panel, plan, isOwner);
  }

  function planSettings(plan, clients) {
    const status = h('select', {}, ['active', 'paused', 'done'].map(s => h('option', { value: s, selected: s === plan.status }, s)));
    const client = h('select', {}, h('option', { value: '' }, 'No client'), clients.map(c => h('option', { value: c.id, selected: c.id === plan.client_id }, c.name)));
    const listed = h('input', { type: 'checkbox', checked: plan.listed });
    const save = () => act(null, async () => {
      await api(`/api/plans/${plan.id}`, { method: 'PATCH', body: { status: status.value, listed: listed.checked, client_id: client.value || null } });
      toast('Plan saved');
    });
    status.addEventListener('change', save);
    listed.addEventListener('change', save);
    client.addEventListener('change', () => {
      if (plan.client_id && client.value !== plan.client_id && !confirm('Move this plan to another client? People from the old client lose access.')) {
        client.value = plan.client_id;
        return;
      }
      plan.client_id = client.value || null;
      save();
    });
    return h('div', { class: 'plan-settings' }, h('div', { class: 'row small' }, field('Client', client), field('Status', status)), h('label', { class: 'check small' }, listed, 'Client’s people can ask to join'));
  }

  const STATUS_LABEL = { todo: 'To do', doing: 'In progress', done: 'Done' };

  function renderProgress(panel, plan, isOwner) {
    const groups = plan.phases.map(ph => ({ ...ph, tasks: plan.tasks.filter(t => t.phase_id === ph.id) }));
    const loose = plan.tasks.filter(t => !t.phase_id || !plan.phases.some(ph => ph.id === t.phase_id));
    if (loose.length || !groups.length) groups.push({ id: null, title: groups.length ? 'Other tasks' : 'Tasks', tasks: loose });
    for (const g of groups) {
      const p = { total: g.tasks.length, done: g.tasks.filter(t => t.status === 'done').length };
      p.percent = p.total ? Math.round((p.done / p.total) * 100) : 0;
      panel.append(h('section', { class: 'phase' },
        h('div', { class: 'phase-head' }, h('h2', {}, g.title), h('span', { class: 'mono small' }, `${p.done}/${p.total}`)),
        h('div', { class: 'bar thin', 'aria-hidden': 'true' }, h('span', { style: `width:${p.percent}%` })),
        g.tasks.length ? h('ul', { class: 'tasks' }, g.tasks.map(t => taskRow(t, plan, isOwner))) : h('p', { class: 'muted small' }, 'No tasks yet.'),
        isOwner ? addTaskForm(plan, g.id) : null));
    }
    if (isOwner) panel.append(addPhaseForm(plan));
  }

  function taskRow(t, plan, isOwner) {
    let statusEl;
    if (isOwner) {
      statusEl = h('select', { class: `status-select s-${t.status}`, 'aria-label': `Status of ${t.title}` },
        Object.entries(STATUS_LABEL).map(([v, l]) => h('option', { value: v, selected: v === t.status }, l)));
      statusEl.addEventListener('change', () => act(statusEl, async () => {
        await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: statusEl.value } });
        route();
      }));
    } else {
      statusEl = h('span', { class: `chip s-${t.status}` }, STATUS_LABEL[t.status]);
    }
    const thread = h('div', { class: 'thread', hidden: true });
    const toggle = h('button', { type: 'button', class: 'linkish small', 'aria-expanded': 'false' }, t.comments ? `${t.comments} comment${t.comments === 1 ? '' : 's'}` : 'Comment');
    toggle.addEventListener('click', () => {
      const open = thread.hidden;
      thread.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open && !thread.childElementCount) loadThread(thread, plan, t);
    });
    return h('li', { class: `task s-${t.status}` },
      h('div', { class: 'task-main' },
        statusEl,
        h('span', { class: 'task-title' }, t.title),
        t.done_at ? h('span', { class: 'muted small' }, 'done ', when(t.done_at)) : null,
        toggle),
      thread);
  }

  async function loadThread(thread, plan, task) {
    thread.append(h('p', { class: 'muted small' }, 'Loading…'));
    try {
      const { posts } = await api(`/api/plans/${plan.id}/posts?kind=message&task=${encodeURIComponent(task.id)}`);
      const list = h('ol', { class: 'posts compact' }, posts.map(postItem));
      thread.replaceChildren(list, composer({ placeholder: 'Add a comment', button: 'Comment', onsend: async body => {
        const { post } = await api(`/api/plans/${plan.id}/posts`, { method: 'POST', body: { body, task_id: task.id } });
        list.append(postItem(post));
      } }));
    } catch (e) {
      thread.replaceChildren(h('p', { class: 'error-text' }, e.message));
    }
  }

  function addTaskForm(plan, phaseId) {
    const input = h('input', { type: 'text', maxlength: '300', placeholder: 'New task', 'aria-label': 'New task' });
    const btn = h('button', { type: 'submit', class: 'btn small ghost' }, 'Add');
    return h('form', {
      class: 'inline-form', onsubmit: e => {
        e.preventDefault();
        if (!input.value.trim()) return;
        act(btn, async () => {
          await api(`/api/plans/${plan.id}/tasks`, { method: 'POST', body: { title: input.value, phase_id: phaseId } });
          route();
        });
      },
    }, input, btn);
  }

  function addPhaseForm(plan) {
    const input = h('input', { type: 'text', maxlength: '120', placeholder: 'New phase, e.g. Stage 2: launch', 'aria-label': 'New phase' });
    const btn = h('button', { type: 'submit', class: 'btn small' }, 'Add phase');
    return h('form', {
      class: 'inline-form phase-form', onsubmit: e => {
        e.preventDefault();
        if (!input.value.trim()) return;
        act(btn, async () => {
          await api(`/api/plans/${plan.id}/phases`, { method: 'POST', body: { title: input.value } });
          route();
        });
      },
    }, input, btn);
  }

  /* ---------- agreement, payments, extra work ---------- */

  const BILLING_LABEL = { unbilled: 'Not billed yet', billed: 'Billed', no_charge: 'No charge' };

  async function renderAgreement(panel, plan, isOwner) {
    const { agreement: a } = await api(`/api/plans/${plan.id}/agreement`);
    const reload = () => route();
    if (!isOwner && !a.shared) {
      panel.append(h('p', { class: 'empty' }, 'The studio hasn’t shared the agreement for this project yet.'));
      return;
    }
    const m = a.money;
    const today = new Date().toISOString().slice(0, 10);

    // Where the agreement stands, and the one action that matters right now.
    let banner;
    if (a.status === 'accepted') {
      banner = h('div', { class: 'agree-banner ok' }, h('b', {}, 'Agreed. '), `Accepted by ${a.accepted_by.replace(/\s*\(.*\)$/, '')} on ${new Date(a.accepted_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`);
    } else if (a.status === 'shared') {
      const accept = h('button', { type: 'button', class: 'btn small' }, 'I accept this agreement');
      accept.addEventListener('click', () => {
        if (!confirm('Accept this agreement: what’s included, the terms and the payment plan?')) return;
        act(accept, async () => { await api(`/api/plans/${plan.id}/agreement/accept`, { method: 'POST', body: {} }); toast('Thank you, accepted'); reload(); });
      });
      banner = h('div', { class: 'agree-banner wait' },
        isOwner ? [h('b', {}, 'Shared. '), 'Waiting for the client to accept.'] : [h('b', {}, 'Please review. '), 'Read what’s included, the terms and the payments, then accept.'],
        isOwner ? draftButton(plan) : accept);
    } else {
      const share = h('button', { type: 'button', class: 'btn small' }, 'Share with client');
      share.addEventListener('click', () => act(share, async () => { await api(`/api/plans/${plan.id}/agreement`, { method: 'PATCH', body: { status: 'shared' } }); toast('Shared. The client can now read and accept it.'); reload(); }));
      banner = h('div', { class: 'agree-banner draft' }, h('b', {}, 'Draft. '), 'Only you can see this until you share it.', share);
    }

    const stats = h('div', { class: 'money-grid' },
      stat('Total agreed', money(m.total_cents)),
      stat('Paid', money(m.paid_cents)),
      stat('Balance owed', money(m.owed_cents), 'strong'),
      stat('Due now', money(m.due_now_cents), m.due_now_cents ? 'alert' : ''),
      m.extras_unbilled_count ? stat('Extra work not billed', m.extras_unbilled_cents ? money(m.extras_unbilled_cents) : `${m.extras_unbilled_count} item${m.extras_unbilled_count === 1 ? '' : 's'}`) : null);

    // What's included
    const scope = h('section', { class: 'phase' }, h('div', { class: 'phase-head' }, h('h2', {}, 'What’s included'), h('span', { class: 'mono small' }, String(a.scope.length))),
      a.scope.length ? h('ol', { class: 'scope' }, a.scope.map(s => h('li', {},
        h('div', { class: 'scope-main' }, h('b', {}, s.title), isOwner ? removeButton(`/api/scope/${s.id}`, `Remove “${s.title}”?`, reload) : null),
        s.detail ? h('p', { class: 'muted' }, s.detail) : null))) : h('p', { class: 'muted small' }, 'Nothing listed yet.'),
      isOwner ? scopeForm(plan, reload) : null);

    // Terms
    let terms;
    if (isOwner) {
      const t = h('textarea', { rows: '5', maxlength: '20000', placeholder: 'e.g. Two rounds of changes are included. Extra requests are quoted before work starts.' });
      t.value = a.terms;
      const save = h('button', { type: 'button', class: 'btn small ghost' }, 'Save terms');
      save.addEventListener('click', () => act(save, async () => { await api(`/api/plans/${plan.id}/agreement`, { method: 'PATCH', body: { terms: t.value } }); toast('Terms saved'); reload(); }));
      terms = h('section', { class: 'phase' }, h('h2', {}, 'Terms'), field('What both sides agree to', t), h('div', { class: 'row' }, save));
    } else if (a.terms) {
      terms = h('section', { class: 'phase' }, h('h2', {}, 'Terms'), h('p', { class: 'pre' }, a.terms));
    }

    // Payments
    const payRows = a.payments.map(p => {
      const state_ = p.paid_at ? 'paid' : p.due_date && p.due_date < today ? 'overdue' : p.due_date && p.due_date === today ? 'due' : 'upcoming';
      const label = { paid: `Paid ${new Date(p.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, overdue: 'Overdue', due: 'Due today', upcoming: 'Upcoming' }[state_];
      let statusEl = h('span', { class: `chip pay-${state_}` }, label);
      if (isOwner) {
        const box = h('input', { type: 'checkbox', checked: !!p.paid_at, 'aria-label': `${p.label} paid` });
        box.addEventListener('change', () => act(box, async () => { await api(`/api/payments/${p.id}`, { method: 'PATCH', body: { paid: box.checked } }); reload(); }));
        statusEl = h('span', { class: 'row' }, h('label', { class: 'check small' }, box, 'Paid'), statusEl);
      }
      return h('li', { class: `pay-row ${state_}` },
        h('div', {}, h('b', {}, p.label), h('div', { class: 'muted small' }, p.due_date ? `Due ${day(p.due_date)}` : 'No due date')),
        h('b', { class: 'amount' }, money(p.amount_cents)),
        statusEl,
        isOwner ? removeButton(`/api/payments/${p.id}`, `Remove the payment “${p.label}”?`, reload) : null);
    });
    const payments = h('section', { class: 'phase' }, h('div', { class: 'phase-head' }, h('h2', {}, 'Payments'), m.next_due ? h('span', { class: 'small muted' }, `Next: ${money(m.next_due.amount_cents)} on ${day(m.next_due.due_date)}`) : null),
      payRows.length ? h('ul', { class: 'pay-list' }, payRows) : h('p', { class: 'muted small' }, 'No payments set up yet.'),
      isOwner ? paymentForm(plan, reload) : null);

    // Extra work log
    const extras = h('section', { class: 'phase' },
      h('div', { class: 'phase-head' }, h('h2', {}, 'Extra work'), h('span', { class: 'small muted' }, 'Outside what’s included')),
      h('p', { class: 'muted small' }, isOwner ? 'Log anything you do beyond the agreement, even if you don’t charge for it yet. Bill it later with one tap, or mark it no charge.' : 'Work the studio did beyond the agreement. Items marked “not billed yet” aren’t part of your balance unless they are billed later.'),
      a.extras.length ? h('ul', { class: 'extra-list' }, a.extras.map(e => extraRow(e, isOwner, reload))) : h('p', { class: 'muted small' }, 'Nothing logged yet.'),
      isOwner ? extraForm(plan, reload) : null);

    panel.append(banner, stats, scope, terms || '', payments, extras);
  }

  function stat(label, value, cls) {
    return h('div', { class: `stat ${cls || ''}` }, h('span', { class: 'mono small' }, label), h('b', {}, value));
  }

  function draftButton(plan) {
    const b = h('button', { type: 'button', class: 'btn small ghost' }, 'Back to draft');
    b.addEventListener('click', () => act(b, async () => { await api(`/api/plans/${plan.id}/agreement`, { method: 'PATCH', body: { status: 'draft' } }); route(); }));
    return b;
  }

  function removeButton(path, question, done) {
    const b = h('button', { type: 'button', class: 'linkish small' }, 'Remove');
    b.addEventListener('click', () => { if (confirm(question)) act(b, async () => { await api(path, { method: 'DELETE' }); done(); }); });
    return b;
  }

  function scopeForm(plan, done) {
    const title = h('input', { type: 'text', maxlength: '300', placeholder: 'e.g. Five-page website' });
    const detail = h('input', { type: 'text', maxlength: '2000', placeholder: 'Optional detail' });
    const btn = h('button', { type: 'submit', class: 'btn small ghost' }, 'Add');
    return h('form', { class: 'grid-form', onsubmit: e => { e.preventDefault(); act(btn, async () => { await api(`/api/plans/${plan.id}/scope`, { method: 'POST', body: { title: title.value, detail: detail.value } }); done(); }); } },
      field('Included item', title), field('Detail', detail), btn);
  }

  function paymentForm(plan, done) {
    const label = h('input', { type: 'text', maxlength: '200', placeholder: 'e.g. Deposit' });
    const amount = h('input', { type: 'text', inputmode: 'decimal', placeholder: '1,500' });
    const due = h('input', { type: 'date' });
    const btn = h('button', { type: 'submit', class: 'btn small ghost' }, 'Add payment');
    return h('form', { class: 'grid-form', onsubmit: e => { e.preventDefault(); act(btn, async () => { await api(`/api/plans/${plan.id}/payments`, { method: 'POST', body: { label: label.value, amount: amount.value, due_date: due.value } }); done(); }); } },
      field('Payment', label), field('Amount ($)', amount), field('Due', due), btn);
  }

  function extraRow(e, isOwner, done) {
    const facts = [day(e.work_date), e.hours ? `${e.hours} h` : null, e.amount_cents ? money(e.amount_cents) : null].filter(Boolean).join(' · ');
    const actions = [];
    if (isOwner && e.billing === 'unbilled') {
      const bill = h('button', { type: 'button', class: 'btn small ghost' }, 'Bill it');
      bill.addEventListener('click', () => {
        const amt = prompt('Amount to bill ($):', e.amount_cents ? (e.amount_cents / 100).toFixed(2) : '');
        if (!amt) return;
        act(bill, async () => { await api(`/api/extras/${e.id}/bill`, { method: 'POST', body: { amount: amt } }); toast('Added to payments'); done(); });
      });
      const free = h('button', { type: 'button', class: 'linkish small' }, 'No charge');
      free.addEventListener('click', () => act(free, async () => { await api(`/api/extras/${e.id}`, { method: 'PATCH', body: { billing: 'no_charge' } }); done(); }));
      actions.push(bill, free);
    }
    if (isOwner && e.billing !== 'billed') {
      const vis = h('button', { type: 'button', class: 'linkish small' }, e.visible ? 'Hide from client' : 'Show to client');
      vis.addEventListener('click', () => act(vis, async () => { await api(`/api/extras/${e.id}`, { method: 'PATCH', body: { visible: !e.visible } }); done(); }));
      actions.push(vis, removeButton(`/api/extras/${e.id}`, `Remove “${e.title}” from the log?`, done));
    }
    return h('li', { class: 'extra' },
      h('div', { class: 'extra-main' }, h('b', {}, e.title), h('span', { class: `chip bill-${e.billing}` }, BILLING_LABEL[e.billing]), isOwner && !e.visible ? h('span', { class: 'chip' }, 'private') : null),
      h('div', { class: 'muted small' }, facts),
      e.detail ? h('p', { class: 'pre small' }, e.detail) : null,
      actions.length ? h('div', { class: 'row' }, actions) : null);
  }

  function extraForm(plan, done) {
    const title = h('input', { type: 'text', maxlength: '300', placeholder: 'e.g. Set up their email forwarding' });
    const detail = h('textarea', { rows: '2', maxlength: '4000', placeholder: 'Optional detail' });
    const date = h('input', { type: 'date' });
    date.value = new Date().toISOString().slice(0, 10);
    const hours = h('input', { type: 'text', inputmode: 'decimal', placeholder: '1.5' });
    const amount = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'optional' });
    const free = h('input', { type: 'checkbox' });
    const visible = h('input', { type: 'checkbox', checked: true });
    const btn = h('button', { type: 'submit', class: 'btn small' }, 'Log extra work');
    return h('details', { class: 'panel-box inner' }, h('summary', {}, 'Log extra work'),
      h('form', { class: 'stack', onsubmit: e => { e.preventDefault(); act(btn, async () => {
        await api(`/api/plans/${plan.id}/extras`, { method: 'POST', body: { title: title.value, detail: detail.value, work_date: date.value, hours: hours.value, amount: amount.value, billing: free.checked ? 'no_charge' : 'unbilled', visible: visible.checked } });
        toast('Logged');
        done();
      }); } },
      field('What you did', title), field('Detail', detail),
      h('div', { class: 'grid-form' }, field('Date', date), field('Hours', hours), field('Value ($)', amount)),
      h('label', { class: 'check' }, free, 'No charge (goodwill)'),
      h('label', { class: 'check' }, visible, 'Client can see this'),
      h('div', {}, btn)));
  }

  /* ---------- chat, updates, ideas ---------- */

  const KIND_TEXT = {
    message: { empty: 'No messages yet. Ask a question or share feedback.', placeholder: 'Write a message', button: 'Send' },
    update: { empty: 'No progress updates yet.', placeholder: 'What changed this week?', button: 'Post update' },
    idea: { empty: 'No ideas yet. Suggest a feature or a next step.', placeholder: 'Describe your idea', button: 'Suggest' },
  };

  function postItem(p) {
    const own = p.author_role === 'owner';
    return h('li', { class: `post${own ? ' from-owner' : ''}${p.mine ? ' mine' : ''}` },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(p.author_name)),
      h('div', { class: 'post-body' },
        h('div', { class: 'post-meta' }, h('b', {}, p.author_name), own ? h('span', { class: 'chip tiny' }, 'studio') : null, when(p.created_at)),
        postText(p)));
  }

  // Long messages stay easy to read: a short version first (when there is one), the full text a tap away.
  const LONG = 600;
  function postText(p) {
    if (p.body.length < LONG) return h('p', {}, p.body);
    const full = h('p', { class: 'full' }, p.body);
    const words = p.body.trim().split(/\s+/).length;
    const minutes = Math.max(1, Math.round(words / 200));
    if (p.summary) {
      full.hidden = true;
      const toggle = h('button', { type: 'button', class: 'linkish small', 'aria-expanded': 'false' }, `Read the full message (${minutes} min)`);
      toggle.addEventListener('click', () => {
        full.hidden = !full.hidden;
        toggle.setAttribute('aria-expanded', String(!full.hidden));
        toggle.textContent = full.hidden ? `Read the full message (${minutes} min)` : 'Show less';
      });
      return h('div', {}, h('div', { class: 'short-version' }, h('span', { class: 'mono small' }, 'short version'), h('p', {}, p.summary)), full, toggle);
    }
    full.classList.add('clamped');
    const more = h('button', { type: 'button', class: 'linkish small', 'aria-expanded': 'false' }, `Show more (${minutes} min read)`);
    more.addEventListener('click', () => {
      const open = full.classList.toggle('clamped');
      more.setAttribute('aria-expanded', String(!open));
      more.textContent = open ? `Show more (${minutes} min read)` : 'Show less';
    });
    return h('div', {}, full, more);
  }

  async function renderPosts(panel, plan, kind) {
    const t = KIND_TEXT[kind];
    const isOwner = state.user.role === 'owner';
    const list = h('ol', { class: 'posts', 'aria-live': kind === 'message' ? 'polite' : 'off' });
    const empty = h('p', { class: 'empty' }, t.empty);
    let last = '';
    const add = posts => {
      for (const p of posts) {
        const item = postItem(p);
        if (kind === 'idea' && isOwner) item.querySelector('.post-body').append(ideaToTask(plan, p));
        list.append(item);
        last = p.created_at > last ? p.created_at : last;
      }
      empty.hidden = list.childElementCount > 0;
    };
    const load = async () => {
      const { posts } = await api(`/api/plans/${plan.id}/posts?kind=${kind}&after=${encodeURIComponent(last)}`);
      const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
      add(posts);
      if (posts.length && kind === 'message' && nearBottom && last) window.scrollTo({ top: document.body.scrollHeight });
    };
    panel.append(empty, list);
    if (kind !== 'update' || isOwner) {
      panel.append(composer({ placeholder: t.placeholder, button: t.button, onsend: async body => {
        await api(`/api/plans/${plan.id}/posts`, { method: 'POST', body: { kind, body } });
        await load();
      } }));
    }
    await load();
    if (kind === 'message') state.pollTimer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 8000);
  }

  function ideaToTask(plan, post) {
    const b = h('button', { type: 'button', class: 'linkish small' }, 'Add as task');
    b.addEventListener('click', () => act(b, async () => {
      const title = prompt('Task title:', post.body.slice(0, 300));
      if (!title) return;
      await api(`/api/plans/${plan.id}/tasks`, { method: 'POST', body: { title } });
      toast('Added to the plan');
    }));
    return b;
  }

  function composer({ placeholder, button, onsend }) {
    const input = h('textarea', { rows: '2', maxlength: '4000', placeholder, 'aria-label': placeholder });
    const btn = h('button', { type: 'submit', class: 'btn small' }, button);
    const form = h('form', {
      class: 'composer', onsubmit: e => {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        act(btn, async () => {
          await onsend(body);
          input.value = '';
        });
      },
    }, input, btn);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
    });
    return form;
  }

  /* ---------- owner dashboard ---------- */

  async function ownerView() {
    const [overview, { plans }, { agents }, { activity }, { users }, board, { clients }] = await Promise.all([
      api('/api/admin/overview'), api('/api/plans'), api('/api/admin/agents'), api('/api/admin/activity?limit=30'), api('/api/admin/users'),
      api('/api/admin/board'), api('/api/admin/clients'),
    ]);
    state.ownerCount = overview.pending_users.length + overview.pending_joins.length + overview.proposals.length;
    renderNav();
    const waitingCount = state.ownerCount;
    setView('Owner',
      h('div', { class: 'sec-head' },
        h('div', {}, h('span', { class: 'path' }, '/owner'), h('h1', {}, 'Owner dashboard')),
        h('p', {}, waitingCount ? `${waitingCount} thing${waitingCount === 1 ? '' : 's'} waiting on you.` : 'Nothing is waiting on you.')),
      clientBoard(board),
      summaryBox(overview.summary),
      waitingSection('People asking for access', overview.pending_users, u => personRequest(u, plans, clients), 'No one is waiting.'),
      waitingSection('Join requests', overview.pending_joins, joinRequest, 'No join requests.'),
      waitingSection('Agent proposals', overview.proposals, proposalCard, 'No proposals waiting. Agents send them here when they think they can help.'),
      agentsSection(agents),
      peopleSection(users),
      activitySection(activity));
  }

  const AGREEMENT_LABEL = { draft: 'agreement: draft', shared: 'awaiting acceptance', accepted: 'agreed' };

  // Every client and their projects at a glance. Each client is its own box, so nothing mixes.
  function clientBoard(board) {
    const t = board.totals;
    const name = h('input', { type: 'text', maxlength: '120', placeholder: 'Client or organization name' });
    const add = h('button', { type: 'submit', class: 'btn small ghost' }, 'Add client');
    return h('section', { class: 'owner-section board' },
      h('h2', {}, 'Clients and projects'),
      h('div', { class: 'money-grid' },
        stat('Active projects', String(t.active_projects)),
        stat('Owed to you', money(t.owed_cents), 'strong'),
        stat('Due now', money(t.due_now_cents), t.due_now_cents ? 'alert' : ''),
        stat('Extra work not billed', money(t.unbilled_cents)),
        stat('Need a reply', String(t.needs_reply), t.needs_reply ? 'alert' : '')),
      board.clients.length
        ? h('div', { class: 'client-list' }, board.clients.map(c => h('article', { class: 'client' },
          h('div', { class: 'client-head' },
            h('h3', {}, c.name),
            h('span', { class: 'muted small' }, `${c.projects.length} project${c.projects.length === 1 ? '' : 's'}${c.id ? ` · ${c.people} ${c.people === 1 ? 'person' : 'people'}` : ''}`),
            c.owed_cents ? h('span', { class: 'chip' }, `${money(c.owed_cents)} owed`) : null),
          c.projects.length
            ? h('ul', { class: 'project-rows' }, c.projects.map(p => h('li', {},
              h('a', { href: `#/plan/${p.id}`, class: 'project-name' }, p.title),
              h('div', { class: 'project-progress' }, h('div', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width:${p.progress.percent}%` })), h('span', { class: 'mono small' }, `${p.progress.percent}%`)),
              h('div', { class: 'project-flags' },
                p.status !== 'active' ? h('span', { class: 'chip' }, p.status) : null,
                h('a', { class: `chip agree-${p.agreement_status}`, href: `#/plan/${p.id}/agreement` }, AGREEMENT_LABEL[p.agreement_status]),
                p.money.owed_cents ? h('a', { class: `chip${p.money.due_now_cents ? ' due' : ''}`, href: `#/plan/${p.id}/agreement` }, p.money.due_now_cents ? `${money(p.money.due_now_cents)} due` : `${money(p.money.owed_cents)} owed`) : null,
                p.money.extras_unbilled_count ? h('span', { class: 'chip' }, `${p.money.extras_unbilled_count} extra unbilled`) : null,
                p.needs_reply ? h('a', { class: 'chip due', href: `#/plan/${p.id}/chat` }, `${p.needs_reply} to reply`) : null))))
            : h('p', { class: 'muted small' }, 'No projects yet. Open a plan and choose this client.')))
        )
        : h('p', { class: 'empty' }, 'Add your first client, then assign plans to them.'),
      h('form', { class: 'inline-form', onsubmit: e => { e.preventDefault(); if (!name.value.trim()) return; act(add, async () => { await api('/api/admin/clients', { method: 'POST', body: { name: name.value } }); route(); }); } },
        field('New client', name), add));
  }

  function waitingSection(title, items, render, emptyText) {
    return h('section', { class: 'owner-section' },
      h('h2', {}, title, items.length ? h('span', { class: 'badge' }, String(items.length)) : null),
      items.length ? h('div', { class: 'cards' }, items.map(render)) : h('p', { class: 'muted small' }, emptyText));
  }

  function summaryBox(summary) {
    const days = h('select', { 'aria-label': 'Summary period' }, [[1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days']].map(([d, l]) => h('option', { value: d, selected: d === summary.days }, l)));
    const pre = h('pre', { class: 'summary-text' }, summary.text);
    const copy = h('button', { type: 'button', class: 'btn small ghost' }, 'Copy');
    copy.addEventListener('click', () => act(copy, async () => {
      await navigator.clipboard.writeText(pre.textContent);
      toast('Summary copied');
    }));
    days.addEventListener('change', () => act(days, async () => {
      const { summary: s } = await api(`/api/admin/summary?days=${days.value}`);
      pre.textContent = s.text;
    }));
    return h('section', { class: 'panel summary' },
      h('div', { class: 'panel-bar' }, h('i'), h('i'), h('i'), h('span', {}, 'summary.txt')),
      h('div', { class: 'summary-tools' }, days, copy),
      pre);
  }

  function personRequest(u, plans, clients) {
    const client = h('select', {}, h('option', { value: '' }, 'Choose a client'), clients.map(c => h('option', { value: c.id }, c.name)));
    const boxes = plans.map(p => h('label', { class: 'check', 'data-client': p.client_id || '' }, h('input', { type: 'checkbox', value: p.id }), p.title));
    // Only the chosen client's plans can be ticked, so nobody is added to another client's work.
    const filter = () => boxes.forEach(b => {
      const ok = !b.dataset.client || b.dataset.client === client.value;
      b.hidden = !ok;
      if (!ok) b.querySelector('input').checked = false;
    });
    client.addEventListener('change', filter);
    filter();
    const approve = h('button', { type: 'button', class: 'btn small' }, 'Approve');
    const block = h('button', { type: 'button', class: 'btn small ghost' }, 'Block');
    const card = h('article', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(u.name)), h('div', {}, h('b', {}, u.name), h('div', { class: 'muted small' }, u.email))),
      u.request_note ? h('blockquote', {}, u.request_note) : null,
      clients.length ? field('Client', client) : null,
      plans.length ? h('fieldset', { class: 'plans-pick' }, h('legend', { class: 'small muted' }, 'Also approve for:'), boxes) : null,
      h('div', { class: 'row' }, approve, block, h('span', { class: 'muted small' }, 'Asked ', when(u.created_at))));
    const decide = (btn, status) => act(btn, async () => {
      const plan_ids = boxes.map(b => b.querySelector('input')).filter(i => i.checked).map(i => i.value);
      await api(`/api/admin/users/${u.id}`, { method: 'POST', body: { status, plan_ids, client_id: client.value || null } });
      toast(status === 'approved' ? `${u.name} approved` : `${u.name} blocked`);
      route();
    });
    approve.addEventListener('click', () => decide(approve, 'approved'));
    block.addEventListener('click', () => { if (confirm(`Block ${u.name}?`)) decide(block, 'blocked'); });
    return card;
  }

  function joinRequest(j) {
    const yes = h('button', { type: 'button', class: 'btn small' }, 'Approve');
    const no = h('button', { type: 'button', class: 'btn small ghost' }, 'Decline');
    const decide = (btn, status) => act(btn, async () => {
      await api('/api/admin/memberships', { method: 'POST', body: { plan_id: j.plan_id, user_id: j.user_id, status } });
      route();
    });
    yes.addEventListener('click', () => decide(yes, 'approved'));
    no.addEventListener('click', () => decide(no, 'declined'));
    return h('article', { class: 'card' },
      h('div', {}, h('b', {}, j.name), ' wants to join ', h('b', {}, j.plan_title)),
      j.note ? h('blockquote', {}, j.note) : null,
      h('div', { class: 'row' }, yes, no, h('span', { class: 'muted small' }, when(j.requested_at))));
  }

  const KIND_LABEL = { fix: 'can fix', summary: 'summary', note: 'note' };

  function proposalCard(p) {
    const note = h('textarea', { rows: '2', maxlength: '2000', placeholder: 'Optional reply to the agent' });
    const yes = h('button', { type: 'button', class: 'btn small' }, 'Approve');
    const no = h('button', { type: 'button', class: 'btn small ghost' }, 'Decline');
    const decide = (btn, status) => act(btn, async () => {
      await api(`/api/admin/proposals/${p.id}`, { method: 'POST', body: { status, note: note.value } });
      toast(status === 'approved' ? 'Approved. The agent will pick it up.' : 'Declined');
      route();
    });
    yes.addEventListener('click', () => decide(yes, 'approved'));
    no.addEventListener('click', () => decide(no, 'declined'));
    return h('article', { class: 'card proposal' },
      h('div', { class: 'row' }, h('span', { class: 'chip' }, `${p.agent_name} · ${KIND_LABEL[p.kind]}`), p.confidence !== null ? h('span', { class: 'mono small' }, `${Math.round(p.confidence * 100)}% sure`) : null, h('span', { class: 'muted small' }, when(p.created_at))),
      h('h3', {}, p.title),
      p.plan_title ? h('div', { class: 'muted small' }, p.plan_title, p.task_title ? ` · ${p.task_title}` : '') : null,
      h('p', { class: 'pre' }, p.body),
      field('Reply', note),
      h('div', { class: 'row' }, yes, no));
  }

  function agentsSection(agents) {
    const name = h('input', { type: 'text', maxlength: '80', placeholder: 'e.g. Fix finder' });
    const btn = h('button', { type: 'submit', class: 'btn small' }, 'Create token');
    const out = h('div', {});
    const list = h('ul', { class: 'simple-list' }, agents.map(a => h('li', {},
      h('b', {}, a.name),
      h('span', { class: 'muted small' }, a.revoked_at ? 'revoked' : a.last_seen_at ? ['last checked in ', when(a.last_seen_at)] : 'not used yet'),
      a.revoked_at ? null : revokeButton(a))));
    return h('section', { class: 'owner-section' },
      h('h2', {}, 'Agents'),
      h('p', { class: 'muted small' }, 'Agents read plan activity and send you proposals. They can’t post to members or change anything until you approve.'),
      agents.length ? list : null,
      h('form', {
        class: 'inline-form', onsubmit: e => {
          e.preventDefault();
          act(btn, async () => {
            const a = await api('/api/admin/agents', { method: 'POST', body: { name: name.value } });
            const code = h('code', { class: 'token' }, a.token);
            out.replaceChildren(h('div', { class: 'notice' },
              h('p', {}, h('b', {}, 'Copy this token now. '), 'It won’t be shown again. Give it to the agent as KC_AGENT_TOKEN.'), code));
            name.value = '';
          });
        },
      }, field('New agent', name), btn),
      out);
  }

  function revokeButton(a) {
    const b = h('button', { type: 'button', class: 'linkish small' }, 'Revoke');
    b.addEventListener('click', () => {
      if (!confirm(`Revoke ${a.name}? Its token stops working immediately.`)) return;
      act(b, async () => {
        await api(`/api/admin/agents/${a.id}`, { method: 'DELETE' });
        route();
      });
    });
    return b;
  }

  function peopleSection(users) {
    return h('details', { class: 'owner-section panel-box' },
      h('summary', {}, `People (${users.length})`),
      h('ul', { class: 'simple-list' }, users.map(u => h('li', {},
        h('b', {}, u.name),
        h('span', { class: 'muted small' }, `${u.email} · ${u.role === 'owner' ? 'owner' : u.status}`),
        h('span', { class: 'small' }, u.plans.filter(p => p.status === 'approved').map(p => p.title).join(', ')),
        u.role !== 'owner' && u.status !== 'pending' ? statusToggle(u) : null))));
  }

  function statusToggle(u) {
    const next = u.status === 'blocked' ? 'approved' : 'blocked';
    const b = h('button', { type: 'button', class: 'linkish small' }, next === 'blocked' ? 'Block' : 'Unblock');
    b.addEventListener('click', () => {
      if (next === 'blocked' && !confirm(`Block ${u.name}? They are signed out right away.`)) return;
      act(b, async () => {
        await api(`/api/admin/users/${u.id}`, { method: 'POST', body: { status: next } });
        route();
      });
    });
    return b;
  }

  function activitySection(activity) {
    return h('section', { class: 'owner-section' },
      h('h2', {}, 'Recent activity'),
      activity.length
        ? h('ol', { class: 'activity' }, activity.map(a => h('li', {},
          h('span', { class: `dot ${a.actor_type}` }),
          h('span', {}, a.summary.length > 180 ? `${a.summary.slice(0, 180)}…` : a.summary),
          h('span', { class: 'muted small' }, a.plan_title ? `${a.plan_title} · ` : '', when(a.created_at)))))
        : h('p', { class: 'muted small' }, 'Nothing yet.'));
  }

  /* ---------- routing ---------- */

  async function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
    const u = state.user;
    try {
      if (!u) return signInView();
      if (u.status === 'blocked') return blockedView();
      if (u.status === 'pending') return pendingView();
      if (parts[0] === 'plan' && parts[1]) return await planView(parts[1], parts[2]);
      if (parts[0] === 'owner' && u.role === 'owner') return await ownerView();
      return await plansView();
    } catch (e) {
      if (e.status === 401) {
        state.user = null;
        renderNav();
        return signInView();
      }
      setView('Error', h('section', { class: 'hero-card' }, h('h1', {}, 'Something went wrong'), h('p', { class: 'lede' }, e.message), h('a', { class: 'btn ghost', href: '#/' }, 'Back to plans')));
    } finally {
      app.focus({ preventScroll: true });
    }
  }

  async function refreshOwnerCount() {
    if (state.user?.role !== 'owner') return;
    try {
      const o = await api('/api/admin/overview');
      state.ownerCount = o.pending_users.length + o.pending_joins.length + o.proposals.length;
      renderNav();
    } catch { /* ignore */ }
  }

  async function start() {
    if (location.hash === '#/blocked') {
      state.user = null;
      renderNav();
      return blockedView();
    }
    try {
      state.user = (await api('/api/me')).user;
    } catch {
      state.user = null;
    }
    renderNav();
    await route();
    refreshOwnerCount();
  }

  /* ---------- installable app ---------- */

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.installPrompt = e;
    renderNav();
  });

  async function installApp() {
    const p = state.installPrompt;
    if (!p) return;
    state.installPrompt = null;
    p.prompt();
    await p.userChoice.catch(() => {});
    renderNav();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }

  window.addEventListener('hashchange', route);
  start();
})();
