const CACHE_NAME = "aygun-v4-cache";
const assets = [
  "./",
  "./index.html",
  "./style.ccs",
  "./app.js",
  "./manifest.json",
  "./data/urunler.json",
  "./data/rates.json"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(assets)));
  self.skipWaiting();
});

self.addEventListener("fetch", e => {
  if (e.request.url.includes('/data/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});
