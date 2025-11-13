const CACHE_NAME = 'sushe-online-v2';
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
  
  if (event.request.mode === 'navigate') {
    console.log('SW: Skipping navigation request:', event.request.url);
    return;
  }

  
  if (event.request.method !== 'GET') {
    console.log(
      'SW: Skipping non-GET request:',
      event.request.method,
      event.request.url
    );
    return;
  }

  console.log('SW: Handling GET request:', event.request.url);

  
  const url = new URL(event.request.url);
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
        
        if (event.request.destination === 'document') {
          return fetch(event.request);
        }
      })
  );
});
