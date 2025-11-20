const CACHE_NAME = 'sushe-online-v4'; // Bumped to force update and clear old problematic SW
const STATIC_ASSETS = ['/styles/output.css', '/manifest.json', '/og-image.png'];

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
        // Delete all old caches including the problematic API cache
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('SW: Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Skip service worker for navigation requests to avoid redirect issues
  if (event.request.mode === 'navigate') {
    console.log('SW: Skipping navigation request:', event.request.url);
    return;
  }

  // Skip service worker for POST/PUT/DELETE requests (forms, API calls)
  if (event.request.method !== 'GET') {
    console.log(
      'SW: Skipping non-GET request:',
      event.request.method,
      event.request.url
    );
    return;
  }

  const url = new URL(event.request.url);

  // Skip ALL API routes - never cache API responses
  if (url.pathname.startsWith('/api/')) {
    console.log('SW: Skipping API route:', url.pathname);
    return;
  }

  console.log('SW: Handling GET request:', event.request.url);

  // Don't cache pages with forms or dynamic content
  if (
    url.pathname === '/login' ||
    url.pathname === '/register' ||
    url.pathname === '/' ||
    url.pathname.startsWith('/reset/')
  ) {
    console.log('SW: Skipping cache for dynamic page:', url.pathname);
    event.respondWith(fetch(event.request));
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
