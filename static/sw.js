'use strict';
const CACHE_NAME = 'trt-shell-v1';
const SHELL = ['/','/shop','/manifest.json','/static/css/main.css','/static/js/app.js','/static/img/trt-icon.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL).catch(()=>{}))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', event => {
  const req = event.request; const url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== self.location.origin) return;
  if(url.pathname.startsWith('/promise212324') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/') || url.pathname.startsWith('/checkout') || url.pathname.startsWith('/order/')) return;
  if(url.pathname.startsWith('/static/')){
    event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res=>{if(res.ok){const clone=res.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,clone));}return res;}).catch(()=>cachedFallback(req))));
    return;
  }
  event.respondWith(fetch(req).then(res=>{if(res.ok && (url.pathname==='/' || url.pathname==='/shop')){const clone=res.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,clone));}return res;}).catch(()=>caches.match(req).then(cached=>cached || caches.match('/'))));
});
async function cachedFallback(req){return (await caches.match(req)) || Response.error();}
