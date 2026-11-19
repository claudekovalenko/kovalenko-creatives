// Review copy only: adds a feedback section to the claude.ai preview so invited reviewers can comment
// on what each part of the site needs. Comments use claude.ai's own comment system and sign-in;
// the page stores nothing itself. Never published to the live site (tools/build.sh leaves it out).
(() => {
  const TARGETS = [
    ['Top of the page', '.hero'],
    ['What we build', '#services'],
    ['Selected work', '#work'],
    ['How a project runs', '#process'],
    ['Company', '#company'],
    ['Contact', '#contact'],
    ['The whole site', '#feedback'],
  ];
  const el = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) k === 'text' ? (n.textContent = v) : n.setAttribute(k, v);
    n.append(...kids);
    return n;
  };
  const step = (title, body) => el('li', {}, [el('b', { text: title }), el('span', { text: body })]);

  const buttons = TARGETS.map(([label, sel]) => {
    const b = el('button', { type: 'button', class: 'btn ghost', text: `Comment on: ${label}`, disabled: '' });
    b.dataset.target = sel;
    return b;
  });
  const note = el('p', { class: 'feedback-note', text: 'Checking whether you can comment here…' });

  const section = el('section', { class: 'section', id: 'feedback', 'aria-labelledby': 'feedback-title' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'sec-head' }, [
        el('div', {}, [el('span', { class: 'path', text: '/feedback' }), el('h2', { id: 'feedback-title', text: 'Help shape this site' })]),
        el('p', { text: 'This is a preview, open to invited reviewers. Tell us what each part needs before it goes live.' }),
      ]),
      el('ol', { class: 'feedback-steps' }, [
        step('Sign in', 'Open this page with the Claude account your invitation was sent to. A free account works.'),
        step('Pick a section', 'Use a button below, or turn on comment mode and click anything on the page.'),
        step('Say what it needs', 'Wording, missing details, something confusing, a step that should come first. Everyone reviewing sees each comment.'),
      ]),
      el('div', { class: 'feedback-targets' }, buttons),
      note,
    ]),
  ]);
  document.getElementById('contact').before(section);

  const fallback = 'To comment, use the comment button in the bar above this page. You need to be signed in with an invited account.';
  const use = window.claude && typeof window.claude.use === 'function' ? window.claude.use('comments') : Promise.resolve(null);
  Promise.resolve(use).catch(() => null).then((comments) => {
    if (!comments) { buttons.forEach(b => b.hidden = true); note.textContent = fallback; return; }
    note.textContent = 'Each button opens a comment box on that part of the page.';
    for (const b of buttons) {
      b.removeAttribute('disabled');
      b.addEventListener('click', async () => {
        const target = document.querySelector(b.dataset.target);
        target.scrollIntoView({ block: 'start' });
        try {
          await comments.openComposer({ element: target });
        } catch (e) {
          if (e && (e.code === 'unavailable' || e.code === 'not_granted')) { buttons.forEach(x => x.hidden = true); note.textContent = fallback; }
          else if (e && e.code === 'rate_limited') note.textContent = 'One moment, then try again.';
        }
      });
    }
  });
})();
