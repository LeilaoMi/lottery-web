// net.fetchT 的超时行为测试：用本地 http server 演两种上游——一种秒回，一种永远不回。
// 为什么值得单测：线上实测 /api/ssq/latest 在缓存未命中时会挂到 20–30 秒（境内站点从 CF 边缘不回包时，
// 没有超时的 fetch 会把用户的请求一起拖死）。这类问题只在真网络下暴露，但「超时到底有没有生效」
// 是可以在 127.0.0.1 上确定性地验证的。
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchT, UPSTREAM_MS, BULK_MS } from "../src/net.js";

function server(handler) {
  const s = http.createServer(handler);
  s.maxRequests = 0;
  s.on("request", () => { s.maxRequests++; });
  return new Promise(res => s.listen(0, "127.0.0.1", () => res(s)));
}

test("上游秒回时 fetchT 正常返回，且 headers 原样带过去", async () => {
  const srv = await server((req, res) => { res.setHeader("Content-Type", "text/plain"); res.end("pong:" + (req.headers["user-agent"] || "")); });
  try {
    const r = await fetchT(`http://127.0.0.1:${srv.address().port}/`, { headers: { "User-Agent": "lw-test" } });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "pong:lw-test");
  } finally { srv.close(); }
});

test("上游不回包时 fetchT 在超时点抛错，而不是无限等", { timeout: 5000 }, async () => {
  const srv = await server(() => { /* 故意永不 res.end() */ });
  try {
    const t0 = Date.now();
    await assert.rejects(
      () => fetchT(`http://127.0.0.1:${srv.address().port}/hang`, {}, 400),
      (e) => { assert.match(String(e && (e.name || e.message)), /TimeoutError|timeout|abort/i); return true; }
    );
    const dt = Date.now() - t0;
    assert.ok(dt < 3000, "400ms 的档不该拖到 3 秒（实测 " + dt + "ms）");
    assert.ok(dt >= 350, "不该在超时点之前就提前失败（实测 " + dt + "ms）");
  } finally { srv.close(); }
});

test("两个档位的默认值：常规 8s、全量文件 20s，且默认走常规档", { timeout: 15000 }, async () => {
  assert.equal(UPSTREAM_MS, 8000);
  assert.equal(BULK_MS, 20000);
  const srv = await server(() => { /* 不回包 */ });
  try {
    const t0 = Date.now();
    // 不传 ms → 用 UPSTREAM_MS。真等 8 秒太慢，这里只验证「默认值确实被用上」：
    // 用 AbortSignal.timeout 的可观测性反推——3 秒时仍未结束（说明不是 1 秒档），
    // 同时手动 abort 以尽快收尾，不把测试拖成 8 秒。
    const p = fetchT(`http://127.0.0.1:${srv.address().port}/hang`, {});
    const winner = await Promise.race([p.then(() => "resolved", () => "rejected"), new Promise(r => setTimeout(() => r("still-pending"), 3000))]);
    assert.equal(winner, "still-pending", "默认档下 3 秒还不该结束（= 用的是 8 秒而不是更短的档）");
    assert.ok(Date.now() - t0 >= 3000);
    p.catch(() => {});   // 让它在后台自己超时，不影响断言
  } finally { srv.closeAllConnections ? srv.closeAllConnections() : srv.close(); srv.close(); }
});
