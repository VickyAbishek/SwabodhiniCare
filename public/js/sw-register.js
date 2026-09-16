// scope: shared
// Registers the service worker on the deployed site only. Local dev (127.0.0.1 / localhost)
// is skipped so a stale cached shell can't confuse development; the deployed Pages hostname
// enables it automatically. A failed registration is non-fatal — the app still works online.
export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const { hostname } = window.location;
  if (hostname === "127.0.0.1" || hostname === "localhost") return;
  navigator.serviceWorker.register("/sw.js", { type: "module" }).catch(() => {});
}
