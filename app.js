(function () {
  const grid = document.getElementById('grid');
  const filters = document.getElementById('filters');

  const categories = ['All', ...new Set(PROJECTS.map(p => p.category))];
  let active = 'All';

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'style') node.style.cssText = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) node.append(child);
    return node;
  }

  // A strip of pictures (mock screens or image files) that scrolls natively, so swiping
  // follows the finger with momentum and snaps to each picture. Arrows and dots scroll it too.
  function carousel(p, className) {
    const slides = p.slides?.length ? p.slides : [null];
    const track = el('div', { class: 'slides' }, slides.map((src, i) => {
      const slide = el('div', { class: 'slide', 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${slides.length}` });
      if (!src) slide.append(el('span', { class: 'monogram', text: p.monogram || p.title[0] }));
      else if (/^data:image\/|\.(png|jpe?g|webp|gif|svg)$/i.test(src)) slide.append(el('img', { src, alt: `${p.title} screen ${i + 1}`, loading: 'lazy' }));
      else slide.innerHTML = src;
      return slide;
    }));
    const art = el('div', { class: className, style: `--tint: ${p.color}`, 'aria-roledescription': 'carousel', 'aria-label': `${p.title} screens` }, [track]);
    if (slides.length < 2) return art;

    let index = 0;
    const dots = el('div', { class: 'dots' }, slides.map((_, i) => {
      const dot = el('button', { type: 'button', 'aria-label': `Show screen ${i + 1}` });
      dot.addEventListener('click', () => go(i));
      return dot;
    }));
    const prev = el('button', { type: 'button', class: 'nav prev', 'aria-label': 'Previous screen', text: '‹' });
    const next = el('button', { type: 'button', class: 'nav next', 'aria-label': 'Next screen', text: '›' });
    prev.addEventListener('click', () => go(index - 1));
    next.addEventListener('click', () => go(index + 1));

    function mark(i) {
      index = i;
      [...dots.children].forEach((d, n) => d.setAttribute('aria-current', n === index));
    }
    function go(i) {
      const target = (i + slides.length) % slides.length;
      track.scrollTo({ left: target * track.clientWidth });
      mark(target);
    }

    // Keep the dots in step with swipes.
    let ticking = false;
    track.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        mark(Math.round(track.scrollLeft / track.clientWidth));
        ticking = false;
      });
    }, { passive: true });

    art.append(prev, next, dots);
    mark(0);
    return art;
  }

  function card(p) {
    const art = carousel(p, 'card-art');

    const meta = el('span', { class: 'card-meta', text: p.category });
    if (p.status) meta.append(el('em', { class: 'badge', text: p.status }));

    const body = el('div', { class: 'card-body' }, [
      meta,
      el('h3', { text: p.title }),
      el('p', { text: p.description }),
    ]);

    if (p.features?.length) {
      body.append(el('ul', {}, p.features.map(f => el('li', { text: f }))));
    }
    if (p.tags?.length) {
      body.append(el('div', { class: 'tags' }, p.tags.map(t => el('span', { text: t }))));
    }
    if (p.url) {
      body.append(el('a', { class: 'card-link', href: p.url, target: '_blank', rel: 'noopener', text: 'Open app →' }));
    }

    return el('article', { class: 'card' }, [art, body]);
  }

  function render() {
    grid.replaceChildren(...PROJECTS
      .filter(p => active === 'All' || p.category === active)
      .map(card));
    for (const btn of filters.children) {
      btn.setAttribute('aria-selected', btn.dataset.cat === active);
    }
  }

  filters.append(...categories.map(c => {
    const btn = el('button', { role: 'tab', 'data-cat': c, text: c });
    btn.addEventListener('click', () => { active = c; render(); });
    return btn;
  }));

  const total = BODY_OF_WORK.reduce((n, c) => n + c.count, 0);
  document.getElementById('volume-total').textContent = total;
  document.getElementById('volume-total-hero').textContent = total;
  const mosaic = document.getElementById('mosaic');
  mosaic.setAttribute('aria-label', `${total} projects: ` + BODY_OF_WORK.map(c => `${c.count} ${c.label}`).join(', '));
  mosaic.append(...BODY_OF_WORK.flatMap(c =>
    Array.from({ length: c.count }, () => el('i', { title: c.label }))));
  [...mosaic.children].forEach((sq, i) => {
    const c = BODY_OF_WORK.find(g => g.label === sq.title);
    sq.style.cssText = `--c: ${c.color}; --i: ${i}`;
  });
  document.getElementById('volume-key').append(...BODY_OF_WORK.map(c =>
    el('li', { style: `--c: ${c.color}` }, [el('b', { text: c.count }), el('span', { text: c.label })])));

  const copyBtn = document.getElementById('copy-email');
  copyBtn.addEventListener('click', () => {
    const email = document.getElementById('email');
    navigator.clipboard.writeText(email.textContent)
      .then(() => { copyBtn.textContent = 'Copied'; })
      .catch(() => { getSelection().selectAllChildren(email); });
  });

  // Split the hero headline into words so they can rise in one after another.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const h1 = document.querySelector('.hero h1');
    let i = 0;
    const wrap = node => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE) {
          const parts = child.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          for (const part of parts) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { frag.append(part); continue; }
            const w = document.createElement('span');
            w.className = 'w';
            w.style.setProperty('--i', i++);
            w.textContent = part;
            frag.append(w);
          }
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          wrap(child);
        }
      }
    };
    wrap(h1);
    h1.classList.add('split');
  }

  // Desktop-only pointer effects: tilt the hero screens and light up cards under the cursor.
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const hero = document.querySelector('.hero');
    const phones = document.querySelector('.hero-phones');
    hero.addEventListener('pointermove', e => {
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      phones.style.setProperty('--ry', `${x * 10}deg`);
      phones.style.setProperty('--rx', `${y * -8}deg`);
    });
    hero.addEventListener('pointerleave', () => {
      phones.style.setProperty('--ry', '0deg');
      phones.style.setProperty('--rx', '0deg');
    });
    document.addEventListener('pointermove', e => {
      const target = e.target.closest?.('.card, .plan');
      if (!target) return;
      const r = target.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      target.style.setProperty('--mx', `${x}px`);
      target.style.setProperty('--my', `${y}px`);
      if (target.classList.contains('card')) {
        target.style.setProperty('--ty', `${(x / r.width - 0.5) * 6}deg`);
        target.style.setProperty('--tx', `${(y / r.height - 0.5) * -6}deg`);
      }
    }, { passive: true });
  }

  const header = document.querySelector('.site-header');
  const progress = document.createElement('div');
  progress.className = 'progress';
  header.append(progress);
  const onScroll = () => {
    header.classList.toggle('scrolled', scrollY > 8);
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.setProperty('--p', max > 0 ? Math.min(scrollY / max, 1) : 0);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Sections ease up into place as they scroll into view. They are fully visible at rest;
  // only their position moves, so nothing is hidden if this never runs.
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const targets = document.querySelectorAll('.section-head, .plan, .card, .facts li, .volume, .process-intro, .process-tools, .contact-copy, .contact-card, .work-head');
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    targets.forEach((t, i) => {
      if (t.getBoundingClientRect().top < innerHeight) return;
      t.classList.add('reveal');
      t.style.setProperty('--d', `${(i % 4) * 60}ms`);
      io.observe(t);
    });
  }

  document.getElementById('year').textContent = new Date().getFullYear();
  render();
})();
