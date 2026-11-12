// Service worker: keeps a copy of the app on the phone so it opens offline.
// The two placeholders below are filled in by the build (see vite.config.ts).
const CACHE = 'colouring-book-__BUILD__';
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    // ignoreVary: some hosts send "Vary" headers that would otherwise make the
    // stored copy look like a mismatch and break offline loading.
    caches
      .match(request, { ignoreSearch: true, ignoreVary: true })
      .then((hit) => hit || fetch(request)),
  );
});
