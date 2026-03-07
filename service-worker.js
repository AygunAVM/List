// public/service-worker.js
// Genişletilmiş service worker: cache versiyonlama, offline fallback, asset listesi
const CACHE_NAME = 'teklif-app-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.ccs',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install: statik varlıkları cache'le
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: eski cache'leri temizle
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(k => {
        if (k !== CACHE_NAME) return caches.delete(k);
      }));
    })
  );
  self.clients.claim();
});

// Fetch: öncelikle cache, sonra ağ; navigation için index.html fallback
self.addEventListener('fetch', event => {
  const req = event.request;
  // Yalnızca GET isteklerini cache'le
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(networkRes => {
        // Aynı-origin GET yanıtlarını cache'e ekle
        if (req.url.startsWith(self.location.origin)) {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return networkRes;
      }).catch(() => {
        // Offline fallback: navigation ise index.html, değilse basit 503
        if (req.mode === 'navigate') return caches.match('/index.html');
        return new Response('Çevrimdışı - içerik bulunamadı', { status: 503, statusText: 'Service Worker Offline' });
      });
    })
  );
});
