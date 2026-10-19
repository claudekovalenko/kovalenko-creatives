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

  function card(p) {
    const art = el('div', { class: 'card-art', style: `--tint: ${p.color}` });
    if (p.preview) art.innerHTML = p.preview;
    else art.append(el('span', { class: 'monogram', text: p.monogram || p.title[0] }));

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

  stats.append(
    el('div', { class: 'stat' }, [el('strong', { text: PROJECTS.length }), el('span', { text: 'apps shipped' })]),
    el('div', { class: 'stat' }, [el('strong', { text: categories.length - 1 }), el('span', { text: 'categories' })]),
  );

  document.getElementById('year').textContent = new Date().getFullYear();
  render();
})();
