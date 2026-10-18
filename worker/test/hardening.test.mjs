// v0.18.1 深挖修复的回归锁：批量落库 / 收藏入参 / 全局兜底 / 定长鉴权 / 三源全挂分级 / 前端转义 / SW 只缓存成功响应
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { saveSmall, saveSSQ } from "../src/db.js";
import worker from "../src/index.js";

function batchDB() {
  const st = { batches: 0, runs: 0, rows: [] };
  const stmt = sql => ({ bind: (...a) => ({ sql, a, run: async () => { st.runs++; st.rows.push(a); } }) });
  return { st, prepare: stmt, batch: async arr => { st.batches++; arr.forEach(x => st.rows.push(x.a)); return arr.map(() => ({})); } };
}

test("saveSmall 走 D1 batch 分块提交（120 行 = 3 块），不再逐行 await", async () => {
  const db = batchDB();
  const draws = Array.from({ length: 150 }, (_, i) => ({ code: String(2026001 + i), date: "2026-01-01", digits: ["1", "2", "3"], src: "17500" }));
  assert.equal(await saveSmall(db, "fc3d", draws), 120);
  assert.equal(db.st.batches, 3);
  assert.equal(db.st.runs, 0);
});

test("batch 整块失败时退回逐行，坏行只丢自己；mock 行永不落库", async () => {
  const st = { runs: 0 };
  const db = { prepare: () => ({ bind: (...a) => ({ run: async () => { if (a[0] === "BAD") throw new Error("x"); st.runs++; } }) }), batch: async () => { throw new Error("batch down"); } };
  const draws = [{ code: "2026001", red: ["01"], blue: "02" }, { code: "BAD", red: ["01"], blue: "02" }, { code: "2025091", red: ["01"], blue: "09", src: "mock" }, { code: "2026003" }];
  assert.equal(await saveSSQ(db, draws), 1);
  assert.equal(st.runs, 1);
});

test("收藏 POST：未知彩种 / 空号码 400", async () => {
  const env = { API_TOKEN: "t0k", DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
  const post = body => worker.fetch(new Request("https://x/api/favs", { method: "POST", headers: { Authorization: "Bearer t0k", "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, {});
  assert.equal((await post({ kind: "evil", numbers: "1" })).status, 400);
  assert.equal((await post({ kind: "ssq", numbers: "" })).status, 400);
  assert.equal((await post({ kind: "ssq", numbers: "x".repeat(501) })).status, 400);
  assert.equal((await post({ kind: "ssq", numbers: "01 02 03 04 05 06 + 07" })).status, 200);
});

test("鉴权：长度不同 / 前缀相同都拒绝", async () => {
  const env = { API_TOKEN: "secret", DB: { prepare: () => ({ all: async () => ({ results: [] }) }) } };
  for (const h of ["Bearer secre", "Bearer secretX", "Bearer secreT", ""]) {
    const r = await worker.fetch(new Request("https://x/api/favs", { headers: { Authorization: h } }), env, {});
    assert.equal(r.status, 401, h);
  }
});

test("处理器抛异常时回 JSON 500 而非 1101 页", async () => {
  const env = { DB: { prepare: () => { throw new Error("boom"); } } };
  const r = await worker.fetch(new Request("https://x/api/audit"), env, {});
  assert.ok(r.status === 200 || r.status === 500);
  assert.match(r.headers.get("Content-Type") || "", /json/);
});

test("审计：历史上一次三源全挂（mock）只判 warn 且不计入号码冲突；最新一批仍 mock 才 fail", async () => {
  const mk = rows => ({ prepare: sql => ({ bind: () => ({ all: async () => ({ results: /sync_log/.test(sql) ? rows : [] }) }), all: async () => ({ results: [] }) }) });
  const ok = { ran_at: "2026-10-18 16:54:22", sources: "500,17500", fetched: 100, inserted: 100, consistent: 1, note: "" };
  const mock = { ran_at: "2026-09-30 18:28:51", sources: "", fetched: 1, inserted: 0, consistent: 0, note: "mock" };
  const get = async rows => (await (await worker.fetch(new Request("https://x/api/audit"), { DB: mk(rows) }, {})).json()).checks.find(c => c.id === "sync_health");
  const a = await get([ok, mock]);
  assert.equal(a.status, "warn");
  assert.doesNotMatch(a.detail, /号码冲突/);
  assert.match(a.detail, /三源全挂 1 次/);
  assert.equal((await get([mock, ok])).status, "fail");
});

test("前端 esc 转义引号（属性上下文安全）；SW 不缓存非 2xx", () => {
  const html = readFileSync(new URL("../../frontend/index.html", import.meta.url), "utf8");
  const m = html.match(/function esc\(s\)\{[^\n]+\}/);
  const esc = new Function("return " + m[0])();
  assert.equal(esc(`"'<>&`), "&quot;&#39;&lt;&gt;&amp;");
  const sw = readFileSync(new URL("../../frontend/sw.js", import.meta.url), "utf8");
  assert.match(sw, /if \(!r \|\| !r\.ok\) return r;/);
});
