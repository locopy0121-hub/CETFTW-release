// 台美股資產 網頁版：離線外殼（網頁檔案先連網，失敗才用上次快取；行情與會員資料一律連網）
const CACHE = 'cetf-web-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !(u.pathname === '/web' || u.pathname.startsWith('/web/'))) return;
  const key = u.pathname === '/web' || u.pathname === '/web/' ? '/web' : u.pathname;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(key, cp)); }
    return r;
  }).catch(() => caches.match(key).then((m) => m || new Response('目前離線，且尚未有快取。', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }))));
});
