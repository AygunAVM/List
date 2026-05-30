// ═══════════════════════════════════════════════════════════
//  AYGÜN AVM — Service Worker  (Auto-versioning edition)
//  app.js veya data dosyaları değişince cache kendisi yenilenir
// ═══════════════════════════════════════════════════════════

const CACHE_VERSION = 'v8';
const STATIC_CACHE  = 'aygun-static-' + CACHE_VERSION;
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './logo.png'
];

// Bu URL'lere respondWith ÇAĞIRILMAZ — doğrudan tarayıcıya bırakılır
// (Firestore streaming, Firebase Auth, Google API gibi)
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

// ── Fetch: Akıllı strateji ─────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 0. BYPASS — Firebase/Google API'leri: respondWith çağırma, tarayıcı halleder
  if (BYPASS_HOSTS.some(h => url.hostname.includes(h))) return;

  // 1. Sadece GET isteklerini yönet
  if (e.request.method !== 'GET') return;

  // 2. http/https dışı (chrome-extension vb.) — geç
  if (!url.protocol.startsWith('http')) return;

  // 3. JSON/data: HER ZAMAN ağdan — fiyat/stok her an değişebilir
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 4. app.js / style.css / index.html: NETWORK-FIRST
  if (
    url.pathname.endsWith('app.js') ||
    url.pathname.endsWith('style.css') ||
    url.pathname.endsWith('index.html') ||
    url.pathname === '/'
  ) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(response => {
          if (response && response.status === 200) {
            caches.open(STATIC_CACHE).then(c => c.put(e.request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 5. Diğer statik dosyalar (logo, manifest, ikonlar): Cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          caches.open(STATIC_CACHE).then(c => c.put(e.request, response.clone()));
        }
        return response;
      });
    })
  );
});

// ── Mesaj: Ana sayfadan komut ──────────────────────────────
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
