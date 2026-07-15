// ICBC H5 service worker —— 前台 + 后台离线缓存
const CACHE = 'icbc-v23';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './app-admin.js',
  './admin.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './card-airchina.jpg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  // 跨域（如 GitHub Pages 统计/第三方）一律走网络，不进缓存
  if (url.origin !== location.origin) return;

  // 所有同源 GET 一律「网络优先，失败回退缓存」：
  // 保证拿到最新 HTML/JS/CSS，离线时仍可回退缓存可用。
  e.respondWith(
    fetch(e.request).then(function (resp) {
      if (resp && resp.status === 200) {
        var cp = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, cp); });
      }
      return resp;
    }).catch(function () {
      return caches.match(e.request).then(function (cached) {
        if (cached) return cached;
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return null;
      });
    })
  );
});
