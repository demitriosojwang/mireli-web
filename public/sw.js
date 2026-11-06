/*
 * Mi-Reli service worker — deliberately minimal offline shell.
 *
 * Rules chosen for safety on a dynamic, session-cookie booking app:
 * - Never touches /api/ (bookings, payments, auth are network-only).
 * - Never touches non-GET requests.
 * - Only same-origin URLs are cached.
 * - The offline fallback is the cached home page, so a passenger without
 *   connectivity sees the real landing page, never stale booking data.
 */
const CACHE = "mireli-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request("/", { cache: "reload" })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Immutable build output and app icons: cache-first, then network.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // Navigations: network-first. Offline users get the cached home shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(
          () =>
            caches.match("/") ??
            new Response("<h1>Mi-Reli</h1><p>You are offline.</p>", {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            })
        )
    );
  }
});
