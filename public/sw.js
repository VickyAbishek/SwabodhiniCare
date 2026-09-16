// scope: shared
// Service worker: caches the app shell only, never /api or non-GET data, so staff records stay
// network-only. The per-request decision lives in js/sw-route.js (unit-tested); this file just
// applies it. `type: "module"` is required at registration so the import below resolves.
import { routeRequest } from "./js/sw-route.js";

const CACHE = "swabodhinicare-shell-v1";
const SHELL = ["/offline.html", "/manifest.webmanifest", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const strategy = routeRequest({
    method: request.method,
    pathname: url.pathname,
    origin: url.origin,
    selfOrigin: self.location.origin,
    mode: request.mode,
  });

  if (strategy === "network") return; // /api, non-GET, cross-origin: leave to the network

  if (strategy === "offline") {
    // Navigations are network-first; only when the network is down do we show the offline page.
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  // stale-while-revalidate: same-origin static GET — serve cache, refresh it in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
