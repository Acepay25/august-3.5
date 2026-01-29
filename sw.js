const CACHE_NAME = 'futures-ai-cache-v5';

// This list includes the app's shell and critical third-party libraries
// hosted on CDNs. Caching these ensures the app can load and function
// even when offline.
const URLS_TO_CACHE = [
  // App Shell
  '/',
  '/index.html',
  '/manifest.json',

  // Main script (referenced by index.html)
  '/index.tsx',

  // Assets
  '/vite.svg',

  // Critical CDN Assets (from importmap)
  'https://cdn.tailwindcss.com',
  'https://aistudiocdn.com/react@19.2.0',
  'https://aistudiocdn.com/react-dom@19.2.0',
  'https://aistudiocdn.com/react-dom@19.2.0/client',
  'https://esm.sh/react-virtuoso@4.12.3?external=react,react-dom',
  'https://aistudiocdn.com/@google/genai@1.27.0',
  'https://esm.sh/openai@4.52.7',
  'https://aistudiocdn.com/idb@8.0.0',
  'https://aistudiocdn.com/process@0.11.10',

  // Fonts
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap'
];

self.addEventListener('install', event => {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching app shell and critical assets');
        // Use no-cache requests to ensure we get the latest files from the network upon installation.
        const requests = URLS_TO_CACHE.map(url => new Request(url, { cache: 'no-cache' }));
        return cache.addAll(requests);
      })
      .catch(error => {
        console.error('Service Worker: Failed to cache assets during install:', error);
      })
  );
});

self.addEventListener('fetch', event => {
  // We only want to handle GET requests for our caching strategy.
  if (event.request.method !== 'GET') {
    return;
  }

  // Use a "Cache, falling back to network" strategy.
  // This is ideal for performance and offline-first functionality.
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response from cache.
        if (response) {
          return response;
        }

        // Not in cache - fetch from network.
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then(
          networkResponse => {
            // Check if we received a valid response to cache.
            // We only cache basic, successful (200) responses from most sources.
            // We also cache opaque responses (status 0) from CDNs (like Google Fonts) to ensure they work.
            if (!networkResponse || (networkResponse.status !== 200 && networkResponse.type !== 'opaque')) {
              return networkResponse;
            }

            // Clone the response because it's a stream and can be consumed only once.
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                // Cache the new resource for future offline access.
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        );
      })
  );
});

self.addEventListener('activate', event => {
  // This event is fired when the service worker is activated.
  // It's the perfect place to clean up old, unused caches.
  const cacheWhitelist = [CACHE_NAME];

  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            // If a cache name is not in our whitelist, delete it.
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Listen for skip waiting message from the app
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});