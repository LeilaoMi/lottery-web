// Service Worker 离线写队列回归测试：用 vm 灌最小 SW 环境，取 enqueue/flushQueue 引用。
// 锁住的坑：① 重放必须保留原 method（DELETE 被改成 POST 会打到读/写错分支）；
// ② 同 URL 连续入队不能被 Cache API 按 URL 覆盖；③ 4xx 业务拒绝必须丢弃，否则死循环重放。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// 最小 Request 桩：enqueue/flushQueue 只用到 url/method/headers/clone/arrayBuffer
class StubRequest {
  constructor(url, init = {}) {
    this.url = typeof url === "string" ? url : url.url;
    this.method = (init.method || (url && url.method) || "GET").toUpperCase();
    this.headers = init.headers || (url && url.headers) || {};
    this._body = init.body !== undefined ? init.body : (url && url._body);
  }
  clone() { return new StubRequest(this.url, { method: this.method, headers: this.headers, body: this._body }); }
  async arrayBuffer() {
    const b = this._body;
    if (b == null) return new ArrayBuffer(0);
    if (b instanceof ArrayBuffer) return b;
    if (typeof b === "string") return new TextEncoder().encode(b).buffer;
    return b;
  }
}
class StubResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = init.headers || {}; this.ok = this.status >= 200 && this.status < 300; }
  clone() { return new StubResponse(this.body, { status: this.status, headers: this.headers }); }
  static error() { return new StubResponse("", { status: 0 }); }
}

function makeEnv({ fetchImpl }) {
  const stores = new Map(); // cacheName -> Map<url, {req, res}>
  const open = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (req, res) => { m.set(typeof req === "string" ? req : req.url, { req, res }); },
      keys: async () => [...m.values()].map(v => v.req),
      delete: async req => m.delete(typeof req === "string" ? req : req.url),
      match: async req => { const v = m.get(typeof req === "string" ? req : req.url); return v ? v.res.clone() : undefined; },
      addAll: async () => {},
    };
  };
  const listeners = {};
  const ctx = {
    self: { addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting: () => {}, clients: { claim: async () => {} } },
    caches: {
      open,
      keys: async () => [...stores.keys()],
      delete: async k => stores.delete(k),
      match: async () => undefined,
    },
    fetch: fetchImpl,
    location: { origin: "https://example.com" },
    Request: StubRequest,
    Response: StubResponse,
    URL,
    TextEncoder,
    Math,
    Date,
    console,
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(ROOT, "frontend", "sw.js"), "utf8");
  vm.runInContext(src + "\n;globalThis.__t = { enqueue, flushQueue, QUEUE, CACHE };", ctx);
  return { ...ctx.__t, stores, listeners };
}

test("离线入队：key 带 lq 时间戳（同 URL 连续两条不被 Cache 覆盖），method/body 保留", async () => {
  const env = makeEnv({ fetchImpl: async () => { throw new TypeError("network down"); } });
  await env.enqueue(new StubRequest("https://example.com/api/favs", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"kind":"ssq"}' }));
  await env.enqueue(new StubRequest("https://example.com/api/favs", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"kind":"dlt"}' }));
  const keys = [...env.stores.get(env.QUEUE).keys()];
  assert.equal(keys.length, 2, "同 URL 连续入队必须是 2 条（无 lq 会被 Cache API 按 URL 覆盖成 1 条）");
  assert.ok(keys.every(k => k.includes("lq=") && k.includes("/api/favs")), "key 保留路径并带 lq");
  assert.ok(keys[0] !== keys[1], "两条 key 不能相同");
  // 重放时 method 保留
  const req = new StubRequest("https://example.com/api/favs?id=9", { method: "DELETE" });
  await env.enqueue(req);
  const delKey = [...env.stores.get(env.QUEUE).keys()].find(k => k.includes("id=9"));
  assert.ok(delKey, "DELETE 也要能入队");
  const stored = env.stores.get(env.QUEUE).get(delKey).req;
  assert.equal(stored.method, "DELETE", "入队时 method 必须原样保留");
});

test("flush：按 lq 顺序重放，保留原 method，4xx 丢弃，网络断则 break 留队", async () => {
  const calls = [];
  let mode = "ok"; // ok | reject4 | netdown
  const env = makeEnv({
    fetchImpl: async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method });
      if (mode === "netdown") throw new TypeError("network down");
      if (mode === "reject4") return new StubResponse("unauthorized", { status: 401 });
      return new StubResponse("{}", { status: 200 });
    },
  });
  await env.enqueue(new StubRequest("https://example.com/api/favs?id=1", { method: "DELETE" }));
  await env.enqueue(new StubRequest("https://example.com/api/favs", { method: "POST", body: '{"kind":"dlt"}' }));
  const n = await env.flushQueue();
  assert.equal(n, 2, "两条都成功");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "DELETE", "第一条必须按 DELETE 重放");
  assert.equal(calls[1].method, "POST", "第二条必须按 POST 重放");
  assert.ok(!calls[0].url.includes("lq="), "重放 URL 要剥掉 lq 参数");
  assert.equal(env.stores.get(env.QUEUE).size, 0, "成功后清空队列");

  // 401：丢弃，不无限重放
  calls.length = 0;
  mode = "reject4";
  await env.enqueue(new StubRequest("https://example.com/api/favs", { method: "POST", body: '{"kind":"ssq"}' }));
  await env.flushQueue();
  assert.equal(env.stores.get(env.QUEUE).size, 0, "4xx 业务拒绝必须丢弃（否则死循环）");

  // 网络断：留队，break
  calls.length = 0;
  mode = "netdown";
  await env.enqueue(new StubRequest("https://example.com/api/favs", { method: "POST", body: '{"kind":"ssq"}' }));
  await env.enqueue(new StubRequest("https://example.com/api/favs", { method: "POST", body: '{"kind":"qlc"}' }));
  await env.flushQueue();
  assert.equal(env.stores.get(env.QUEUE).size, 2, "网络失败要留着下次重放");
  assert.equal(calls.length, 1, "断在第一条就 break，不空转后续");
});
