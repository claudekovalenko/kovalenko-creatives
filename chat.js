// Guided Q&A assistant. Answers common questions from the list below and steers people to email.
// Everything runs in the browser: no AI service, no server, nothing a visitor types is sent anywhere.
// To change what it says, edit TOPICS. Each topic's `next` lists the follow-up topics offered after it.
(function () {
  const EMAIL = 'kovalenkocreatives@gmail.com';

  const TOPICS = {
    start: {
      answer: 'Hi! I can answer quick questions about the Kovalenko Creatives apps. What would you like to know?',
      next: ['apps', 'custom', 'church', 'privacy', 'email'],
    },
    apps: {
      label: 'What apps do you have?',
      answer: 'There’s a sermon reading plan for churches, a seminary homework planner, a Biblical Greek flashcard app, and Time Cup for planning your week. A platform for content creators, Next Steps, is in development. You can flip through screenshots of each in the Apps section.',
      next: ['church', 'privacy', 'install', 'email'],
    },
    custom: {
      label: 'Can you build a custom app?',
      answer: 'Yes, a limited number each season. Each one has a clear scope agreed up front and is built to run on its own once it’s handed over, with an optional light care plan. Email with what you need, who will use it and your timeline.',
      next: ['cost', 'privacy', 'email'],
    },
    church: {
      label: 'Can my church use the reading plan?',
      answer: 'The reading plan is built so it can be set up for a new sermon series. If you’d like it for your church, send an email with your church’s name and the series you’re planning.',
      next: ['privacy', 'cost', 'email'],
    },
    privacy: {
      label: 'Is my information private?',
      answer: 'Yes. Most of the apps keep everything on your own device: no account, no tracking, and nothing stored on a server unless you choose to sync.',
      next: ['install', 'custom', 'email'],
    },
    install: {
      label: 'How do I install one?',
      answer: 'Open the app in your phone’s browser, then use “Add to Home Screen” (Safari’s Share menu on iPhone, or the ⋮ menu in Chrome on Android). It then works like a normal app, even offline.',
      next: ['apps', 'email'],
    },
    cost: {
      label: 'How much does it cost?',
      answer: 'It depends on the app, or for a custom build, on the scope. Send an email with what you have in mind and you’ll get a straight answer.',
      next: ['email', 'apps'],
    },
    email: {
      label: 'I’d like to get in touch',
      answer: `The best way is email: ${EMAIL}. Tap the button below to start one, or copy the address.`,
      next: ['apps'],
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
      const subject = encodeURIComponent('Question about your apps');
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
