/* VAHDAM Lifecycle OS — minimal service worker.
 *
 * Purpose: satisfies Chrome's installability criteria (gets the install icon
 * into the address bar) and gives the installed app a working offline shell.
 *
 * Strategy:
 *  - Navigation requests: network-first with a cached fallback to /index.html.
 *  - Same-origin GETs:    stale-while-revalidate (instant load, fresh in bg).
 *  - Cross-origin / non-GET: pass through to the network.
 *  - On activate: drop old caches + claim clients so updates ship immediately.
 */
const VERSION = 'lifecycle-os-v2';
const SHELL = [
  '/', '/index.html', '/dashboard.html', '/calendar.html',
  '/auth.js', '/table-sort.js', '/chart-enhance.js',
  '/manifest.webmanifest', '/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                     // never intercept POST etc.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // pass-through CDN / Supabase

  // Navigation: network first, fall back to a cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => { caches.open(VERSION).then((c) => c.put(req, r.clone())); return r; })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // Static GETs: stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((r) => {
        if (r && r.ok) caches.open(VERSION).then((c) => c.put(req, r.clone()));
        return r;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

// Let the page request an immediate update (e.g. after deploy).
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
