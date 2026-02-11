/**
 * PIN Service Worker
 * 
 * Handles:
 * - Offline caching (Cache-First for static assets)
 * - Network-First for API calls
 * - Background message notifications
 */

const CACHE_NAME = 'pin-vault-v1';
const STATIC_ASSETS = [
    '/',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
];

// Install: Cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: Clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: Cache-First for static, Network-First for dynamic + ISOLATION
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip Supabase and external requests
    if (
        url.hostname !== self.location.hostname ||
        url.pathname.startsWith('/api') ||
        event.request.method !== 'GET'
    ) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const wrapWithIsolation = (response) => {
                if (!response) return response;
                const newHeaders = new Headers(response.headers);
                // Activar Storage Isolation / Cross-Origin Isolation
                newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
                newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
                newHeaders.set('Cross-Origin-Resource-Policy', 'same-origin');

                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: newHeaders
                });
            };

            if (cachedResponse) {
                // Return cache and update in background
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                }).catch(() => { });
                return wrapWithIsolation(cachedResponse);
            }

            // Not cached: try network
            return fetch(event.request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return wrapWithIsolation(response);
                })
                .catch(() => {
                    // Offline fallback
                    if (event.request.mode === 'navigate') {
                        return caches.match('/').then(wrapWithIsolation);
                    }
                    return new Response('Offline', { status: 503 });
                });
        })
    );
});

// Push notifications
self.addEventListener('push', (event) => {
    if (!event.data) return;

    const data = event.data.json();

    event.waitUntil(
        self.registration.showNotification('PIN', {
            body: data.body || 'New encrypted message',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: data.channelId || 'pin-message',
            data: {
                channelId: data.channelId,
                url: '/',
            },
            vibrate: [100, 50, 100],
            actions: [
                { action: 'open', title: 'Open' },
                { action: 'dismiss', title: 'Dismiss' },
            ],
        })
    );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'dismiss') return;

    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((clientList) => {
            for (const client of clientList) {
                if (client.url === '/' && 'focus' in client) {
                    return client.focus();
                }
            }
            return self.clients.openWindow('/');
        })
    );
});
