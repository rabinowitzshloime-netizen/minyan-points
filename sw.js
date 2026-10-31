// Minyan Points app: keeps the app's files on the phone so it opens fast.
// Points, logins and news always come fresh from the server (never stored here).
const CACHE = "minyan-v5";
const SHELL = ["/", "/logo.png", "/icon-192.png", "/icon-512.png", "/fonts/MinyanStam.woff2?v=3", "/tikkun/counts.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// a notification from the minyan
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: e.data ? e.data.text() : "Minyan Points" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Minyan Points", {
    body: d.body || "", icon: "/icon-192.png?v=3", badge: "/icon-192.png?v=3", tag: d.tag || "minyan", data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
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
  // everything else: show the saved copy straight away, and fetch a fresh one in the background for next time
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit => {
    const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || fresh;
  })));
});
