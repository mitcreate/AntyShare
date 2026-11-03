// AntyShare Progressive Web App — Offline Service Worker
const CACHE_NAME = 'antyshare-cache-v48';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/AntyShare-Offline.html',
  '/qrcode.min.js',
  '/jsQR.js',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icon-512.svg',
  '/privacy.html',
  '/terms.html',
  '/about.html',
  '/contact.html',
  '/disclaimer.html'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('⚡ AntyShare caching offline assets...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('Clearing old cache:', k);
          return caches.delete(k);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Bypass cache for dynamic API and WebSocket endpoints
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    return;
  }

  // Network-First for HTML navigation so users ALWAYS see the latest layout immediately
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // Stale-while-revalidate for static assets (CSS, JS, images)
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
        }
        return networkResponse;
      }).catch(() => {/* Offline fallback */});

      return cachedResponse || fetchPromise;
    })
  );
});
