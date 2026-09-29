/* Perihelion service worker. The version string below is filled in by tools/build.js with a hash of the built page,
   so every release gets a fresh cache and old ones are deleted on activate.
   - Our own files: cache-first (the game is fully offline after the first visit).
   - Google Fonts (stylesheet + font files): stale-while-revalidate into a separate cache, so the real typefaces
     are also available offline once they have been fetched once. If they never load, the game falls back to
     system serif/monospace fonts and still works. */
var VERSION = '__VERSION__';
var APP = 'perihelion-app-' + VERSION;
var FONTS = 'perihelion-fonts-v1';
var PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(APP).then(function (c) { return c.addAll(PRECACHE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('perihelion-app-') === 0 && k !== APP; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isFont(url) { return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'; }

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (isFont(url)) {
    e.respondWith(caches.open(FONTS).then(function (cache) {
      return cache.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).catch(function () {
        return req.mode === 'navigate' ? caches.match('index.html') : Response.error();
      });
    }));
  }
});
