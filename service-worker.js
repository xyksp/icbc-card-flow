// Service Worker 已禁用 —— 不缓存任何资源，每次加载最新版本
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function () { self.clients.claim(); });
self.addEventListener('fetch', function () { /* 不拦截任何请求 */ });
