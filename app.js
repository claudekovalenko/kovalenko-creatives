(function () {
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) node.append(child);
    return node;
  }

  // Screenshots that scroll natively, so swiping follows the finger with momentum and snaps
  // to each picture. Arrows and dots scroll it too.
  function shots(p, top) {
    const track = el('div', { class: 'slides' }, p.slides.map((src, i) =>
      el('div', { class: 'slide', 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${p.slides.length}` }, [
        el('img', { src, alt: `${p.title} screen ${i + 1}`, loading: 'lazy' }),
      ])));
    top.append(track);
    if (p.slides.length < 2) return;

    let index = 0;
    const dots = el('div', { class: 'dots' }, p.slides.map((_, i) => {
      const dot = el('button', { type: 'button', 'aria-label': `Show screen ${i + 1}` });
      dot.addEventListener('click', () => go(i));
      return dot;
    }));
    const prev = el('button', { type: 'button', class: 'shot-nav prev', 'aria-label': 'Previous screen', text: '‹' });
    const next = el('button', { type: 'button', class: 'shot-nav next', 'aria-label': 'Next screen', text: '›' });
    prev.addEventListener('click', () => go(index - 1));
    next.addEventListener('click', () => go(index + 1));

    function mark(i) {
      index = i;
      [...dots.children].forEach((d, n) => d.setAttribute('aria-current', n === index));
    }
    function go(i) {
      const target = (i + p.slides.length) % p.slides.length;
      track.scrollTo({ left: target * track.clientWidth });
      mark(target);
    }

    let ticking = false;
    track.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        mark(Math.round(track.scrollLeft / track.clientWidth));
        ticking = false;
      });
    }, { passive: true });

    top.append(prev, next, dots);
    mark(0);
  }

  function card(p) {
    const hasShots = p.slides?.length > 0;
    const top = el('div', { class: hasShots ? 'proj-top has-shots' : 'proj-top' }, [el('span', { class: 'c', text: p.comment || '' })]);
    if (hasShots) shots(p, top);
    else top.append(el('span', { class: 'big', text: p.title }));

    const body = el('div', { class: 'proj-body' }, [
      el('span', { class: 'mono', text: p.status || '' }),
      el('h3', { text: p.title }),
      el('p', { text: p.description }),
    ]);
    if (p.tags?.length) body.append(el('div', { class: 'tags' }, p.tags.map(t => el('span', { text: t }))));
    if (p.url) body.append(el('a', { class: 'btn ghost', href: p.url, target: '_blank', rel: 'noopener', text: 'Open app' }));

    return el('article', { class: 'proj' }, [top, body]);
  }

  document.getElementById('work-grid').append(...PROJECTS.map(card));

  const total = BODY_OF_WORK.reduce((n, c) => n + c.count, 0);
  document.getElementById('total-projects').textContent = total;

  const copyBtn = document.getElementById('copy-email');
  copyBtn.addEventListener('click', () => {
    const email = document.getElementById('email');
    navigator.clipboard.writeText(email.textContent)
      .then(() => { copyBtn.textContent = 'Copied'; })
      .catch(() => {
        const range = document.createRange();
        range.selectNodeContents(email);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        copyBtn.textContent = 'Selected, press Ctrl+C';
      })
      .finally(() => setTimeout(() => { copyBtn.textContent = 'Copy address'; }, 2200));
  });

  document.getElementById('year').textContent = new Date().getFullYear();
})();
