/* 家庭账本 Service Worker —— 静态壳网络优先，接口一律走网络
 *
 * v2 修复：v1 用「缓存优先」（hit || net）导致发新版后浏览器永远拿到旧 JS/CSS，
 * 强制刷新也绕不过 SW。v2 改为网络优先，只有断网时才回退缓存；
 * 缓存名升到 fl-v2，activate 时会自动删掉 v1 旧缓存。
 */
const CACHE = 'fl-v2';
const ASSETS = [
  '/static/app.css',
  '/static/app.js',
  '/static/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin !== location.origin) return;
  // 网络优先：新版发布后立即生效；断网时才用缓存兜底
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match('/'))
      )
  );
});
