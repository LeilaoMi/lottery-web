// 离线缓存：外壳缓存优先，开奖数据以网络为准、断网时回退到上次结果
const CACHE = "lottery-web-v2";
const SHELL = ["/", "/manifest.json", "/icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const put = r => {
    const c = r.clone();
    caches.open(CACHE).then(ch => ch.put(req, c)).catch(() => {});
    return r;
  };

  // 开奖数据：网络优先，成功则更新缓存，失败（断网 / 源故障）回退到上次结果
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req).then(r => r || Response.error())));
    return;
  }

  // 页面外壳：缓存优先并后台更新
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(put).catch(() => hit);
      return hit || net;
    })
  );
});
