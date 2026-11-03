/* Cache the studio shell only after an authenticated visit; never cache API responses. */
const CACHE_NAME = 'pea-studio-shell-v3';
const STATIC_FILES = [
  '/static/css/app.css',
  '/static/js/store.js',
  '/static/js/engine.js',
  '/static/js/app.js',
  '/static/js/register-sw.js',
  '/static/icons/pea-mark.svg',
  '/static/icons/pea-192.png',
  '/static/icons/pea-512.png',
  '/static/icons/pea-icon.svg',
  '/manifest.webmanifest'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'PEA_SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/login' || url.pathname === '/logout' || url.pathname === '/healthz') return;

  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/studio')) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
          const copy = response.clone();
          const body = await copy.text();
          if (body.includes('id="pea-studio"')) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put('/', new Response(body, { status: response.status, headers: response.headers }));
          }
        }
        return response;
      } catch (_) {
        const cached = await caches.match('/');
        if (cached) return cached;
        return new Response('<!doctype html><title>PEA Studio offline</title><p>Connect once and sign in to prepare this device for offline use.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/static/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
        return response;
      } catch (_) {
        return new Response('', { status: 503 });
      }
    })());
  }
});
