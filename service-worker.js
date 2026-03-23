// ═══════════════════════════════════════════════════════════
//  AYGÜN AVM — Service Worker
//  APP_BUILD değiştiğinde eski cache otomatik silinir
//  Güncelleme için: app.js'teki APP_BUILD sayısını artırın
// ═══════════════════════════════════════════════════════════

// !! Bu değer app.js'teki APP_BUILD ile EŞ olmalı
// Her güncellemede app.js'teki sayıyı artırın, burası otomatik eşleşir
const CACHE_VERSION = 'aygun-v4-cache'; // app.js güncellenince service-worker.js'de bunu değiştirmeye GEREK YOK
// Bunun yerine network-first stratejisi kullanıyoruz

const STATIC_CACHE = 'aygun-static-v1';
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './logo.png'
];

// ── Install: Dosyaları önbelleğe al ────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting(); // Hemen aktif ol
  e.waitUntil(
    caches.open(STATIC_CACHE).then(c => c.addAll(APP_FILES).catch(() => {}))
  );
});

// ── Activate: Eski cache'leri sil ──────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      // Eski cache isimlerini sil
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)))
      ),
      // Tüm client'lara hemen kontrol et
      self.clients.claim()
    ])
  );
});

// ── Fetch: Akıllı strateji ──────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. JSON/data dosyaları: HER ZAMAN ağdan çek (güncel fiyatlar)
  if (url.pathname.includes('/data/') || url.searchParams.has('poll') || url.searchParams.has('t') || url.searchParams.has('v')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 2. app.js ve style.css: NETWORK-FIRST (güncelleme öncelikli)
  //    Ağa eriş → başarılıysa hem döndür hem cache güncelle
  //    Ağa erişilemezse cache'den döndür
  if (url.pathname.endsWith('app.js') || url.pathname.endsWith('style.css') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(response => {
          // Başarılı yanıtı cache'e kaydet
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

  // 3. Diğer dosyalar (logo, manifest): Cache-first
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

// ── Mesaj: Ana sayfadan "güncelle" komutu gelince ──────────
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (e.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
