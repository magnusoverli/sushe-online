const CACHE_NAME = 'sushe-cache-v1';
const ASSETS = [
  '/',
  '/manifest.json',
  '/styles/output.css',
  '/js/bundle.js',
  '/og-image.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});
