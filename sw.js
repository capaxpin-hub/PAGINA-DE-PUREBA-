const C = "nt-v2";
const SHELL = ["/", "/assets/styles.css", "/assets/app.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== C).map((x) => caches.delete(x)))));
  self.clients.claim();
});

const offline = () => new Response(JSON.stringify({ error: "Sin conexión." }),
  { status: 503, headers: { "Content-Type": "application/json" } });

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;

  // API y panel: siempre red, sin caché
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/admin")) {
    e.respondWith(fetch(e.request).catch(offline));
    return;
  }

  // Sitio y assets: red primero, caché como respaldo offline
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request).then((h) => h || caches.match("/")))
  );
});
