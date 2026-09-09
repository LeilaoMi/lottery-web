// verify-batch 单元测试：奖级/金额/位置敏感/上限/多期汇总
// 期望值一律按官方奖级规则手算或取自既有函数所在分支，不从被测实现里抄。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTicket, scoreTicket, verifyBatch } from "../src/verify-batch.js";

const SSQ = { code: "2026104", date: "2026-09-08", red: ["03", "11", "17", "22", "28", "31"], blue: "09" };
const DLT = { code: "26103", date: "2026-09-09", front: ["05", "12", "19", "28", "34"], back: ["03", "11"] };
const KL8 = { code: "2026242", date: "2026-09-09", nums: ["04", "11", "17", "23", "38", "41", "47", "52", "58", "63", "66", "71", "74", "77", "78", "79", "80", "01", "02", "30"] };
const FC3D = { code: "2026242", date: "2026-09-09", digits: ["1", "2", "3"] };
const PL5 = { code: "2026242", date: "2026-09-09", digits: ["7", "0", "4", "4", "9"] };

test("parseTicket：主/辅区分隔与常见写法都收", () => {
  assert.deepEqual(parseTicket("ssq", "01 05 12 22 28 30 + 04"), { main: ["01", "05", "12", "22", "28", "30"], aux: ["04"] });
  assert.deepEqual(parseTicket("ssq", "1,5,12,22,28,30+4"), { main: ["01", "05", "12", "22", "28", "30"], aux: ["04"] });
  assert.deepEqual(parseTicket("dlt", "5 12 19 28 34 + 3 11"), { main: ["05", "12", "19", "28", "34"], aux: ["03", "11"] });
  assert.deepEqual(parseTicket("fc3d", "922"), { main: ["9", "2", "2"], aux: [] });        // 连写只在每格 1 位时拆
  assert.deepEqual(parseTicket("fc3d", "9 2 2"), { main: ["9", "2", "2"], aux: [] });
});

test("parseTicket：结构性错误一律拒绝，不静默按缺号算未中", () => {
  assert.match(parseTicket("ssq", "01 05 12 22 28 + 04").error, /主区需 6/);
  assert.match(parseTicket("ssq", "01 05 12 22 28 30").error, /辅区需 1/);
  assert.match(parseTicket("ssq", "01 05 12 22 28 30 + 04 07").error, /辅区需 1/);
  assert.match(parseTicket("ssq", "01 01 12 22 28 30 + 04").error, /重复/);
  assert.match(parseTicket("ssq", "01 05 12 22 28 34 + 04").error, /1-33/);
  assert.match(parseTicket("ssq", "01 05 12 22 28 30 + 17").error, /1-16/);
  assert.match(parseTicket("fc3d", "1 2 3 + 4").error, /无辅区/);
  assert.match(parseTicket("kl8", "01 02 03 04 05 06 07 08 09 10 11").error, /1\.\.10/);
  assert.match(parseTicket("klx", "01").error, /未知彩种/);
  // 数字型每位 0-9（曾经静默接受 "12" 并按未中处理）；七星彩只有第 7 位是 0-14 的另一个池
  assert.match(parseTicket("fc3d", "1 2 12").error, /第 3 位需在 0-9/);
  assert.match(parseTicket("pl5", "1 2 3 4 105").error, /第 5 位需在 0-9/);
  assert.match(parseTicket("qxc", "1 2 3 4 5 6 15").error, /第 7 位需在 0-14/);
  assert.deepEqual(parseTicket("qxc", "1 2 3 4 5 6 14").main, ["1", "2", "3", "4", "5", "6", "14"]);
});

test("双色球：奖级与金额（一二等奖为浮动奖，必须给 null 而不是猜一个数）", () => {
  assert.equal(scoreTicket("ssq", { main: ["03", "11", "17", "22", "28", "31"], aux: ["09"] }, SSQ).grade, "一等");
  assert.equal(scoreTicket("ssq", { main: ["03", "11", "17", "22", "28", "31"], aux: ["09"] }, SSQ).amount, null);
  const s3 = scoreTicket("ssq", { main: ["03", "11", "17", "22", "28", "05"], aux: ["09"] }, SSQ);
  assert.deepEqual([s3.grade, s3.amount, s3.hitMain, s3.hitAux], ["三等", 3000, 5, 1]);   // 5 红 + 蓝
  const s6 = scoreTicket("ssq", { main: ["01", "02", "04", "06", "20", "33"], aux: ["09"] }, SSQ);
  assert.deepEqual([s6.grade, s6.amount], ["六等", 5]);                                     // 只中蓝
  assert.equal(scoreTicket("ssq", { main: ["01", "02", "04", "06", "20", "33"], aux: ["01"] }, SSQ).grade, "未中");
});

test("大乐透：只给奖级，金额显式为 null 并说明原因（规则换过版本，不猜）", () => {
  const r = scoreTicket("dlt", { main: ["05", "12", "19", "28", "34"], aux: ["01", "02"] }, DLT);
  assert.deepEqual([r.grade, r.hitMain, r.hitAux], ["三等", 5, 0]);
  assert.equal(r.amount, null); assert.match(r.note, /2026-02-02/);
  assert.equal(scoreTicket("dlt", { main: ["05", "12", "19", "28", "33"], aux: ["03", "11"] }, DLT).grade, "四等");
  assert.equal(scoreTicket("dlt", { main: ["05", "12", "19", "06", "07"], aux: ["03", "11"] }, DLT).grade, "六等");
});

test("快乐8 按「选几 × 命中个数」查表，给金额", () => {
  const r = scoreTicket("kl8", { main: ["04", "11", "17", "23", "38"], aux: [] }, KL8);
  assert.equal(r.pick, 5); assert.equal(r.hitNums, 5); assert.ok(r.amount > 0, "选5中5 必有固定金额");
  assert.equal(scoreTicket("kl8", { main: ["05", "06", "07", "08", "09"], aux: [] }, KL8).hitNums, 0);
});

test("数字彩：位置敏感——组选算组选，逐位算逐位，绝不退化成集合判定", () => {
  const exact = scoreTicket("fc3d", { main: ["1", "2", "3"], aux: [] }, FC3D);
  assert.deepEqual([exact.grade, exact.amount, exact.posHit], ["直选", 1040, 3]);
  const perm = scoreTicket("fc3d", { main: ["3", "2", "1"], aux: [] }, FC3D);
  assert.deepEqual([perm.grade, perm.amount, perm.posHit], ["组六", 173, 1]);               // 顺序错 2 位，集合相同
  const none = scoreTicket("fc3d", { main: ["1", "2", "4"], aux: [] }, FC3D);
  assert.equal(none.grade, "未中"); assert.equal(none.amount, 0);
  const p5 = scoreTicket("pl5", { main: ["7", "0", "4", "4", "9"], aux: [] }, PL5);
  assert.deepEqual([p5.grade, p5.posHit], ["全中", 5]);
  assert.equal(scoreTicket("pl5", { main: ["9", "4", "4", "0", "7"], aux: [] }, PL5).posHit, 1); // 逆序只中 1 位（中间 4）
});

test("verifyBatch：多期 × 倍数汇总，注数与成本口径清楚", () => {
  const r = verifyBatch("ssq", [SSQ, { ...SSQ, code: "2026103", red: ["01", "02", "03", "04", "05", "06"], blue: "07" }],
    ["03 11 17 22 28 31 + 09", "03 11 17 22 28 05 + 09"], ["2026104", "2026103"], 2);
  assert.equal(r.tickets, 2); assert.equal(r.parsed, 2); assert.equal(r.errors.length, 0);
  assert.equal(r.rounds.length, 2);
  const a = r.rounds[0].summary;
  assert.deepEqual([a.tickets, a.multi, a.cost], [2, 2, 8]);                                 // 2 注 × 2 倍 × 2 元
  assert.equal(a.winning, 4);                                                                // 两注都中（一等 + 三等）
  assert.deepEqual(a.byGrade, { 一等: 2, 三等: 2 });
  assert.equal(a.amountKnown, 6000);                                                          // 只有三等的 3000×2 能给钱
  assert.equal(a.amountUnknownTier, 2);                                                       // 一等奖金额不给，如实计数
  assert.equal(r.rounds[1].summary.winning, 0);
});

test("verifyBatch：坏行不吞、不开奖期号不炸、上限守住", () => {
  const r = verifyBatch("ssq", [SSQ], ["03 11 17 22 28 31 + 09", "01 02", ""], ["2026104", "2099999"]);
  assert.equal(r.errors.length, 1); assert.equal(r.errors[0].line, 2);          // 行号按用户粘贴的原始行算，空行被丢弃但不移动行号
  assert.equal(r.rounds[0].results.length, 2);          // 3 行里 1 行为空 → 只对 2 注计分
  assert.equal(r.rounds[0].results.filter(x => x.error).length, 1);
  const lead = verifyBatch("ssq", [SSQ], ["", "01 02"], ["2026104"]);
  assert.equal(lead.errors[0].line, 2, "前导空行不能把错误行号挤到第 1 行");
  assert.equal(r.rounds[1].drawn, false); assert.match(r.rounds[1].note, /期号不存在/);
  assert.match(verifyBatch("ssq", [SSQ], [], ["2026104"]).error, /tickets 为空/);
  assert.match(verifyBatch("ssq", [SSQ], ["01 02 03 04 05 06 + 07"], []).error, /code 或 codes/);
  const many = Array.from({ length: 201 }, () => "03 11 17 22 28 31 + 09");
  assert.match(verifyBatch("ssq", [SSQ], many, ["2026104"]).error, /最多 200 注/);
});

// ---------- 路由层（HTTP 契约）----------
// 纯函数测得再全，路由没接上、或校验顺序写错，线上照样 404/500。
// 下面每条都命中「取数之前早退」的分支 → 离线可跑，不会去打外部数据源。
import worker from "../src/index.js";
const postBatch = (body, raw) => worker.fetch(new Request("http://x/api/verify-batch", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: raw !== undefined ? raw : JSON.stringify(body),
}), { DB: {}, API_TOKEN: "t" }, {});
const getBatch = () => worker.fetch(new Request("http://x/api/verify-batch", { method: "GET" }), { DB: {}, API_TOKEN: "t" }, {});

test("路由：方法与非 POST 的提示、坏 body、未知彩种、缺参数全部在取数前拒掉", async () => {
  const g = await getBatch();
  assert.equal(g.status, 405, "GET 要显式拒绝，而不是当成缺参数的 400");
  assert.match((await g.json()).usage, /"tickets":\[/, "405 里带可直接照抄的用法");

  const bad = await postBatch(undefined, "{不是 json");
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /JSON body/);

  const unk = await postBatch({ kind: "ssq9", code: "2026104", tickets: ["01 02 03 04 05 06 + 07"] });
  assert.equal(unk.status, 400);
  const uj = await unk.json();
  assert.match(uj.error, /unknown kind/);
  assert.equal(uj.kinds.length, 8, "报错要告诉调用方可用彩种全集");

  const nc = await postBatch({ kind: "ssq", tickets: ["01 02 03 04 05 06 + 07"] });
  assert.equal(nc.status, 400); assert.match((await nc.json()).error, /code 或 codes/);

  // tickets 传成字符串时，下游 tickets.map 会抛 TypeError 变成没有说明的 500 —— 必须在取数前挡成 400
  const notArr = await postBatch({ kind: "ssq", code: "2026104", tickets: "01 02 03 04 05 06 + 07" });
  assert.equal(notArr.status, 400, "tickets 非数组应 400，不是 500");
  assert.match((await notArr.json()).error, /字符串数组/);
});
