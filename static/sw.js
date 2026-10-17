// PharmaCore RX-OS Service Worker (PWA Ready)
const CACHE_NAME = 'pharmacore-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch listener: Required by Chromium for PWA installability criteria
self.addEventListener('fetch', (event) => {
  // Pass non-GET requests through natively
  if (event.request.method !== 'GET') {
    return;
  }

  // Network-first strategy to ensure live pharmacy stock data
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

