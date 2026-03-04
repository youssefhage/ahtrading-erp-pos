/**
 * Service Worker for AH Trading POS — offline support.
 *
 * Strategy:
 *  - Hashed assets (Vite JS/CSS with content hashes): cache-first (immutable).
 *  - Non-hashed assets (icons, manifest): stale-while-revalidate so updates
 *    propagate without manual cache busting.
 *  - API calls: network-only, never cached (app uses IndexedDB for data).
 *  - Navigation: network-first, fall back to cached index.html for offline SPA boot.
 */

const CACHE_NAME = "pos-shell-v1";

// Minimal shell assets to pre-cache on install.
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
  if (path === "/api" || path.startsWith("/api/")) return true;
  if (path.startsWith("/pos/")) return true;
  if (path.startsWith("/receipt")) return true;
  return false;
};

/**
 * Vite-built JS/CSS files contain content hashes (e.g. index-Bb9miT77.js).
 * These are immutable — the filename changes when the content changes.
 * Safe for permanent cache-first.
 */
const isHashedAsset = (url) => {
  const path = url.pathname || "";
  return /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(js|css)$/i.test(path);
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
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
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

  // Hashed assets (Vite bundles): cache-first — immutable filenames.
  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok && response.type === "basic") {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
            }
            return response;
          }).catch(() => new Response("", { status: 503, statusText: "Offline" }))
      )
    );
    return;
  }

  // Non-hashed static assets (icons, manifest, fonts): stale-while-revalidate
  // so cached version is served immediately but updated in the background.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request).then((response) => {
          if (response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return response;
        }).catch(() => {
          // Network failed; if we had a cached version, it was already returned.
          // If not, return offline response.
          if (!cached) return new Response("", { status: 503, statusText: "Offline" });
          // Cached was already returned — this fetch result is discarded.
          return cached;
        });
        // Return cached immediately if available, otherwise wait for network.
        return cached || networkFetch;
      })
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
