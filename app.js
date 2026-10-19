(function () {
  const grid = document.getElementById('grid');
  const filters = document.getElementById('filters');
  const stats = document.getElementById('stats');

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

  // A strip of pictures (mock screens or image files) with arrows, dots and swipe.
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

    function go(i) {
      index = (i + slides.length) % slides.length;
      track.style.transform = `translateX(-${index * 100}%)`;
      [...dots.children].forEach((d, n) => d.setAttribute('aria-current', n === index));
    }

    let startX = null;
    art.addEventListener('pointerdown', e => { startX = e.clientX; });
    art.addEventListener('pointerup', e => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
    });

    art.append(prev, next, dots);
    go(0);
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
  stats.append(
    el('div', { class: 'stat' }, [el('strong', { text: total }), el('span', { text: 'projects built' })]),
    ...BODY_OF_WORK.map(c => el('div', { class: 'stat' }, [el('strong', { text: c.count }), el('span', { text: c.label.toLowerCase() })])),
  );

  document.getElementById('volume-total').textContent = total;
  const mosaic = document.getElementById('mosaic');
  mosaic.setAttribute('aria-label', `${total} projects: ` + BODY_OF_WORK.map(c => `${c.count} ${c.label}`).join(', '));
  mosaic.append(...BODY_OF_WORK.flatMap(c =>
    Array.from({ length: c.count }, () => el('i', { style: `--c: ${c.color}`, title: c.label }))));
  document.getElementById('volume-key').append(...BODY_OF_WORK.map(c =>
    el('li', { style: `--c: ${c.color}` }, [el('b', { text: c.count }), el('span', { text: c.label })])));

  const copyBtn = document.getElementById('copy-email');
  copyBtn.addEventListener('click', () => {
    const email = document.getElementById('email');
    navigator.clipboard.writeText(email.textContent)
      .then(() => { copyBtn.textContent = 'Copied'; })
      .catch(() => { getSelection().selectAllChildren(email); });
  });

  document.getElementById('year').textContent = new Date().getFullYear();
  render();
})();
