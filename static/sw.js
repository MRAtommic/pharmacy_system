// PharmaCore RX-OS Service Worker (Clean Bypass Mode)
// Self-unregister and clear previous broken caches immediately

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

// Do not intercept any fetch requests, let browser handle everything natively
