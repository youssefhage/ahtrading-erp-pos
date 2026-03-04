/**
 * Service Worker for AH Trading POS — offline support.
 *
 * Strategy:
 *  - Static assets (JS, CSS, HTML, images): cache-first with runtime caching.
 *  - API calls: network-only, never cached by the SW (the app handles data
 *    caching in IndexedDB itself).
 *  - On install, pre-cache the app shell (index.html + icons).
 *  - On fetch failure for navigation requests, serve cached index.html so the
 *    SPA can boot offline.
 */

const CACHE_NAME = "pos-shell-v1";

// Minimal shell assets to pre-cache on install.
// Vite-built JS/CSS filenames contain hashes and are cached at runtime.
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/manifest.json",
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch((err) => {
        // Non-fatal: app will cache assets at runtime on first use.
        console.warn("[SW] precache addAll failed (non-fatal):", err);
      })
    )
  );
  // Activate immediately — don't wait for existing tabs to close.
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  // Clean up old caches from previous versions.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all open tabs immediately.
  self.clients.claim();
});

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Detect API/backend requests that must NEVER be cached by the service worker.
 * The app uses two routing modes:
 *  - Agent mode: all calls go through /api/... (apiBase prefix)
 *  - Cloud mode: calls go through /pos/... or /api/cloud-pos/...
 * Additionally /receipt/... is used for printable receipt pages served by the agent.
 */
const isApiRequest = (url) => {
  const path = url.pathname || "";
  // Match /api or /api/... (but not e.g. /apple-touch-icon.png)
  if (path === "/api" || path.startsWith("/api/")) return true;
  // Cloud POS endpoints
  if (path.startsWith("/pos/")) return true;
  // Agent receipt pages
  if (path.startsWith("/receipt")) return true;
  return false;
};

const isStaticAsset = (url) => {
  const path = url.pathname || "";
  return /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|json)$/i.test(path);
};

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls — the app handles offline data via IndexedDB.
  if (isApiRequest(url)) return;

  // Never intercept cross-origin requests.
  if (url.origin !== self.location.origin) return;

  // For navigation requests (HTML pages), use network-first with offline fallback.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the latest version of the page.
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(
            (cached) =>
              cached ||
              caches.match("/index.html").then(
                (fallback) =>
                  fallback ||
                  new Response(
                    "<html><body><h2>POS is offline</h2><p>Reload when connection is available.</p></body></html>",
                    { status: 503, headers: { "Content-Type": "text/html" } }
                  )
              )
          )
        )
    );
    return;
  }

  // For static assets, use cache-first strategy.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            // Only cache successful same-origin responses.
            if (response.ok && response.type === "basic") {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          }).catch(() => {
            // Both cache and network failed.
            return new Response("", { status: 503, statusText: "Offline" });
          })
      )
    );
    return;
  }

  // Everything else: try network, fall back to cache.
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then(
        (cached) => cached || new Response("", { status: 503, statusText: "Offline" })
      )
    )
  );
});
