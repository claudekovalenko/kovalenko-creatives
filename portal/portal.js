// Client portal: Google sign-in through Supabase Auth, then projects, requests and comments.
// Talks to Supabase directly with plain fetch; every permission is enforced by the database
// (supabase/portal.sql), so this page only shows what the signed-in person is allowed to see.
(() => {
  'use strict';
  const CFG = window.PORTAL_CONFIG || {};
  const BASE = (CFG.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = CFG.publishableKey || '';
  const SESSION_KEY = 'portal-session';
  const app = document.getElementById('app');
  const nav = document.getElementById('portal-nav');

  const STATUS = {
    new: 'New', accepted: 'Accepted', declined: 'Declined', in_progress: 'In progress', review: 'Waiting for review', live: 'Live',
  };
  const RUN_STATUS = {
    queued: 'Queued', working: 'Agent working', ready: 'Ready for your review', approved: 'Approved, publishing',
    rejected: 'Rejected', merged: 'Published', failed: 'Failed',
  };

  // ── Small DOM helper: strings always become text, never HTML ──
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  const show = (...nodes) => { app.replaceChildren(...nodes.filter(Boolean)); };
  const when = iso => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const badge = status => h('span', { class: `badge s-${status}` }, STATUS[status] || status);
  const withHttps = u => (u ? `https:${'//'}${u.replace(/^[a-z]+:\/\//i, '')}` : null);
  const safeUrl = u => (/^https:\/\//.test(u || '') ? u : null);

  // ── Session (tokens from Supabase Auth, kept in this browser only) ──
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } },
    set(s) { try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ } },
  };
  let session = null;

  function takeTokensFromUrl() {
    if (!location.hash.includes('access_token=') && !location.hash.includes('error')) return null;
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    if (p.get('error')) return { error: p.get('error_description') || p.get('error') };
    const s = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600) };
    store.set(s);
    return s;
  }

  async function token() {
    if (!session) return null;
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    const res = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) { signOutLocal(); throw new Error('Your sign-in has expired. Please sign in again.'); }
    const d = await res.json();
    session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + d.expires_in };
    store.set(session);
    return session.access_token;
  }

  async function api(path, { method = 'GET', body, prefer } = {}) {
    const headers = { apikey: KEY, Authorization: `Bearer ${await token()}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401) { signOutLocal(); throw new Error('Your sign-in has expired. Please sign in again.'); }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || e.msg || `Request failed (${res.status})`);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }
  const db = (table, query = '', opts) => api(`/rest/v1/${table}${query ? `?${query}` : ''}`, opts);

  function signIn() {
    const back = location.origin + location.pathname;
    location.href = `${BASE}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`;
  }
  function signOutLocal() { session = null; store.set(null); }
  async function signOut() {
    try { await api('/auth/v1/logout', { method: 'POST' }); } catch { /* signing out locally is enough */ }
    signOutLocal();
    location.hash = '';
    start();
  }

  // ── Who is signed in ──
  let me = null;          // profile row
  let names = new Map();  // id → full name, for people you share a project with

  async function loadMe() {
    const user = await api('/auth/v1/user');
    const rows = await db('profiles', `id=eq.${user.id}&select=*`);
    me = rows[0] || { id: user.id, access: 'pending', is_owner: false, full_name: '' };
    if (me.access === 'approved') {
      names = new Map((await db('portal_people', 'select=id,full_name')).map(p => [p.id, p.full_name || 'Unnamed']));
    }
  }
  const nameOf = id => names.get(id) || 'Someone';
  const owner = () => me && me.is_owner && me.access === 'approved';

  function renderNav() {
    if (!me) { nav.replaceChildren(); return; }
    const links = me.access === 'approved'
      ? [h('a', { href: '#/' }, '/projects'), owner() && h('a', { href: '#/people' }, '/people'), owner() && h('a', { href: '#/updates' }, '/updates')]
      : [];
    nav.replaceChildren(...links.filter(Boolean), h('button', { class: 'link-btn', type: 'button', onclick: signOut }, 'Sign out'));
  }

  // ── Views ──
  function viewNotSetUp() {
    show(h('section', { class: 'portal-card' }, h('h1', {}, 'Client portal'), h('p', { class: 'portal-muted' }, 'The portal is not connected yet.')));
  }

  function viewSignIn(error) {
    show(h('section', { class: 'portal-card narrow' },
      h('p', { class: 'eyebrow mono' }, '/portal'),
      h('h1', {}, 'Client portal'),
      h('p', {}, 'Sign in to follow your projects and post requests and comments.'),
      error && h('p', { class: 'portal-error', role: 'alert' }, error),
      h('button', { class: 'btn', type: 'button', onclick: signIn }, 'Sign in with Google'),
      h('p', { class: 'portal-muted small' }, 'New here? After you sign in, your access is confirmed by hand before you can see any project.')));
  }

  function viewWaiting() {
    const blocked = me.access === 'blocked';
    show(h('section', { class: 'portal-card narrow' },
      h('h1', {}, blocked ? 'No access' : 'Thanks for signing in'),
      h('p', {}, blocked ? 'This account does not have access to the portal.' : 'Your access is waiting for approval. Once it is approved you will see your projects here.')));
  }

  async function viewProjects() {
    const projects = await db('projects', `select=id,name,description,archived&order=archived.asc,name.asc${owner() ? '' : '&archived=is.false'}`);
    const counts = new Map();
    if (projects.length) {
      for (const r of await db('requests', 'select=project_id,status&hidden=is.false')) {
        const c = counts.get(r.project_id) || { open: 0 };
        if (!['live', 'declined'].includes(r.status)) c.open++;
        counts.set(r.project_id, c);
      }
    }
    show(
      h('div', { class: 'portal-head' }, h('h1', {}, owner() ? 'All projects' : 'Your projects')),
      projects.length
        ? h('ul', { class: 'portal-list' }, projects.map(p => h('li', {},
          h('a', { class: 'row-link', href: `#/p/${p.id}` },
            h('strong', {}, p.name), p.archived && h('span', { class: 'badge s-declined' }, 'Archived'),
            p.description && h('span', { class: 'portal-muted' }, p.description),
            h('span', { class: 'mono small' }, `${counts.get(p.id)?.open || 0} open requests`)))))
        : h('p', { class: 'portal-muted' }, owner() ? 'No projects yet. Add the first one below.' : 'You have not been added to a project yet.'),
      owner() && newProjectForm(),
    );
  }

  function newProjectForm() {
    const name = h('input', { id: 'np-name', required: true, maxlength: 120 });
    const desc = h('input', { id: 'np-desc', maxlength: 2000 });
    return h('form', { class: 'portal-card', onsubmit: async e => {
      e.preventDefault();
      await act(async () => { await db('projects', '', { method: 'POST', body: { name: name.value.trim(), description: desc.value.trim() } }); route(); });
    } },
    h('h2', {}, 'New project'),
    h('label', { for: 'np-name' }, 'Name'), name,
    h('label', { for: 'np-desc' }, 'Short description (optional)'), desc,
    h('button', { class: 'btn', type: 'submit' }, 'Add project'));
  }

  async function viewProject(id) {
    const [project] = await db('projects', `id=eq.${id}&select=*`);
    if (!project) return viewMissing();
    const requests = await db('requests', `project_id=eq.${id}&select=id,title,status,hidden,author_id,created_at&order=created_at.desc`);
    const title = h('input', { id: 'nr-title', required: true, maxlength: 200 });
    const body = h('textarea', { id: 'nr-body', rows: 4, maxlength: 5000 });
    show(
      h('p', { class: 'crumbs mono small' }, h('a', { href: '#/' }, '/projects'), ' / ', project.name),
      h('div', { class: 'portal-head' }, h('h1', {}, project.name), project.description && h('p', { class: 'portal-muted' }, project.description)),
      h('form', { class: 'portal-card', onsubmit: async e => {
        e.preventDefault();
        await act(async () => {
          const [r] = await db('requests', '', { method: 'POST', prefer: 'return=representation', body: { project_id: Number(id), author_id: me.id, title: title.value.trim(), body: body.value.trim() } });
          location.hash = `#/r/${r.id}`;
        });
      } },
      h('h2', {}, 'New request'),
      h('label', { for: 'nr-title' }, 'What do you need?'), title,
      h('label', { for: 'nr-body' }, 'Details (optional)'), body,
      h('button', { class: 'btn', type: 'submit' }, 'Post request')),
      h('h2', { class: 'section-title' }, 'Requests'),
      requests.length
        ? h('ul', { class: 'portal-list' }, requests.map(r => h('li', {},
          h('a', { class: 'row-link', href: `#/r/${r.id}` },
            h('strong', {}, r.title), badge(r.status), r.hidden && h('span', { class: 'badge s-declined' }, 'Hidden'),
            h('span', { class: 'portal-muted small' }, `${nameOf(r.author_id)} · ${when(r.created_at)}`)))))
        : h('p', { class: 'portal-muted' }, 'No requests yet.'),
      owner() && await projectSettings(project),
    );
  }

  async function projectSettings(project) {
    const [repo] = await db('project_repos', `project_id=eq.${project.id}&select=*`);
    const f = {
      name: h('input', { id: 'ps-name', value: project.name, required: true, maxlength: 120 }),
      desc: h('input', { id: 'ps-desc', value: project.description, maxlength: 2000 }),
      repo: h('input', { id: 'ps-repo', value: repo?.repo || '', placeholder: 'owner/repository', pattern: '[A-Za-z0-9_.\\-]+/[A-Za-z0-9_.\\-]+' }),
      branch: h('input', { id: 'ps-branch', value: repo?.production_branch || 'main' }),
      preview: h('input', { id: 'ps-preview', value: repo?.preview_url_template || '', placeholder: '{branch}.my-site.pages.dev' }),
      archived: h('input', { id: 'ps-archived', type: 'checkbox', checked: project.archived }),
    };
    return h('details', { class: 'portal-card' }, h('summary', {}, 'Project settings'),
      h('form', { onsubmit: async e => {
        e.preventDefault();
        await act(async () => {
          await db('projects', `id=eq.${project.id}`, { method: 'PATCH', body: { name: f.name.value.trim(), description: f.desc.value.trim(), archived: f.archived.checked } });
          if (f.repo.value.trim()) {
            await db('project_repos', 'on_conflict=project_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: {
              project_id: project.id, repo: f.repo.value.trim(), production_branch: f.branch.value.trim() || 'main', preview_url_template: withHttps(f.preview.value.trim()) } });
          } else if (repo) {
            await db('project_repos', `project_id=eq.${project.id}`, { method: 'DELETE' });
          }
          route();
        });
      } },
      h('label', { for: 'ps-name' }, 'Name'), f.name,
      h('label', { for: 'ps-desc' }, 'Description'), f.desc,
      h('label', { for: 'ps-repo' }, 'GitHub repository, for the agent (only you see this)'), f.repo,
      h('label', { for: 'ps-branch' }, 'Live branch'), f.branch,
      h('label', { for: 'ps-preview' }, 'Preview address ({branch} is replaced)'), f.preview,
      h('label', { class: 'check' }, f.archived, ' Archived (members no longer see it)'),
      h('button', { class: 'btn', type: 'submit' }, 'Save settings')));
  }

  async function viewRequest(id) {
    const [r] = await db('requests', `id=eq.${id}&select=*`);
    if (!r) return viewMissing();
    const [[project], comments, runs] = await Promise.all([
      db('projects', `id=eq.${r.project_id}&select=id,name`),
      db('comments', `request_id=eq.${id}&select=*&order=created_at.asc`),
      owner() ? db('agent_runs', `request_id=eq.${id}&select=*&order=created_at.desc&limit=1`) : [],
    ]);
    const text = h('textarea', { id: 'nc-body', rows: 3, required: true, maxlength: 5000 });
    show(
      h('p', { class: 'crumbs mono small' }, h('a', { href: '#/' }, '/projects'), ' / ', h('a', { href: `#/p/${r.project_id}` }, project?.name || 'Project'), ' / request'),
      h('article', { class: 'portal-card' },
        h('div', { class: 'title-row' }, h('h1', {}, r.title), badge(r.status), r.hidden && h('span', { class: 'badge s-declined' }, 'Hidden')),
        h('p', { class: 'portal-muted small' }, `${nameOf(r.author_id)} · ${when(r.created_at)}`),
        r.body && h('p', { class: 'prewrap' }, r.body),
        owner() && ownerRequestControls(r)),
      owner() && runs[0] && agentPanel(runs[0]),
      h('h2', { class: 'section-title' }, `Comments (${comments.length})`),
      h('ul', { class: 'portal-list comments' }, comments.map(c => h('li', { class: c.hidden ? 'is-hidden' : null },
        h('p', { class: 'portal-muted small' }, `${nameOf(c.author_id)} · ${when(c.created_at)}`, c.hidden ? ' · hidden' : ''),
        h('p', { class: 'prewrap' }, c.body),
        owner() && h('button', { class: 'link-btn small', type: 'button', onclick: () => act(async () => {
          await db('comments', `id=eq.${c.id}`, { method: 'PATCH', body: { hidden: !c.hidden } }); route();
        }) }, c.hidden ? 'Show' : 'Hide')))),
      h('form', { class: 'portal-card', onsubmit: async e => {
        e.preventDefault();
        await act(async () => { await db('comments', '', { method: 'POST', body: { request_id: r.id, author_id: me.id, body: text.value.trim() } }); route(); });
      } },
      h('label', { for: 'nc-body' }, 'Add a comment'), text,
      h('button', { class: 'btn', type: 'submit' }, 'Post comment')),
    );
  }

  function ownerRequestControls(r) {
    const sel = h('select', { id: 'rq-status' }, Object.entries(STATUS).map(([v, label]) => h('option', { value: v, selected: v === r.status }, label)));
    return h('div', { class: 'owner-bar' },
      h('label', { for: 'rq-status' }, 'Status'), sel,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => act(async () => {
        await db('requests', `id=eq.${r.id}`, { method: 'PATCH', body: { status: sel.value } }); route();
      }) }, 'Save status'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => act(async () => {
        await db('requests', `id=eq.${r.id}`, { method: 'PATCH', body: { hidden: !r.hidden } }); route();
      }) }, r.hidden ? 'Show request' : 'Hide request'),
      h('p', { class: 'portal-muted small' }, 'Accepting a request lets the agent start on it, when the agent is switched on and the project has a repository.'));
  }

  function agentPanel(run) {
    const decide = status => act(async () => {
      if (status === 'approved' && !confirm('Publish this change to the live site?')) return;
      await db('agent_runs', `id=eq.${run.id}`, { method: 'PATCH', body: { status } }); route();
    });
    return h('section', { class: 'portal-card agent' },
      h('div', { class: 'title-row' }, h('h2', {}, 'Agent change'), h('span', { class: `badge r-${run.status}` }, RUN_STATUS[run.status] || run.status)),
      run.summary && h('p', { class: 'prewrap' }, run.summary),
      run.error && h('p', { class: 'portal-error' }, run.error),
      h('p', { class: 'links' },
        safeUrl(run.preview_url) && h('a', { href: safeUrl(run.preview_url), target: '_blank', rel: 'noopener noreferrer' }, 'Open preview'),
        safeUrl(run.pr_url) && h('a', { href: safeUrl(run.pr_url), target: '_blank', rel: 'noopener noreferrer' }, 'See the code change')),
      run.status === 'ready' && h('div', { class: 'owner-bar' },
        h('button', { class: 'btn', type: 'button', onclick: () => decide('approved') }, 'Approve and publish'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => decide('rejected') }, 'Reject')));
  }

  async function viewPeople() {
    if (!owner()) return viewMissing();
    const [people, projects, members] = await Promise.all([
      db('profiles', 'select=*&order=access.asc,created_at.desc'),
      db('projects', 'select=id,name&archived=is.false&order=name.asc'),
      db('project_members', 'select=project_id,user_id'),
    ]);
    const has = new Set(members.map(m => `${m.project_id}:${m.user_id}`));
    show(
      h('div', { class: 'portal-head' }, h('h1', {}, 'People'), h('p', { class: 'portal-muted' }, 'Approve people, then choose which projects each one can see.')),
      h('ul', { class: 'portal-list' }, people.map(p => {
        const sel = h('select', { id: `ac-${p.id}`, 'aria-label': `Access for ${p.full_name || p.email}` },
          ['pending', 'approved', 'blocked'].map(a => h('option', { value: a, selected: a === p.access }, a[0].toUpperCase() + a.slice(1))));
        sel.addEventListener('change', () => act(async () => { await db('profiles', `id=eq.${p.id}`, { method: 'PATCH', body: { access: sel.value } }); route(); }));
        return h('li', { class: 'person' },
          h('div', {}, h('strong', {}, p.full_name || 'No name'), p.is_owner && h('span', { class: 'badge s-live' }, 'Owner'),
            h('span', { class: 'portal-muted small' }, p.email), h('span', { class: `badge a-${p.access}` }, p.access)),
          !p.is_owner && sel,
          p.access === 'approved' && !p.is_owner && projects.length > 0 && h('fieldset', {}, h('legend', { class: 'small' }, 'Projects'),
            projects.map(pr => {
              const box = h('input', { type: 'checkbox', checked: has.has(`${pr.id}:${p.id}`) });
              box.addEventListener('change', () => act(async () => {
                if (box.checked) await db('project_members', '', { method: 'POST', body: { project_id: pr.id, user_id: p.id } });
                else await db('project_members', `project_id=eq.${pr.id}&user_id=eq.${p.id}`, { method: 'DELETE' });
              }));
              return h('label', { class: 'check' }, box, ` ${pr.name}`);
            })));
      })),
    );
  }

  async function viewUpdates() {
    if (!owner()) return viewMissing();
    const [projects, fresh, ready, digests] = await Promise.all([
      db('projects', 'select=id,name'),
      db('requests', 'status=eq.new&hidden=is.false&select=id,title,project_id,created_at&order=created_at.asc'),
      db('agent_runs', 'status=eq.ready&select=id,request_id,summary,created_at&order=created_at.asc'),
      db('digests', 'select=*&order=created_at.desc&limit=30'),
    ]);
    const pname = id => projects.find(p => p.id === id)?.name || 'Project';
    show(
      h('div', { class: 'portal-head' }, h('h1', {}, 'Updates'), h('p', { class: 'portal-muted' }, 'What is waiting for you, and the weekly summaries.')),
      h('h2', { class: 'section-title' }, `Changes to review (${ready.length})`),
      ready.length ? h('ul', { class: 'portal-list' }, ready.map(r => h('li', {}, h('a', { class: 'row-link', href: `#/r/${r.request_id}` },
        h('strong', {}, `Request #${r.request_id}`), h('span', { class: 'portal-muted' }, r.summary.slice(0, 160)))))) : h('p', { class: 'portal-muted' }, 'Nothing waiting.'),
      h('h2', { class: 'section-title' }, `New requests (${fresh.length})`),
      fresh.length ? h('ul', { class: 'portal-list' }, fresh.map(r => h('li', {}, h('a', { class: 'row-link', href: `#/r/${r.id}` },
        h('strong', {}, r.title), h('span', { class: 'portal-muted small' }, `${pname(r.project_id)} · ${when(r.created_at)}`))))) : h('p', { class: 'portal-muted' }, 'No new requests.'),
      h('h2', { class: 'section-title' }, 'Weekly summaries'),
      digests.length ? h('ul', { class: 'portal-list' }, digests.map(d => h('li', {},
        h('p', {}, h('strong', {}, pname(d.project_id)), h('span', { class: 'portal-muted small' }, ` · week to ${when(d.period_end)}`)),
        h('p', { class: 'prewrap' }, d.body)))) : h('p', { class: 'portal-muted' }, 'No summaries yet. They appear once the summary bot is switched on.'),
    );
  }

  function viewMissing() {
    show(h('section', { class: 'portal-card' }, h('h1', {}, 'Not found'), h('p', {}, 'This page does not exist or you do not have access to it.'), h('a', { href: '#/' }, 'Back to projects')));
  }

  // Runs an action, shows any error to the person instead of failing silently.
  async function act(fn) {
    try { await fn(); } catch (e) { flash(e.message); }
  }
  function flash(msg) {
    let el = document.getElementById('portal-flash');
    if (!el) { el = h('p', { id: 'portal-flash', class: 'portal-error', role: 'alert' }); app.prepend(el); }
    el.textContent = msg;
  }

  async function route() {
    const [, view, id] = location.hash.match(/^#\/([a-z]+)?\/?(\d+)?/) || [];
    try {
      if (view === 'p' && id) await viewProject(id);
      else if (view === 'r' && id) await viewRequest(id);
      else if (view === 'people') await viewPeople();
      else if (view === 'updates') await viewUpdates();
      else await viewProjects();
    } catch (e) {
      if (!session) return viewSignIn(e.message);
      show(h('p', { class: 'portal-error', role: 'alert' }, e.message));
    }
  }

  async function start() {
    if (!BASE || !KEY) return viewNotSetUp();
    const fromUrl = takeTokensFromUrl();
    if (fromUrl?.error) { renderNav(); return viewSignIn(fromUrl.error); }
    session = fromUrl || store.get();
    me = null;
    if (!session) { renderNav(); return viewSignIn(); }
    try { await loadMe(); } catch (e) { me = null; renderNav(); return viewSignIn(session ? e.message : null); }
    renderNav();
    if (me.access !== 'approved') return viewWaiting();
    await route();
  }

  window.addEventListener('hashchange', () => { if (me && me.access === 'approved') route(); });
  start();
})();
