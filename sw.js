// ─── Service Worker: Cache-First + Stale-While-Revalidate ─────────────────────
const CACHE_NAME = 'payroll-system-v22';

const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/js/firebase-config.js',
    '/js/utils.js',
    '/js/auth.js',
    '/js/dashboard.js',
    '/js/employees.js',
    '/js/salaries.js',
    '/js/drivers.js',
    '/js/analytics.js',
    '/js/accounts.js',
    '/js/audit.js',
    '/js/export.js',
    '/js/usage-monitor.js',
    'https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js'
];

// Pre-cache on install
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
            .catch((err) => console.warn('[SW] Pre-cache partial failure:', err))
    );
    self.skipWaiting();
});

// Remove old caches on activate
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        )
    );
    self.clients.claim();
});

// ── Helper: safely put a response clone into cache ────────────────────────────
// Avoids "body already used" by cloning BEFORE any other use,
// and skipping opaque/error responses that cannot be cloned safely.
function safeCachePut(cache, request, response) {
    // Only cache valid, non-opaque responses
    if (!response || !response.ok || response.type === 'opaque') return;
    try {
        cache.put(request, response.clone());
    } catch (e) {
        // Silently ignore clone errors (e.g. response body already consumed)
    }
}

// ── Fetch handler ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip Firestore API — Firebase SDK handles these with its own offline cache
    if (url.includes('firestore.googleapis.com')) return;
    if (url.includes('firebase.googleapis.com')) return;
    if (url.includes('identitytoolkit.googleapis.com')) return;

    // External CDN libraries → Cache-first (URLs are versioned, never change)
    const isExternalLib = url.includes('gstatic.com') ||
                          url.includes('jsdelivr.net') ||
                          url.includes('sheetjs.com') ||
                          url.includes('fonts.googleapis.com') ||
                          url.includes('fonts.gstatic.com');

    if (isExternalLib) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(event.request);
                if (cached) return cached; // serve from cache immediately

                try {
                    const response = await fetch(event.request);
                    safeCachePut(cache, event.request, response);
                    return response;
                } catch {
                    // Offline and not cached → nothing we can do
                    return new Response('', { status: 503, statusText: 'Offline' });
                }
            })
        );
        return;
    }

    // App files (HTML, CSS, JS) → Stale-While-Revalidate
    // Serve cached version immediately; update cache from network in the background.
    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(event.request);

            // Start fetching from network (don't await yet)
            const networkPromise = fetch(event.request)
                .then((response) => {
                    safeCachePut(cache, event.request, response);
                    return response;
                })
                .catch(() => null);

            // If we have a cached copy, return it immediately (fast path).
            // The networkPromise updates the cache silently in the background.
            if (cached) return cached;

            // No cache → wait for network
            const networkResponse = await networkPromise;
            if (networkResponse) return networkResponse;

            // Last resort: return index.html for navigation (SPA fallback)
            if (event.request.mode === 'navigate') {
                return caches.match('/index.html');
            }

            return new Response('', { status: 503, statusText: 'Offline' });
        })
    );
});
