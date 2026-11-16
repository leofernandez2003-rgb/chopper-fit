// Service worker: deja la app disponible sin conexión.
// Sube el número de versión en cada publicación para refrescar la caché.
const CACHE = "chopperfit-v3";
const SHELL = ["./", "index.html", "css/style.css", "js/data.js", "js/app.js", "manifest.webmanifest",
  "assets/chopper.png", "assets/icon-192.png", "assets/fondos/bg-prado.jpg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Red primero para tener siempre la última versión; caché como respaldo sin conexión.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
