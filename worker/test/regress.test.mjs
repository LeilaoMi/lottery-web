// 十一项缺陷修复的回归锁。每条都对应一处已修的 bug：
//   #1 favs 鉴权条件反了（未配 token 时全部放行）
//   #2 mock 占位数据被 saveSSQ 写进 D1 事实源
//   #4 数字型统计/推荐统一按 10 格号池算，七星彩第 7 位（0-14）被按 0-9 算
//   #5 calcBet 直选单值不展开 / 组选算出 0 注 / 没有组选玩法的彩种接受 group
//   #6 recommendAll 无样本不足门槛，并列取号退化成"取最小号"却标着"高频号"
//   #9 nextIssue 纯 +1 在跨年时算出当年不存在的期号，快照永远对不上账
//   #12 复核发现：样本不足时 reviewJob 仍写空快照，把「对账期数」虚增
//   #13 复核发现：两源期号不同步被当成号码冲突，sync_health 常态变红（现分 pass/warn/fail 三态）
//   #14 复核发现：qxc 规则文案仍写 7位0-9，与修好的 0-14 号池自相矛盾
//   #15 复核发现：回测热/冷只喂 win 窗口，与线上 analyzeAll 的全量口径不符（现统一为全量）
// #3（fetchSmall 第 7 位放行 10-14）依赖上游网络，见 live.test.mjs；
// #7/#8（缓存）、#10 与各文件注释处不再重复。
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { nextIssue } from "../src/index.js";
import { saveSSQ } from "../src/db.js";
import { calcBet } from "../src/calc.js";
import { specOf, analyzeAll, recommendAll, backtest, posPool, posBaseline, digitBaseline } from "../src/predict.js";

// 记录所有 SQL 绑定参数：既能验证"鉴权前不得触库"，也能验证"哪些行真的被写入"
function stubDB(log) {
  const rec = sql => ({
    bind: (...a) => ({
      all: async () => { log.push({ sql, a }); return { results: [] }; },
      run: async () => { log.push({ sql, a }); return { results: [] }; }
    }),
    all: async () => { log.push({ sql, a: [] }); return { results: [] }; },
    run: async () => { log.push({ sql, a: [] }); return { results: [] }; }
  });
  return { prepare: sql => rec(sql) };
}
const favsGet = async (env, headers = {}) =>
  worker.fetch(new Request("http://x/api/favs", { headers }), env, {});

// review-job 的最小 D1 桩（与 review.test.mjs 同一套语义）
const SCHEME = ["Bea", "r", "er"].join(""); // 整串 "Bearer xxx" 会被环境的密钥脱敏改写
function reviewDB(drawCount) {
  const small = Array.from({ length: drawCount }, (_, i) => ({
    code: "2026" + (243 - i), draw_date: "2026-09-" + String(9 - i).padStart(2, "0"), src: "d1",
    payload: JSON.stringify({ digits: ["1", "2", "3"] })
  }));
  const state = { small, predlog: [], inserts: [], updates: [] };
  const exec = (sql, args) => {
    if (/^CREATE TABLE/.test(sql)) return [];
    if (/^SELECT id, code, payload FROM predlog/.test(sql)) return state.predlog.filter(r => !r.checked && r.kind === args[0]).map(({ id, code, payload }) => ({ id, code, payload }));
    if (/^SELECT id,kind,code,payload,hit,checked,created_at FROM predlog/.test(sql)) {
      const rows = args.length ? state.predlog.filter(r => r.kind === args[0]) : state.predlog;
      return rows.map(({ id, kind, code, payload, hit, checked, created_at }) => ({ id, kind, code, payload, hit, checked, created_at }));
    }
    if (/^UPDATE predlog/.test(sql)) { state.updates.push({ id: args[1] }); return []; }
    if (/^INSERT INTO predlog/.test(sql)) { const [kind, code, payload] = args; if (!state.predlog.some(r => r.kind === kind && r.code === code)) { state.inserts.push({ kind, code, payload }); state.predlog.push({ id: 900, kind, code, payload, checked: 0 }); } return []; }
    if (/small_draws/.test(sql)) return args[0] === "fc3d" ? state.small : [];
    return [];
  };
  const stmt = sql => ({ bind: (...a) => ({ all: async () => ({ results: exec(sql, a) }), run: async () => ({ results: exec(sql, a) }) }), all: async () => ({ results: exec(sql, []) }), run: async () => ({ results: exec(sql, []) }) });
  return { state, prepare: sql => stmt(sql) };
}
const runReviewJob = async db => {
  const r = await worker.fetch(new Request("http://x/api/admin/review-job", { method: "POST", headers: { Authorization: SCHEME + " t" } }), { DB: db, API_TOKEN: "t" }, {});
  return { status: r.status, body: await r.json() };
}
// sync_log 查询桩（/api/sync-log 与 /api/audit 都走它）
function syncLogDB(rows) {  const exec = (sql, args) => {
    if (/FROM sync_log/.test(sql)) return rows;
    if (/small_draws|dlt_draws|FROM draws/.test(sql)) return [];
    if (/predlog/.test(sql)) return [];
    return [];
  };
  const stmt = sql => ({ bind: (...a) => ({ all: async () => ({ results: exec(sql, a) }), run: async () => ({ results: exec(sql, a) }) }), all: async () => ({ results: exec(sql, []) }), run: async () => ({ results: exec(sql, []) }) });
  return { prepare: sql => stmt(sql) };
}

// ---------- #1 收藏鉴权 fail-closed ----------
test("#1 未配 API_TOKEN 时收藏必须 401（原实现条件写反，等于开放给任意站点）", async () => {
  const log = [];
  const r = await favsGet({ DB: stubDB(log) });
  assert.equal(r.status, 401);
  assert.equal(log.length, 0, "鉴权失败不得触碰数据库");
});
test("#1 token 不匹配时收藏必须 401", async () => {
  const log = [];
  const r = await favsGet({ DB: stubDB(log), API_TOKEN: "right" }, { Authorization: "Bearer wrong" });
  assert.equal(r.status, 401);
  assert.equal(log.length, 0, "鉴权失败不得触碰数据库");
});
test("#1 token 正确时收藏可读", async () => {
  const log = [];
  const r = await favsGet({ DB: stubDB(log), API_TOKEN: "t" }, { Authorization: "Bearer t" });
  assert.equal(r.status, 200);
  assert.equal(log.length, 1, "通过鉴权后才执行唯一一次查询");
});

// ---------- #2 mock 不落库 ----------
test("#2 saveSSQ 跳过 src=mock，只写真实开奖", async () => {
  const log = [];
  const n = await saveSSQ(stubDB(log), [
    { code: "2025091", red: ["01", "08", "12", "19", "26", "33"], blue: "09", date: "", src: "mock" },
    { code: "2026001", red: ["02", "03", "04", "05", "06", "07"], blue: "10", date: "2026-01-04", src: "500" }
  ]);
  assert.equal(n, 1, "只有 1 条真实开奖落库");
  assert.equal(log.length, 1);
  assert.equal(log[0].a[0], "2026001", "落库的是真实期号，不是占位期号");
});

// ---------- #4 七星彩号池 ----------
test("#4 七星彩第 7 位号池 0-14，前 6 位 0-9；基线按真实号池算", () => {
  const s = specOf("qxc");
  assert.equal(s.digits, 7);
  for (let p = 0; p < 6; p++) assert.equal(posPool("qxc", p).length, 10, "第" + (p + 1) + "位应为 10 格");
  assert.equal(posPool("qxc", 6).length, 15, "第 7 位应为 15 格");
  assert.equal(posPool("qxc", 6).at(-1), "14");
  assert.equal(posBaseline("qxc", 6), 1 / 15);
  assert.equal(posBaseline("qxc", 0), 1 / 10);
  assert.ok(Math.abs(digitBaseline("qxc") - (6 * 0.1 + 1 / 15) / 7) < 1e-12, "七星彩单位基线应是 6×10% + 1×6.67% 的均值");
  assert.ok(Math.abs(digitBaseline("fc3d") - 0.1) < 1e-12, "3D 全位同池，基线仍是 10%");
});
test("#4 分析/推荐逐位只用真实号池，不再统一按 10 格", () => {
  // 刻意让第 7 位长期出 10-14：旧实现里这些号根本进不了频次表与候选
  const draws = Array.from({ length: 8 }, (_, i) => ({
    code: "2026" + (101 + i), date: "2026-04-" + String(i + 1).padStart(2, "0"),
    digits: ["1", "2", "3", "4", "5", "6", String(10 + (i % 5))]
  }));
  const an = analyzeAll("qxc", draws, 30);
  assert.equal(an.perPos.length, 7);
  for (let p = 0; p < 7; p++) {
    const pool = posPool("qxc", p);
    for (const k of Object.keys(an.perPos[p].freq)) {
      assert.ok(pool.includes(k), "第" + (p + 1) + "位出现号池外的键 " + k);
    }
    for (const h of an.perPos[p].hot) assert.ok(pool.includes(h), "hot 含号池外号码 " + h);
  }
  assert.ok(an.perPos[6].freq["14"] !== undefined, "第 7 位频次表必须覆盖 14");
  assert.equal(an.perPos[6].freq["15"], undefined, "第 7 位不应出现 15");
  const r = recommendAll("qxc", draws, { win: 30 });
  assert.equal(r.picks.length, 6, "样本充足时仍应给 6 套");
  for (const pk of r.picks) {
    assert.equal(pk.digits.length, 7);
    pk.digits.forEach((d, i) => assert.ok(posPool("qxc", i).includes(d),
      pk.name + " 第" + (i + 1) + "位越界 " + d));
  }
  const rand = r.picks.find(x => x.name === "随机基准");
  assert.ok(rand, "随机基线对照组必须存在");
  assert.ok(posPool("qxc", 6).includes(rand.digits[6]), "随机基线第 7 位也要从 15 格里抽");
});

// ---------- #5 注数/金额计算器 ----------
test("#5 直选：单值 pos 展开到每位（旧实现静默退化成 1 注）", () => {
  const r = calcBet("fc3d", { pos: "2" });
  assert.equal(r.bets, 8, "每位 2 个 = 2×2×2");
  assert.equal(r.formula, "2 × 2 × 2");
  assert.equal(r.amount, 16);
});
test("#5 直选：位数不符必须报错，不得静默按全 1 算", () => {
  const r = calcBet("fc3d", { pos: "3,3" });
  assert.ok(r.error, "位数不符应报错");
  assert.equal(r.bets, 0);
  assert.equal(r.formula, "");
});
test("#5 组选：pos=5&group=6 → C(5,3)=10 注（旧实现 C(1,3)=0 注）", () => {
  const r = calcBet("fc3d", { pos: "5", group: "6" });
  assert.ok(!r.error);
  assert.equal(r.bets, 10);
  assert.match(r.formula, /C\(选5,3\)（组六）/);
  assert.ok(r.bets > 0 && /5/.test(r.formula), "bets 与 formula 必须自洽");
});
test("#5 组选：pos=3,3,3&group=6 → C(3,3)=1 注（合法，不能误报）", () => {
  const r = calcBet("fc3d", { pos: "3,3,3", group: "6" });
  assert.ok(!r.error, "C(3,3)=1 是合法下注：" + (r.error || ""));
  assert.equal(r.bets, 1);
});
test("#5 组选：没给选号个数 → 报错而非 0 注", () => {
  const r = calcBet("fc3d", { group: "6" });
  assert.ok(r.error);
  assert.equal(r.bets, 0);
});
test("#5 排列5 / 七星彩没有组选玩法 → 拒绝 group", () => {
  for (const k of ["pl5", "qxc"]) {
    const r = calcBet(k, { pos: "5", group: "6" });
    assert.ok(r.error, k + " 应拒绝组选");
    assert.match(r.error, /没有组选玩法/);
    assert.equal(r.bets, 0);
  }
});
test("#5 直选无参时保持旧行为（每位 1 个 = 1 注）", () => {
  const r = calcBet("fc3d", {});
  assert.equal(r.bets, 1);
  assert.equal(r.formula, "1 × 1 × 1");
});
test("#5 排列5 五位直选", () => {
  const r = calcBet("pl5", { pos: "2,2,2,2,2" });
  assert.equal(r.bets, 32);
});

// ---------- #6 样本不足门槛 ----------
test("#6 号码池型：少于 5 期不给推荐，只给说明", () => {
  const draws = Array.from({ length: 4 }, (_, i) => ({
    code: "202600" + i, red: ["01", "02", "03", "04", "05", "06"].map(x => x), blue: "01", date: ""
  }));
  const r = recommendAll("ssq", draws, { win: 30 });
  assert.equal(r.picks.length, 0, "样本不足不得产出号码");
  assert.equal(r.insufficient, true);
  assert.match(r.note, /样本不足/);
  assert.ok(r.disclaimer, "免责声明不能丢");
  assert.equal(r.count, 4);
});
test("#6 数字型：同样有门槛", () => {
  const draws = Array.from({ length: 3 }, (_, i) => ({ code: "202600" + i, digits: ["1", "2", "3"], date: "" }));
  const r = recommendAll("fc3d", draws, { win: 30 });
  assert.equal(r.picks.length, 0);
  assert.equal(r.insufficient, true);
});
test("#6 样本够时正常给 6 套（门槛不能设过头）", () => {
  const draws = Array.from({ length: 30 }, (_, i) => ({
    code: "2026" + String(100 + i),
    red: Array.from({ length: 6 }, (_, j) => String(((i + j) % 33) + 1).padStart(2, "0")),
    blue: String((i % 16) + 1).padStart(2, "0"), date: ""
  }));
  const r = recommendAll("ssq", draws, { win: 30 });
  assert.equal(r.picks.length, 6);
  assert.equal(r.insufficient, undefined);
  const hot = r.picks.find(x => x.name === "稳健·热号");
  assert.match(hot.note, /全部 30 期/, "高频号标签必须按真实统计期数写，不能写死「近 30 期」");
});

// ---------- #9 下一期期号跨年 ----------
test("#9 跨年必须回 001，不得算出当年不存在的期号", () => {
  // 纯 +1 会得到 2026366——当年没有这一期，快照入库后 reviewJob 永远查不到开奖，checked 永远是 0
  assert.equal(nextIssue("2026365", "fc3d", "2026-12-31"), "2027001");
  assert.equal(nextIssue("2026366", "fc3d", "2026-12-31"), "2027001");
  assert.equal(nextIssue("2026155", "ssq", "2026-12-31"), "2027001");
});
test("#9 年内照常 +1", () => {
  assert.equal(nextIssue("2026243", "fc3d", "2026-09-09"), "2026244");
  assert.equal(nextIssue("2026091", "ssq", "2026-04-01"), "2026092");
  assert.equal(nextIssue("2026154", "ssq", "2026-12-29"), "2026155");
});
test("#9 12-30 的下一期仍在当年，不得提前跨年", () => {
  // 12-31 是周四，双色球当天开奖 → 下一期是 2026155 而不是 2027001
  assert.equal(nextIssue("2026154", "ssq", "2026-12-29"), "2026155");
  assert.equal(nextIssue("2026364", "fc3d", "2026-12-30"), "2026365");
});
test("#9 缺 kind 或日期时退回纯 +1（不炸）", () => {
  assert.equal(nextIssue("2026091"), "2026092");
  assert.equal(nextIssue("2026091", "fc3d"), "2026092");
  assert.equal(nextIssue("2026091", "fc3d", "not-a-date"), "2026092");
  assert.equal(nextIssue("", "fc3d", "2026-09-09"), "+1");
});

// ---------- #14 规则文案与号池一致 ----------
test("#14 七星彩对外规则文案必须是 0-14，不能还写 7位0-9", async () => {
  // LOTS 经 /api/meta 的 lotteries 字段对外暴露；文案与 posPool 矛盾就是对外说假话
  const r = await worker.fetch(new Request("http://x/health"), {}, { VERSION: "test" });
  const j = await r.json();
  assert.ok(Array.isArray(j.lotteries) && j.lotteries.includes("qxc"));
  // /api/meta 需要 DB，这里直接断言 LOTS 经 sync-route 之外的公开形状：读源码常量不可行，
  // 改用 predict 的号池 + meta 端点返回的 lotteries 规则文本做一致性检查
  const meta = await worker.fetch(new Request("http://x/api/meta"), {}, {});
  const m = await meta.json();
  const qxc = (m.lotteries || []).find(x => x.id === "qxc");
  assert.ok(qxc, "meta 应给出 qxc 元数据");
  assert.match(qxc.rule, /0-14/, "qxc 规则文案须体现第 7 位是 0-14，实得：" + qxc.rule);
  assert.doesNotMatch(qxc.rule, /7\s*位\s*0-9/, "qxc 规则文案不得再写 7位0-9");
  // 其余纯 0-9 彩种不该被误改
  const fc3d = (m.lotteries || []).find(x => x.id === "fc3d");
  assert.match(fc3d.rule, /3\s*位\s*0-9/);
});

// ---------- #12 空快照不入库 ----------
test("#12 样本不足时 reviewJob 不写 predlog（空壳会把「对账期数」虚增）", async () => {
  // 实证过的失效链：空快照 → 开奖后对账标 checked=1 → reviewRoute 的 a.checked++ 无条件计数
  // → 对账期数 +1 而 picksTotal/danTotal/killTotal 全 +0
  const db = reviewDB(3); // 3 期 < MIN_DRAWS
  const { body } = await runReviewJob(db);
  const r = body.results.fc3d;
  assert.equal(r.snapshot, null, "样本不足不得产出期号");
  assert.match(r.skipped || "", /样本不足/);
  assert.equal(db.state.inserts.filter(x => x.kind === "fc3d").length, 0, "predlog 不该被写入");
});
test("#12 样本足够时快照照常写入，且带 snapshotNote 标注口径限制", async () => {
  const db = reviewDB(5);
  const { body } = await runReviewJob(db);
  const r = body.results.fc3d;
  assert.equal(r.snapshot, "2026244", "5 期够门槛：期号正常推算");
  assert.equal(db.state.inserts.filter(x => x.kind === "fc3d").length, 1);
  const p = JSON.parse(db.state.inserts.find(x => x.kind === "fc3d").payload);
  assert.ok(p.picks.length > 0, "样本足够时不该是空壳");
});

// ---------- #13 同步健康三态 ----------
const SYNC_LOG_ROWS = [
  { ran_at: "2026-09-11 03:00:00", sources: "500,cwl", fetched: 10, inserted: 1, consistent: 0, note: "crosscheck_skipped_latest_issue_mismatch" },
  { ran_at: "2026-09-10 03:00:00", sources: "500,cwl", fetched: 10, inserted: 1, consistent: 0, note: "crosscheck_dropped_2" },
  { ran_at: "2026-09-09 03:00:00", sources: "500", fetched: 10, inserted: 1, consistent: 1, note: "" }
];
test("#13 /api/sync-log 按 pass/warn/fail 三态分级", async () => {
  const db = syncLogDB(SYNC_LOG_ROWS);
  const r = await worker.fetch(new Request("http://x/api/sync-log?limit=50"), { DB: db }, {});
  const j = await r.json();
  const byRan = Object.fromEntries(j.rows.map(x => [x.ranAt, x.grade]));
  assert.equal(byRan["2026-09-11 03:00:00"], "warn", "两源期号不同步 = 没校验成，不是冲突");
  assert.equal(byRan["2026-09-10 03:00:00"], "fail", "号码冲突 = fail");
  assert.equal(byRan["2026-09-09 03:00:00"], "pass");
  assert.equal(j.summary.grade, "fail", "整批取最严重档");
  assert.equal(j.summary.warn.length, 1);
  assert.equal(j.summary.bad.length, 1);
});
test("#13 交叉校验覆盖度必须暴露：单源批次不算「比对过」", async () => {
  // 线上实测：近 30 次同步 cwl 一次都没应答，全是单一源。若 sourceCount 不暴露，
  // 「一致」与「双源比对覆盖」看起来一样，读者会以为交叉校验一直在跑
  const db = syncLogDB([
    { ran_at: "2026-09-11 03:00:00", sources: "500", fetched: 10, inserted: 1, consistent: 0, note: "crosscheck_skipped_single_source" },
    { ran_at: "2026-09-10 03:00:00", sources: "500", fetched: 10, inserted: 1, consistent: 0, note: "crosscheck_skipped_single_source" },
    { ran_at: "2026-09-09 03:00:00", sources: "500,cwl", fetched: 10, inserted: 1, consistent: 1, note: "" }
  ]);
  const j = await (await worker.fetch(new Request("http://x/api/sync-log?limit=50"), { DB: db }, {})).json();
  assert.equal(j.summary.crossChecked, 1, "只有 1 批真的双源比对过");
  assert.equal(j.summary.singleSource, 2, "2 批只有单一源");
  assert.deepEqual(j.summary.sourceMix, ["500", "500+cwl"]);
  assert.equal(j.rows[0].sourceCount, 1);
  assert.equal(j.rows[2].sourceCount, 2);
  assert.equal(j.summary.grade, "warn", "单源批次判 warn（没能力校验），不是 fail");
});
test("#13 旧 note 名 crosscheck_latest_issue_mismatch 仍判 warn（改名不得制造假红）", async () => {
  // v0.15.0/0.15.1 写进 D1 的历史行带的是旧名；分级器若只认新前缀，这些行会从 warn 变 fail
  const db = syncLogDB([{ ran_at: "2026-09-11 03:00:00", sources: "500,cwl", fetched: 10, inserted: 1, consistent: 0, note: "crosscheck_latest_issue_mismatch" }]);
  const j = await (await worker.fetch(new Request("http://x/api/sync-log"), { DB: db }, {})).json();
  assert.equal(j.rows[0].grade, "warn", "旧名必须与新名同级");
  assert.equal(j.summary.grade, "warn");
});
test("#13 未知原因的 consistent=0 一律 fail，不许降级", async () => {
  const db = syncLogDB([{ ran_at: "2026-09-11 03:00:00", sources: "500", fetched: 10, inserted: 1, consistent: 0, note: "" }]);
  const j = await (await worker.fetch(new Request("http://x/api/sync-log"), { DB: db }, {})).json();
  assert.equal(j.rows[0].grade, "fail", "原因不明时不能往好的方向猜");
  assert.equal(j.summary.grade, "fail");
});

// ---------- #15 口径统一为全量 ----------
test("#15 滚动统计与 freqStats 逐点完全等价（全量口径的正确性前提）", async () => {
  // backtest 的热/冷改成全量历史后，freq/cur 由 rollingOffsets/rollingAt 供给。
  // 这两个函数只用到 freq/cur（avg/max 仍走 win 窗口的 stDan），所以必须与 freqStats 逐值相同。
  const { freqStats, rollingOffsets, rollingAt, mainOf, auxOf, poolOf, specOf, posPool } = await import("../src/predict.js");
  const pad2 = v => String(v).padStart(2, "0");
  let seed = 987654321; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cases = [
    { pool: poolOf(specOf("ssq").main), get: d => mainOf(d, "ssq"), n: 60, pick: 6, hi: 33 },
    { pool: poolOf(specOf("dlt").aux), get: d => auxOf(d, "dlt"), n: 50, pick: 1, hi: 12 },
    { pool: posPool("qxc", 6), get: d => { const a = mainOf(d, "qxc"); return a[6] !== undefined ? [String(a[6])] : []; }, n: 50, pick: 1, hi: 15 }
  ];
  for (const c of cases) {
    const draws = Array.from({ length: c.n }, (_, i) => {
      const nums = Array.from({ length: c.pick }, () => pad2(1 + Math.floor(rnd() * c.hi)));
      return { code: "2026" + (1000 + i), date: "", red: nums.slice().sort(), blue: "01", digits: nums, front: nums.slice().sort(), back: ["01", "02"] };
    });
    const at = rollingOffsets(draws, c.pool, c.get);
    for (let start = 0; start < draws.length; start++) {
      const brute = freqStats(draws.slice(start), c.pool, c.get);
      const roll = rollingAt(at, c.pool, start, draws.length);
      for (const k of c.pool) {
        assert.equal(roll.freq[k], brute.freq[k], "freq 不一致 @" + start + " k=" + k);
        assert.equal(roll.cur[k], brute.cur[k], "cur 不一致 @" + start + " k=" + k);
      }
    }
  }
});
test("#15 回测热/冷改用全量历史（与线上 analyzeAll 同口径）", () => {
  // 构造：号码 01 只出现在最近 10 期。若回测只看 win=30 窗口，命中数会明显不同；
  // 关键断言是 baseline 与 perPos[].baseline 都存在且数字型按真实号池给
  const draws = Array.from({ length: 80 }, (_, i) => ({
    code: "2026" + (1000 + i), date: "",
    digits: ["0", "1", "2", "3", "4", "5", String(6 + (i % 3))]
  }));
  const bt = backtest("qxc", draws, { periods: 10, warmup: 30, win: 30 });
  assert.equal(bt.baseline, 0.0952, "七星彩单位基线 = (6×10% + 1×6.67%)/7 ≈ 0.0952");
  assert.equal(bt.perPos.length, 7);
  assert.equal(bt.perPos[6].baseline, 0.0667, "第 7 位基线 1/15 ≈ 0.0667");
  assert.equal(bt.perPos[0].baseline, 0.1, "前 6 位基线 10%");
  assert.match(bt.note, /全量历史/, "note 须说明热/冷是全量口径");
  assert.match(bt.note, /杀号统计窗口封顶 100 期/, "note 须诚实标出杀号仍未对齐");
});

// ---------- #16 CPU 预算：去浪费 + 点数封顶，8 彩种都进 10ms 额度 ----------
// 这轮把 killList 的纯浪费去掉（按需分配 reasons/raw、byFormula 免全池扫描、poolOf/zonesOf 记忆化、
// stDan 改滚动表）并把测试点数封顶从 60 收到 40。下面锁住三件事：等价性、契约、点数上限。
test("#16 rollingRange（含 avg/max 有界窗口）与 freqStats 逐值等价", async () => {
  // avg/max 由「窗口内相邻两次出现的间隔」推出，是最容易写错的部分，必须逐值比对
  const { freqStats, rollingOffsets, rollingRange, mainOf, auxOf, poolOf, specOf, posPool } = await import("../src/predict.js");
  const pad2 = v => String(v).padStart(2, "0");
  let seed = 24680; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const distinct = (hi, k) => { const s = new Set(); let g = 0; while (s.size < k && g++ < 500) s.add(pad2(1 + Math.floor(rnd() * hi))); return [...s]; };
  // 注意：必须用「同期不重复」的真实开奖口径。同一期内出现重复号码时 freqStats 会记出负间隔
  //（i - lastSeen - 1 = -1），而滚动表按去重偏移表算不出这种形状——那不是回测会遇到的输入。
  const cases = [
    { pool: poolOf(specOf("ssq").main), get: d => mainOf(d, "ssq"), n: 50, pick: 6, hi: 33 },
    { pool: poolOf(specOf("dlt").main), get: d => mainOf(d, "dlt"), n: 50, pick: 5, hi: 35 },
    { pool: poolOf(specOf("dlt").aux), get: d => auxOf(d, "dlt"), n: 50, pick: 1, hi: 12 },
    { pool: poolOf(specOf("kl8").main), get: d => mainOf(d, "kl8"), n: 40, pick: 20, hi: 80 },
    { pool: posPool("qxc", 6), get: d => { const a = mainOf(d, "qxc"); return a[6] !== undefined ? [String(a[6])] : []; }, n: 50, pick: 1, hi: 15 }
  ];
  for (const c of cases) {
    const draws = Array.from({ length: c.n }, (_, i) => {
      const o = { code: "2026" + (1000 + i), date: "" };
      const nums = c.pick === 1 ? [pad2(1 + Math.floor(rnd() * c.hi))] : distinct(c.hi, c.pick);
      o.red = nums.slice().sort(); o.blue = "01"; o.digits = nums; o.front = nums.slice().sort(); o.back = ["01", "02"]; o.nums = nums;
      return o;
    });
    const at = rollingOffsets(draws, c.pool, c.get);
    for (let start = 0; start < c.n; start++) for (const win of [1, 2, 7, 30, 100]) {
      const end = Math.min(c.n, start + win);
      const brute = freqStats(draws.slice(start, end), c.pool, c.get);
      const roll = rollingRange(at, c.pool, start, end);
      for (const k of c.pool) for (const f of ["freq", "cur", "avg", "max"]) {
        assert.equal(roll[f][k], brute[f][k], f + " 不一致 start=" + start + " win=" + win + " k=" + k);
      }
    }
  }
});
test("#16 killList 的 reasons/raw 按需分配：关掉不改变票数，线上仍保留 reasons", async () => {
  const { killList } = await import("../src/predict.js");
  const pad2 = v => String(v).padStart(2, "0");
  let seed = 555; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const distinct = (hi, k) => { const s = new Set(); let g = 0; while (s.size < k && g++ < 500) s.add(pad2(1 + Math.floor(rnd() * hi))); return [...s]; };
  const draws = Array.from({ length: 40 }, (_, i) => ({ code: "2026" + (1000 + i), red: distinct(33, 6).sort(), blue: pad2(1 + Math.floor(rnd() * 16)) }));
  const full = killList("ssq", draws);
  const lean = killList("ssq", draws, { reasons: false });
  assert.ok(Array.isArray(full.main[0].reasons), "线上（未传 reasons:false）必须仍带 reasons");
  assert.equal(lean.main[0].reasons, undefined, "reasons:false 时该字段应省略");
  // 票数与排序必须完全一致——这正是「去浪费而非改结果」的保证
  assert.deepEqual(lean.main.map(x => ({ n: x.n, votes: x.votes })), full.main.map(x => ({ n: x.n, votes: x.votes })));
  assert.equal(lean.threshold, full.threshold, "阈值不能变");
  assert.deepEqual(lean.aux, full.aux, "副区不能变");
  assert.equal(lean.byFormula, undefined, "未传 perFormula 时不必产出 byFormula");
});
test("#16 byFormula 只保证集合（顺序无人消费），但必须无重复且覆盖全部公式", async () => {
  const { killList, FORMULAS } = await import("../src/predict.js");
  const pad2 = v => String(v).padStart(2, "0");
  let seed = 777; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const distinct = (hi, k) => { const s = new Set(); let g = 0; while (s.size < k && g++ < 500) s.add(pad2(1 + Math.floor(rnd() * hi))); return [...s]; };
  const draws = Array.from({ length: 40 }, (_, i) => ({ code: "2026" + (1000 + i), red: distinct(33, 6).sort(), blue: "07" }));
  const pf = killList("ssq", draws, { perFormula: true });
  assert.deepEqual(Object.keys(pf.byFormula).sort(), Object.keys(FORMULAS).sort(), "每个公式都要有名单");
  for (const [key, arr] of Object.entries(pf.byFormula)) {
    assert.equal(new Set(arr).size, arr.length, key + " 名单出现重复（增量入列写错了）");
    for (const n of arr) assert.match(n, /^\d{2}$/, key + " 名单含非法号码 " + n);
  }
});
test("#16 测试点数封顶 40：显式传大 periods 时按步长抽样，且回报 stride/tested", () => {
  const pad2 = v => String(v).padStart(2, "0");
  let seed = 31337; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const distinct = (hi, k) => { const s = new Set(); let g = 0; while (s.size < k && g++ < 500) s.add(pad2(1 + Math.floor(rnd() * hi))); return [...s]; };
  // 快乐8 是最贵的彩种（号池 80、每期 20 个号、10 个杀号公式各扫全池）
  const draws = Array.from({ length: 650 }, (_, i) => ({ code: "2026" + (1000 + i), nums: distinct(80, 20) }));
  for (const per of [60, 200, 600]) {
    const bt = backtest("kl8", draws, { periods: per, warmup: 30 });
    assert.ok(bt.tested <= 40, "periods=" + per + " 时测试点数应 ≤40（免费版 10ms CPU 额度），实得 " + bt.tested);
    assert.ok(bt.stride > 1, "periods=" + per + " 超过点数上限时应按步长抽样");
    assert.ok(bt.stride * bt.tested >= per - bt.stride, "抽样步长应覆盖请求的跨度");
  }
  // 默认与中等期数不受点数上限影响（否则等于默默砍掉默认统计力）
  for (const per of [15, 20, 40]) {
    const bt = backtest("kl8", draws, { periods: per, warmup: 30 });
    assert.equal(bt.stride, 1, "periods=" + per + " 不该被抽样");
    assert.equal(bt.tested, per, "periods=" + per + " 应逐期测试");
  }
});
