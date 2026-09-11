/* Trips — service worker
   Bump CACHE whenever you upload a new index.html, or browsers will keep
   serving the old one from the cache. */
const CACHE = "trips-v8";
const TIMEOUT = 4000;

/* Split deliberately. cache.addAll is all-or-nothing: one missing file and
   the whole install fails, leaving no offline copy at all — silently.
   CORE must exist. EXTRA is added one by one and allowed to fail. */
const CORE  = ["./", "./index.html"];
const EXTRA = [
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await c.addAll(CORE);
      await Promise.all(EXTRA.map(u => c.add(u).catch(() => {})));
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network, but give up after TIMEOUT ms. Airline and hotel wifi tends to
   stall rather than fail, which would otherwise hang on a blank screen. */
function fromNetwork(req){
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT);
    fetch(req).then(
      res => { clearTimeout(timer); resolve(res); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

/* Only overwrite the cached page with something that is plausibly the app:
   a captive portal returns a perfectly valid 200 that would otherwise
   replace index.html and follow you offline. */
function looksLikeApp(res){
  return res.ok
      && res.type === "basic"
      && (res.headers.get("content-type") || "").includes("text/html");
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  /* Never touch the sync API — it must always hit the network. */
  if (url.origin !== self.location.origin) return;

  /* The page itself: network first, so a new upload is picked up as soon as
     there's a signal, but the cached copy still works on a plane. */
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    e.respondWith(
      fromNetwork(req)
        .then(res => {
          if (looksLikeApp(res)) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  /* Everything else (icons, manifest): cache first. */
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
