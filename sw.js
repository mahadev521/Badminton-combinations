/* Offline support for courts with bad reception.
   App shell: network-first (never serve stale code), cache as fallback.
   Fonts: cache-first (they never change and matter for layout). */

const CACHE = "badminton-v1";

const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
];

const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // A single missing file must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Fonts: serve from cache when we have them, otherwise fetch and keep.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request)
            .then((response) => {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
              return response;
            })
            .catch(() => hit)
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        // Ignore cache-busting query strings so ?v=NN bumps still resolve offline.
        const hit = await caches.match(request, { ignoreSearch: true });
        if (hit) return hit;
        if (request.mode === "navigate") {
          const shell = await caches.match("./index.html", { ignoreSearch: true });
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
