// Guided Q&A assistant. Answers common questions from the list below and steers people to email.
// Everything runs in the browser: no AI service, no server, nothing a visitor types is sent anywhere.
// To change what it says, edit TOPICS. Each topic's `next` lists the follow-up topics offered after it.
(function () {
  const EMAIL = 'kovalenkocreatives@gmail.com';

  const TOPICS = {
    start: {
      answer: 'Hi! Ask a quick question about Kovalenko Creatives. What would you like to know?',
      next: ['build', 'how', 'after', 'background', 'email'],
    },
    build: {
      label: 'What do you build?',
      answer: 'Websites and apps for businesses: fast, mobile-first sites that are easy to update, and apps your customers or team use every day. We take on a limited number of projects at a time, each with a clear scope agreed up front.',
      next: ['how', 'cost', 'email'],
    },
    how: {
      label: 'How does a project work?',
      answer: 'You send an email with what you need, who it’s for and your timeline. You get a reply with how we’d approach it and what’s included. Then it’s built and checked with you before launch, and you get a simple guide to running and updating it.',
      next: ['after', 'cost', 'email'],
    },
    after: {
      label: 'What happens after launch?',
      answer: 'It’s yours. An optional monthly maintenance retainer covers hosting, security updates and small fixes. New pages or features can be requested any time and are quoted one by one, with no ongoing commitment.',
      next: ['cost', 'email'],
    },
    background: {
      label: 'What’s your background?',
      answer: 'Six years of data analysis and software development: four as a data analyst, then two as a software developer, plus a business degree from USC Marshall. Builds also use the most capable AI models, including Claude, with every change reviewed by hand.',
      next: ['build', 'apps', 'email'],
    },
    apps: {
      label: 'Can I use the apps shown here?',
      answer: 'Not yet. They’re custom builds in private use. If you’d like something similar for your business, a custom build is the way to go.',
      next: ['build', 'email'],
    },
    cost: {
      label: 'How much does it cost?',
      answer: 'It depends on the scope: what you need built and how many pages or features it has. Send an email with what you have in mind and you’ll get a clear quote.',
      next: ['email', 'how'],
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

  // Focusable and labelled, so keyboard users can scroll back through the conversation.
  const log = el('div', { class: 'chat-log', 'aria-live': 'polite', tabindex: '0', role: 'log', 'aria-label': 'Conversation' });
  const choices = el('div', { class: 'chat-choices' });
  const close = el('button', { type: 'button', class: 'chat-close', 'aria-label': 'Close questions', text: '×' });
  const panel = el('div', { class: 'chat-panel', id: 'chat-panel', role: 'dialog', 'aria-label': 'Questions' }, [
    el('div', { class: 'chat-head' }, [el('b', { text: 'questions.chat' }), close]),
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
      choices.append(el('a', { class: 'btn chat-cta', href: `mailto:${EMAIL}?subject=${subject}`, text: 'Write an email' }));
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
