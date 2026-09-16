// scope: shared
// The service worker's routing decision, as a pure function so it is unit-testable without a
// browser. Given one intercepted request it answers with the strategy sw.js should apply:
//   "network"                 — go straight to the network, never touch the cache
//   "offline"                 — network-first, falling back to the cached offline page
//   "stale-while-revalidate"  — serve the cached copy and refresh it in the background
export function routeRequest({ method, pathname, origin, selfOrigin, mode }) {
  if (method !== "GET") return "network"; // never cache writes (POST/PUT/DELETE)
  if (pathname === "/api" || pathname.startsWith("/api/")) return "network"; // data stays fresh
  if (origin !== selfOrigin) return "network"; // the deployed Apps Script /exec is cross-origin
  if (mode === "navigate") return "offline"; // page loads fall back to offline.html when down
  return "stale-while-revalidate"; // same-origin static shell: css/js/images
}
