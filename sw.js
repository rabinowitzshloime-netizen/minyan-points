// Minyan Points app: keeps the app's files on the phone so it opens fast.
// Points, logins and news always come fresh from the server (never stored here).
const CACHE = "minyan-v3";
const SHELL = ["/", "/logo.png", "/icon-192.png", "/icon-512.png", "/fonts/MinyanStam.woff2?v=3", "/tikkun/counts.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;                       // always live
  // the page itself: try the internet first so updates show straight away, use the saved copy when offline
  if (e.request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put("/", c)); return r; }).catch(() => caches.match("/")));
    return;
  }
  // everything else (fonts, pictures, tikkun files): saved copy first, then fetch and save
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  })));
});
