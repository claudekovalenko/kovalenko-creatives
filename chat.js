// Guided Q&A assistant. Answers common questions from the list below and steers people to email.
// Everything runs in the browser: no AI service, no server, nothing a visitor types is sent anywhere.
// To change what it says, edit TOPICS. Each topic's `next` lists the follow-up topics offered after it.
(function () {
  const EMAIL = 'kovalenkocreatives@gmail.com';

  const TOPICS = {
    start: {
      answer: 'Hi! I can answer quick questions about Kovalenko Creatives. What would you like to know?',
      next: ['build', 'background', 'after', 'cost', 'email'],
    },
    build: {
      label: 'What do you build?',
      answer: 'Custom websites and apps for businesses, a limited number each season, each with a clear scope agreed up front, handed over tested and documented. You can flip through some recent work in the Work section.',
      next: ['after', 'background', 'cost', 'email'],
    },
    after: {
      label: 'What happens after launch?',
      answer: 'The site or app is yours. If you want ongoing care, an optional monthly maintenance retainer covers hosting, updates and small fixes. New pages or features can be requested any time and are quoted one by one, with no ongoing commitment.',
      next: ['cost', 'email'],
    },
    background: {
      label: 'What’s your background?',
      answer: 'Six years inside a lead-generation and performance-marketing company, four years as a data analyst and then two as a software developer: more than 30 buyer integrations that matched leads to buyers, a calling program grown from $0 to $100K in weekly profit, and a direct mail campaign that generated over $1M in one year. Plus a business degree from USC Marshall.',
      next: ['build', 'apps', 'email'],
    },
    apps: {
      label: 'Can I use the apps on this site?',
      answer: 'Not yet. They’re custom builds in private use and aren’t available to the public. If you’d like something similar for your business, a custom build is the way to go.',
      next: ['build', 'email'],
    },
    cost: {
      label: 'How much does it cost?',
      answer: 'It depends on the scope: what you need built and how many pages or features it has. Send an email with what you have in mind and you’ll get a clear quote.',
      next: ['email', 'build'],
    },
    email: {
      label: 'I’d like to get in touch',
      answer: `The best way is email: ${EMAIL}. Tap the button below to start one, or copy the address.`,
      next: ['build'],
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
      const subject = encodeURIComponent('Project enquiry');
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
