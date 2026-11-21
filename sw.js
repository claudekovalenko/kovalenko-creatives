/* Service worker: makes the site installable and lets the portal open quickly, even offline.
   Pages are fetched fresh when online (cached copy when offline). Fonts, icons and styles are
   cached. Nothing from /api or /auth is ever cached, so private plan data never sits in the cache. */
const VERSION = 'kc-v1';
const SHELL = ['/portal/', '/portal/portal.js', '/portal/portal.css', '/styles.css', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  const fresh = () => fetch(req).then(res => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
    }
    return res;
  });

  if (req.mode === 'navigate' || /\.(js|css|webmanifest)$/.test(url.pathname)) {
    event.respondWith(fresh().catch(() => caches.match(req).then(r => r || caches.match('/portal/'))));
  } else {
    event.respondWith(caches.match(req).then(r => r || fresh()));
  }
});
