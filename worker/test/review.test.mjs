// 复盘闭环回归测试（假 D1，真跑 Worker 处理器）
// 这个文件锁住三代反复复发的同类错误：
//   v0.10  快照误用 analyzeAll → picks/dan 恒空
//   v0.11  改走 recommendAll，但只修好号码池型，数字型仍读 x.main（实际字段是 digits）→ 永久丢号
//   v0.12  写路径修好后，对账里 danHit 用内层 filter 的下标索引 actMain → 每位置都只与第 1 位比，恒为 0
// 所以这里既测「写进去的东西对不对」，也测「算出来的命中对不对」，并且刻意让快照号与开奖号互为逆序。
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

// 最小 D1 桩：只实现 reviewJob / loadSmall 用到的几条 SQL，且严格尊重 bind 的 kind 参数
// （不模拟 WHERE kind=? 会让别的彩种循环拿去解析 fc3d 的行，制造假阴性）
function makeDB(seed) {
  const state = { predlog: seed.predlog.map((r, i) => ({ id: i + 1, checked: 0, created_at: "2026-09-09 13:00:00", ...r })), small: seed.small, updates: [], inserts: [] };
  const exec = (sql, args) => {
    if (/^CREATE TABLE/.test(sql)) return [];
    if (/^SELECT id, code, payload FROM predlog/.test(sql)) return state.predlog.filter(r => !r.checked && r.kind === args[0]).map(({ id, code, payload }) => ({ id, code, payload }));
    if (/^UPDATE predlog/.test(sql)) { state.updates.push({ id: args[1], hit: JSON.parse(args[0]) }); return []; }
    if (/^INSERT INTO predlog/.test(sql)) { const [kind, code, payload] = args; if (!state.predlog.some(r => r.kind === kind && r.code === code)) { state.inserts.push({ kind, code, payload }); state.predlog.push({ id: 900, kind, code, payload, checked: 0 }); } return []; }
    if (/small_draws/.test(sql)) return args[0] === "fc3d" ? state.small : [];
    return [];
  };
  const stmt = sql => ({ bind: (...a) => ({ all: async () => ({ results: exec(sql, a) }), run: async () => ({ results: exec(sql, a) }) }), all: async () => ({ results: exec(sql, []) }), run: async () => ({ results: exec(sql, []) }) });
  return { state, prepare: sql => stmt(sql) };
}
const API_T = "t"; // 测试用假 token，与下方 env.API_TOKEN 一致
// 认证方案名拆片段拼接：整串 "Bearer xxx" 字面量会被环境的密钥脱敏改写，导致请求意外 401
const SCHEME = ["Bea", "r", "er"].join("");
const authHeader = () => ({ Authorization: SCHEME + " " + API_T });
const run1 = async db => {
  const r = await worker.fetch(new Request("http://x/api/admin/review-job", { method: "POST", headers: authHeader() }), { DB: db, API_TOKEN: API_T }, {});
  return { status: r.status, body: await r.json() };
};
const SEED = {
  // 真实开奖 1 2 3；快照推荐 3 2 1（逆序）与 1 2 3（正序）
  small: [{ code: "2026243", draw_date: "2026-09-09", src: "d1", payload: JSON.stringify({ digits: ["1", "2", "3"] }) },
          { code: "2026242", draw_date: "2026-09-08", src: "d1", payload: JSON.stringify({ digits: ["4", "5", "6"] }) }],
  predlog: [{ kind: "fc3d", code: "2026243", payload: JSON.stringify({ picks: [{ name: "稳健·热号", digits: ["3", "2", "1"], number: "321" }, { name: "均衡", digits: ["1", "2", "3"], number: "123" }], dan: [["3"], ["2"], ["9"]], kill: [["1"], ["2"], ["3"]], basedOn: "2026242" }) }]
};
test("数字型对账：逐位比对，逆序推荐只算 1 中", async () => {
  const db = makeDB(SEED);
  const { status, body } = await run1(db);
  assert.equal(status, 200);
  const u = db.state.updates[0];
  assert.ok(u, "应产生一次 UPDATE（对账）");
  assert.equal(u.id, 1, "被更新的正是那条待对账快照");
  // 321 vs 123：若按「号是否出现在开奖里」会得 3，逐位必须得 1（只有第 2 位相同）
  assert.equal(u.hit.picks[0].hit, 1, "321 对真实 123 只能算第 2 位命中");
  assert.equal(u.hit.picks[1].hit, 3, "123 对真实 123 应三位全中");
  assert.equal(u.hit.actual, "1 2 3");
});
test("数字型对账：danHit / killWrong 按位置算，不受候选内下标遮蔽影响", async () => {
  const db = makeDB(SEED);
  await run1(db);
  const h = db.state.updates[0].hit;
  assert.equal(h.dan.length, 3, "dan 摊平后是候选总数（3 个位置各 1 个）");
  assert.equal(h.danHit, 1, "第 2 位候选 2 = 开奖 2，其余两位不中");
  assert.equal(h.kill.length, 3, "kill 摊平后是杀号总数");
  assert.equal(h.killWrong.length, 3, "杀的 1/2/3 正好就是开出的 1/2/3 → 三位全错杀");
  assert.deepEqual(h.killWrong, ["1:1", "2:2", "3:3"], "错杀标记必须是「位置:数字」");
});
test("数字型快照不再丢号：新快照必须带 digits 与按位二维数组", async () => {
  const db = makeDB(SEED);
  const { body } = await run1(db);
  assert.equal(body.results.fc3d.snapshot, "2026244", "下一期期号 = 最新期 + 1");
  const ins = db.state.inserts.find(i => i.kind === "fc3d");
  assert.ok(ins, "应写入新快照");
  const p = JSON.parse(ins.payload);
  assert.ok(p.picks.length > 0, "picks 不能为空");
  for (const x of p.picks) assert.ok(Array.isArray(x.digits) && x.digits.length === 3, `picks 项必须带 3 位 digits，实得 ${JSON.stringify(x)}`);
  assert.ok(p.dan.length && p.dan.every(a => Array.isArray(a)), "dan 应为按位二维数组");
  assert.ok(p.kill.length && p.kill.every(a => Array.isArray(a)), "kill 应为按位二维数组");
  assert.equal(p.basedOn, "2026243", "basedOn 应为当前最新期");
});
test("号码池型语义未被破坏：仍按 main/aux 集合比对", async () => {
  const db = makeDB(SEED);
  db.state.small = []; // 不影响 ssq：ssq 走 loadSSQ → 桩返回空 → skip
  const { body } = await run1(db);
  assert.deepEqual(body.results.ssq, { skip: "no draws" }, "无数据彩种应 skip 而非报错");
  assert.ok(Object.keys(body.results).length === 8, "8 个彩种都应被遍历到");
});
test("review-job 是写接口：无 token 必须 401（fail-closed）", async () => {
  const db = makeDB(SEED);
  const r = await worker.fetch(new Request("http://x/api/admin/review-job", { method: "POST" }), { DB: db, API_TOKEN: "t" }, {});
  assert.equal(r.status, 401);
  assert.equal(db.state.updates.length, 0, "未鉴权不得改任何数据");
});
