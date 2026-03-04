const CACHE_NAME = "aygun-v4-cache";
const assets = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(assets)));
});

self.addEventListener("fetch", e => {
  if (e.request.url.includes('/data/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});
