/* Офлайн-кэш приложения. Оболочка живёт в кэше, поэтому калькулятор
   считает без сети: в рейсе связь пропадает регулярно.
   Запросы к базе не кэшируются никогда - иначе менеджер увидит
   вчерашние рейсы и подумает, что они сегодняшние. */
var CACHE = 'pv24-app-v4';
var SHELL = [
  './', 'index.html', 'style.css?v=4', 'app.js?v=4',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                        // записи в базу мимо кэша
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;              // чужие домены не трогаем

  // сеть вперёд, кэш как страховка: свежая версия важнее, но без сети работаем
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('index.html');
      });
    })
  );
});
