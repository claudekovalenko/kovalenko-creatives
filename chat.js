// Guided Q&A assistant. Answers common questions from the list below and steers people to email.
// Everything runs in the browser: no AI service, no server, nothing a visitor types is sent anywhere.
// To change what it says, edit TOPICS. Each topic's `next` lists the follow-up topics offered after it.
(function () {
  const EMAIL = 'kovalenkocreatives@gmail.com';

  const TOPICS = {
    start: {
      answer: 'Hi! I can answer quick questions about lead-generation funnels and how Kovalenko Creatives builds them. What would you like to know?',
      next: ['what', 'fit', 'background', 'cost', 'email'],
    },
    what: {
      label: 'What is a lead-gen funnel?',
      answer: 'It’s a short path that turns a stranger into a lead: a page made for one audience, a short form that qualifies them, and instant routing so the lead reaches you (or your CRM or a partner) within seconds. Automatic follow-up and a simple dashboard round it out.',
      next: ['fit', 'included', 'email'],
    },
    fit: {
      label: 'Is it right for my business?',
      answer: 'It usually is if a single customer is worth a meaningful amount, people search or scroll before they buy, and you can follow up quickly. Service businesses, local trades, coaches, consultants, schools and nonprofits are good fits. Email what you sell and where customers come from today, and you’ll get an honest answer.',
      next: ['included', 'cost', 'email'],
    },
    included: {
      label: 'What’s included in a build?',
      answer: 'A landing page written to convert, a mobile-first qualifying form, instant lead routing to email, text, CRM or partners, automatic follow-up, tracking with a simple results dashboard, and consent wording with secure lead storage. It’s a fixed scope, handed over tested and documented.',
      next: ['after', 'cost', 'email'],
    },
    after: {
      label: 'What happens after launch?',
      answer: 'The funnel is yours. If you want ongoing care, an optional monthly maintenance retainer covers hosting, form and integration checks, security updates and small fixes. New pages, tests or integrations can be requested any time and are quoted one by one, with no ongoing commitment.',
      next: ['cost', 'email'],
    },
    background: {
      label: 'What’s your background?',
      answer: 'Over five years inside a lead-generation and performance-marketing company, as a senior analyst and then a software developer: more than 30 buyer integrations that matched leads to buyers, a calling program grown from $0 to $100K in weekly profit, and a direct mail campaign that generated over $1M in one year. Plus a business degree from USC Marshall.',
      next: ['what', 'other', 'email'],
    },
    other: {
      label: 'Do you build apps or websites too?',
      answer: 'Yes, custom apps and websites as well, a limited number each season. The apps on this page are custom builds in private use, so they aren’t available to the public yet.',
      next: ['cost', 'email'],
    },
    cost: {
      label: 'How much does it cost?',
      answer: 'It depends on the scope: how many pages, where leads should go and what follow-up you need. Send an email with what you have in mind and you’ll get a clear quote.',
      next: ['email', 'included'],
    },
    email: {
      label: 'I’d like to get in touch',
      answer: `The best way is email: ${EMAIL}. Tap the button below to start one, or copy the address.`,
      next: ['what'],
      cta: true,
    },
  };

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) node.append(child);
    return node;
  }

  const log = el('div', { class: 'chat-log', 'aria-live': 'polite' });
  const choices = el('div', { class: 'chat-choices' });
  const close = el('button', { type: 'button', class: 'chat-close', 'aria-label': 'Close questions', text: '×' });
  const panel = el('div', { class: 'chat-panel', id: 'chat-panel', role: 'dialog', 'aria-label': 'Questions' }, [
    el('div', { class: 'chat-head' }, [el('b', { text: 'Questions?' }), close]),
    log,
    choices,
  ]);
  panel.hidden = true;
  const toggle = el('button', { type: 'button', class: 'chat-toggle', 'aria-controls': 'chat-panel', 'aria-expanded': 'false', text: 'Questions?' });

  function say(text, who) {
    log.append(el('p', { class: `chat-msg ${who}`, text }));
    log.scrollTop = log.scrollHeight;
  }

  function show(id) {
    const topic = TOPICS[id];
    say(topic.answer, 'bot');
    choices.replaceChildren();
    if (topic.cta) {
      const subject = encodeURIComponent('Funnel enquiry');
      choices.append(el('a', { class: 'button chat-cta', href: `mailto:${EMAIL}?subject=${subject}`, text: 'Write an email' }));
      const copy = el('button', { type: 'button', class: 'copy', text: 'Copy address' });
      copy.addEventListener('click', () => {
        navigator.clipboard.writeText(EMAIL)
          .then(() => { copy.textContent = 'Copied'; })
          .catch(() => say(EMAIL, 'bot'));
      });
      choices.append(copy);
    }
    for (const next of topic.next) {
      const btn = el('button', { type: 'button', class: 'chat-chip', text: TOPICS[next].label });
      btn.addEventListener('click', () => { say(TOPICS[next].label, 'me'); show(next); });
      choices.append(btn);
    }
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open);
    if (open && !log.children.length) show('start');
    if (open) panel.querySelector('button').focus();
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => { setOpen(false); toggle.focus(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); toggle.focus(); } });

  document.body.append(panel, toggle);
})();
