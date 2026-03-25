// ═══════════════════════════════════════════════════════════
//  AYGÜN AVM — Service Worker  (Auto-versioning edition)
//  app.js veya data dosyaları değişince cache kendisi yenilenir
// ═══════════════════════════════════════════════════════════

// Bu değeri her deploy'da 1 artırın → eski cache otomatik silinir
// Çerez/cache temizliğine GEREK KALMAZ
const CACHE_VERSION = 'v6';
const STATIC_CACHE  = 'aygun-static-' + CACHE_VERSION;
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './logo.png'
];

// ── Install ────────────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting(); // Hemen aktif ol, eski SW'yi bekletme
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
      self.clients.claim() // Yeni SW hemen tüm sekmeleri kontrol etsin
    ])
  );
});

// ── Fetch: Akıllı strateji ─────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. JSON/data: HER ZAMAN ağdan — fiyat/stok her an değişebilir
  if (
    url.pathname.includes('/data/') ||
    url.searchParams.has('poll') ||
    url.searchParams.has('t') ||
    url.searchParams.has('v')
  ) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 2. app.js / style.css / index.html: NETWORK-FIRST
  //    → Ağdan gelirse hem döndür hem cache'e yaz
  //    → Ağ yoksa cache'den sun
  if (
    url.pathname.endsWith('app.js') ||
    url.pathname.endsWith('style.css') ||
    url.pathname.endsWith('index.html')
  ) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(c => c.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 3. Diğer (logo, manifest, ikonlar): Cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(c => c.put(e.request, clone));
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
