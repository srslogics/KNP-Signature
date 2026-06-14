const SHELL_CACHE = "knp-shell-v20260614-1";
const STATIC_CACHE = "knp-static-v20260614-1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css?v=20260608-1",
  "./js/api.js?v=20260608-1",
  "./js/app.js?v=20260608-1",
  "./js/upload.js?v=20260608-1",
  "./js/dashboard.js?v=20260608-1",
  "./js/ledger.js?v=20260608-1",
  "./js/analytics.js?v=20260608-1",
  "./js/retail.js?v=20260608-1",
  "./js/daily-sheet.js?v=20260608-1",
  "./js/reports.js?v=20260608-1",
  "./assets/srs-logics-logo-small.png?v=20260515-1",
  "./assets/srs-logics-logo.png?v=20260515-1",
  "./manifest.webmanifest?v=20260608-1"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => ![SHELL_CACHE, STATIC_CACHE].includes(key))
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isSameOrigin(requestUrl) {
  return new URL(requestUrl).origin === self.location.origin;
}

self.addEventListener("fetch", event => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (!isSameOrigin(request.url)) return;

  if (url.pathname.endsWith("/health") || url.pathname.includes("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  const isHtmlRequest = request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
  if (isHtmlRequest) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(STATIC_CACHE).then(cache => cache.put(request, copy));
        return response;
      });
    })
  );
});
