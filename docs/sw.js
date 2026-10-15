/* Kold home page worker: lets browsers offer "Install app" here, and shows the home page offline.
   The app itself has its own worker (app/sw.js); this one only ever answers for the home page. */
const CACHE = "kold-home-v1";
const HOME = new URL("./", self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(HOME)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.mode !== "navigate" || url.origin !== self.location.origin || (url.pathname !== HOME && url.pathname !== `${HOME}index.html`)) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(HOME, copy));
        return res;
      })
      .catch(() => caches.match(HOME)),
  );
});
