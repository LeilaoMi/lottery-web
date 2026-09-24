// 离线缓存：外壳缓存优先，开奖数据以网络为准、断网时回退到上次结果
// 离线写队列：/api/favs 的 POST/DELETE 断网时入队（Cache 存完整 Request），网络恢复后重放。
// 只队列 favs——其余写接口（admin sync 等）带管理语义，静默重放会把断网期间的运维意图延迟执行，不该做。
const CACHE = "lottery-web-v3";
const SHELL = ["/", "/manifest.json", "/icon.svg"];
const QUEUE = "lw-offline-queue";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== QUEUE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => flushQueue())
  );
});

// 断网时把写请求原样入队；恢复后按入队顺序重放。
// DELETE 原样重放（method 保留）；POST 重放时也必须是 POST——用 GET 回放会让 Worker 的鉴权/读路径走错分支。
// 请求体只能读一次，入队前 clone；重放时从 Cache 取回的 Request 自带 body。
// 单调序号：同一毫秒内 Date.now 相同，随机后缀会让 FIFO 排序抖动 → 用计数器保证入队顺序
let __lqSeq = 0;
async function enqueue(req) {
  const c = await caches.open(QUEUE);
  // key 带时间戳+序号：同 URL 连续操作两条会被 Cache API 按 URL 覆盖，序号兼作排序键
  const key = new Request(req.url + (req.url.includes("?") ? "&" : "?") + "lq=" + String(Date.now()).padStart(15, "0") + "-" + String(++__lqSeq).padStart(8, "0"), {
    method: req.method,
    headers: req.headers,
    body: req.method === "DELETE" ? undefined : await req.clone().arrayBuffer()
  });
  await c.put(key, new Response("", { status: 200 }));
}
async function flushQueue() {
  let c;
  try { c = await caches.open(QUEUE); } catch { return 0; }
  const keys = await c.keys();
  let done = 0;
  for (const k of keys.sort((a, b) => {
    const ta = new URL(a.url).searchParams.get("lq") || "";
    const tb = new URL(b.url).searchParams.get("lq") || "";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  })) {
    try {
      const url = new URL(k.url);
      url.searchParams.delete("lq");
      const body = await k.arrayBuffer();
      const opts = { method: k.method, headers: k.headers };
      if (k.method !== "DELETE" && body.byteLength) opts.body = body;
      const r = await fetch(url.toString(), opts);
      // 401/400 等业务拒绝 = 这条永远重放也不会成功，丢弃避免死循环
      if (r.ok || (r.status >= 400 && r.status < 500)) { await c.delete(k); if (r.ok) done++; }
    } catch { break; } // 网络又断了：剩下的留着下次再试
  }
  return done;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 写请求：只拦 favs；网络失败入队并回一个可辨认的 202，前端据此提示「已离线排队」
  if (req.method !== "GET" && url.pathname === "/api/favs") {
    e.respondWith(
      fetch(req).catch(async () => {
        await enqueue(req);
        return new Response(JSON.stringify({ ok: true, queued: true, note: "离线已排队，网络恢复后自动重放" }), {
          status: 202, headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      })
    );
    return;
  }
  if (req.method !== "GET") return;

  const put = r => {
    const c = r.clone();
    caches.open(CACHE).then(ch => ch.put(req, c)).catch(() => {});
    return r;
  };

  // 开奖数据：网络优先，成功则更新缓存并顺带重放离线队列；失败回退到上次结果
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(req)
        .then(put)
        .then(r => { flushQueue(); return r; })
        .catch(() => caches.match(req).then(r => r || Response.error()))
    );
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
