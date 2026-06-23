// ═══════════════════════════════════════════════════════════
//  AYGÜN AVM — Service Worker  (Auto-versioning edition)
// ═══════════════════════════════════════════════════════════

const CACHE_VERSION = 'v10';
const STATIC_CACHE  = 'aygun-static-' + CACHE_VERSION;
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './logo.png'
];

// Bu hostname'ler için respondWith HİÇ çağrılmaz
const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'firebaseio.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'googleapis.com',
  'gstatic.com',
];

// ── Install ────────────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(STATIC_CACHE).then(c => c.addAll(APP_FILES).catch(() => {}))
  );
});

// ── Activate: Tüm eski cache'leri sil ─────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)))
      ),
      self.clients.claim()
    ])
  );
});

// Güvenli cache yazma — response body tüketilmeden önce clone al
function safeCachePut(cacheName, request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  const cloned = response.clone(); // orijinal dönmeden ÖNCE clone
  caches.open(cacheName).then(c => c.put(request, cloned));
}

// ── Fetch ──────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 0. BYPASS — Firebase/Google streaming: respondWith çağırma
  if (BYPASS_HOSTS.some(h => url.hostname.includes(h))) return;

  // 1. GET dışı — geç
  if (e.request.method !== 'GET') return;

  // 2. http/https dışı — geç
  if (!url.protocol.startsWith('http')) return;

  // 3. /data/ JSON — her zaman ağdan (fiyat/stok değişkendir)
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(resp => { safeCachePut(STATIC_CACHE, e.request, resp); return resp; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 4. app.js / style.css / index.html — network-first
  if (
    url.pathname.endsWith('app.js') ||
    url.pathname.endsWith('style.css') ||
    url.pathname.endsWith('index.html') ||
    url.pathname === '/'
  ) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(resp => { safeCachePut(STATIC_CACHE, e.request, resp); return resp; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 5. Statik dosyalar (logo, ikonlar vb.) — cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        safeCachePut(STATIC_CACHE, e.request, resp);
        return resp;
      });
    })
  );
});

// ── Mesaj ──────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
