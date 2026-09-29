/* Offline support.
 * Every file is saved on first visit. After that the app always opens instantly from the
 * saved copy (works with no signal / no VPN), and quietly checks for a newer version in the
 * background. If anything changed, the page is told so it can offer a "Refresh" button.
 */
const CACHE = 'china-trip-v1';
const FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'data/trip.json', 'data/itinerary.json', 'data/places.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function notifyUpdated() {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((c) => c.postMessage({ type: 'updated' }));
}

// `savedCopy` is a clone taken before the saved response is handed to the page,
// because a response body can only be read once.
async function refresh(cache, key, savedCopy) {
  try {
    const res = await fetch(key, { cache: 'no-cache' });
    if (!res.ok) return res;
    await cache.put(key, res.clone());
    if (savedCopy) {
      const [a, b] = await Promise.all([savedCopy.text(), res.clone().text()]);
      if (a !== b) notifyUpdated();
    }
    return res;
  } catch (err) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Page loads (any #route) all use the saved index.html.
  const key = req.mode === 'navigate' ? new URL('index.html', self.registration.scope).href : url.origin + url.pathname;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    const network = refresh(cache, key, cached ? cached.clone() : null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return network;
  })());
});
