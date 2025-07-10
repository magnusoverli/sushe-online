const CACHE_NAME = 'sushe-online-v1';
const STATIC_ASSETS = [
  '/',
  '/styles/output.css',
  '/manifest.json',
  '/og-image.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Skip service worker for navigation requests to avoid redirect issues
  if (event.request.mode === 'navigate') {
    return;
  }

  event.respondWith(
    caches
      .match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request).then((response) => {
          // Don't cache redirects or non-successful responses
          if (
            !response ||
            response.status !== 200 ||
            response.type !== 'basic' ||
            response.redirected
          ) {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      })
      .catch(() => {
        // Only serve cached fallback for static assets, not navigation
        if (event.request.destination === 'document') {
          return fetch(event.request);
        }
      })
  );
});
