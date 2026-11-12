// Service worker: keeps a copy of the app on the phone so it opens offline.
// The two placeholders below are filled in by the build (see vite.config.ts).
const PREFIX = 'colouring-book-';
const CACHE = PREFIX + '__BUILD__';
const ASSETS = __ASSETS__;
const MATCH = { ignoreSearch: true, ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: 'reload' fetches straight from the server. Without it the
      // browser may hand back a page it saved minutes ago, and the stored app
      // ends up pointing at an older version's files that no longer exist.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const older = (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE);
      // Keep the previous version's files for any screen still open on it.
      await Promise.all(older.slice(0, -1).map((k) => caches.delete(k)));
      await self.clients.claim();
      if (older.length) await reviveBrokenPages();
    })(),
  );
});

/**
 * After an update, asks every open app window whether it is alive. A window
 * whose script failed to load (a blank page) cannot answer, so it is reloaded.
 */
async function reviveBrokenPages() {
  const windows = await self.clients.matchAll({ type: 'window' });
  await Promise.all(
    windows.map(async (client) => {
      const alive = await new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve(true);
        setTimeout(() => resolve(false), 2000);
        client.postMessage({ type: 'ping' }, [channel.port2]);
      });
      if (!alive) await client.navigate(client.url).catch(() => {});
    }),
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(request.mode === 'navigate' ? openApp(request) : fetchFile(request));
});

/**
 * Opening the app: use the newest page from the server whenever it can be
 * reached quickly, so the page and its files always belong together. Offline
 * or on a bad connection, use the stored copy.
 */
async function openApp(request) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 3000);
  try {
    const fresh = await fetch(request.url, { cache: 'no-cache', signal: abort.signal });
    if (fresh.ok) return fresh;
  } catch {
    // Offline or too slow: fall through to the stored copy.
  } finally {
    clearTimeout(timer);
  }
  const stored = await (await caches.open(CACHE)).match('./', MATCH);
  return stored || fetch(request);
}

/** Everything else: this version's stored copy, then any older copy, then the network. */
async function fetchFile(request) {
  const current = await caches.open(CACHE);
  return (
    (await current.match(request, MATCH)) || (await caches.match(request, MATCH)) || fetch(request)
  );
}
