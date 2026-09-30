// 分析页数据契约：8 个彩种都必须给出前端要渲染的字段。
//
// 这组测试是给「分析页空白」立的回归锁。真实事故：4 个数字型彩种（fc3d/pl3/pl5/qxc）的
// analyze 只返回 {perPos, avgSum, form}，而前端把号码池那套字段（freq/hot/oddRatio/avgAC/
// road012/zoneDist/omission）当成必有 —— 于是渲染出一排空标签，还把唯一的按位图用空图覆盖。
//
// 前端渲染逻辑改起来没有测试网兜底（frontend/index.html 不在 node --test 覆盖内），
// 所以把「后端必须给齐字段」这条契约钉在这里：字段缺失 = 测试失败，而不是线上白屏。
import test from "node:test";
import assert from "node:assert/strict";
import { SPECS, analyzeAll, shapeTrans, trendPool, poolOf, posPool } from "../src/predict.js";

const POOL = Object.keys(SPECS).filter(k => SPECS[k].type === "pool");
const DIGIT = Object.keys(SPECS).filter(k => SPECS[k].type === "digit");
const ALL = [...POOL, ...DIGIT];

// 各位置号池的并集（数字型每位号池可能不同：七星彩第 7 位是 0-14）
function posPoolUnion(kind) {
  const out = new Set();
  for (let p = 0; p < SPECS[kind].digits; p++) posPool(kind, p).forEach(v => out.add(v));
  return [...out].sort();
}

// 造 n 期该彩种的合法开奖记录。样本要「非平凡」：每位在轮转序列上取号，
// 于是重号/分布都有变化 —— 全同号或纯递增会让频次与遗漏退化成单点，断言就假绿了。
function synthDraws(kind, n) {
  const s = SPECS[kind], out = [];
  for (let i = 0; i < n; i++) {
    const d = { code: String(2026000 + i), date: "2026-01-01" };
    if (s.type === "pool") {
      const mp = poolOf(s.main);
      d[s.fMain] = Array.from({ length: s.main.pick }, (_, j) => mp[(i * s.main.pick + j) % mp.length]);
      if (s.aux) {
        const ap = poolOf(s.aux);
        d[s.fAux] = Array.from({ length: s.aux.pick }, (_, j) => ap[(i * s.aux.pick + j) % ap.length]);
      }
    } else {
      d[s.fMain] = Array.from({ length: s.digits }, (_, p) => {
        const pool = posPool(kind, p);
        return pool[(i * 7 + p * 3) % pool.length];
      });
    }
    out.push(d);
  }
  return out;
}

test("契约：号码池型 analyze 必须给齐分析页要渲染的字段", () => {
  assert.ok(POOL.length >= 3, "本用例假设至少有 3 个号码池型彩种，实际 " + POOL.length);
  for (const kind of POOL) {
    const an = analyzeAll(kind, synthDraws(kind, 40), 30);
    const where = kind + ".analyze";
    assert.ok(an.count === 30, where + " count 应为窗口期数 30，实际 " + an.count);
    // 号码池型必须有：号码频次表（图表的数据源）+ 热冷号 + 遗漏 + 各维度占比
    const keys = Object.keys(an.freq || {});
    assert.equal(keys.length, poolOf(SPECS[kind].main).length,
      where + " freq 键数应等于号码池大小（前端按它画 x 轴）");
    assert.ok(keys.every(k => Number(an.freq[k]) >= 0), where + " freq 不得有负值");
    assert.ok(an.hot.length && an.cold.length, where + " hot/cold 不得为空");
    assert.ok(/^\d+:\d+$/.test(an.oddRatio), where + " oddRatio 形如 a:b，实际 " + an.oddRatio);
    assert.ok(/^\d+:\d+$/.test(an.bigRatio), where + " bigRatio 形如 a:b");
    assert.ok(/^\d+:\d+$/.test(an.primeRatio), where + " primeRatio 形如 a:b");
    assert.ok(Number.isFinite(an.avgSum), where + " avgSum 必须是数字");
    assert.ok(Number.isFinite(an.avgAC), where + " avgAC 必须是数字");
    assert.ok(Number.isFinite(an.avgConsec), where + " avgConsec 必须是数字");
    assert.ok(Number.isFinite(an.avgRepeat), where + " avgRepeat 必须是数字");
    assert.equal(an.road012.length, 3, where + " road012 应为 3 档");
    assert.ok(an.zoneDist.length >= 1, where + " zoneDist 不得为空");
    assert.ok(Object.keys(an.omission.cur || {}).length === keys.length, where + " omission.cur 应覆盖全部号码");
    // AC 有硬上限：n 个号最多 C(n,2) 个不同差值，减去 (n-1)。越界就是 acValue 算错了。
    const pick = SPECS[kind].main.pick, cap = pick * (pick - 1) / 2 - (pick - 1);
    assert.ok(an.avgAC <= cap, where + " avgAC " + an.avgAC + " 超过 " + pick + " 选号的理论上限 " + cap);
  }
});

test("契约：数字型 analyze 必须每位都给 freq/omission/oddRatio（分析页的按位图就靠这些）", () => {
  assert.ok(DIGIT.length >= 3, "本用例假设至少有 3 个数字型彩种，实际 " + DIGIT.length);
  for (const kind of DIGIT) {
    const an = analyzeAll(kind, synthDraws(kind, 40), 30);
    const where = kind + ".analyze";
    assert.equal(an.perPos.length, SPECS[kind].digits, where + " perPos 长度应等于位数");
    for (const p of an.perPos) {
      const pw = where + " 第" + p.pos + "位";
      assert.ok(Object.keys(p.freq || {}).length > 0, pw + " freq 不得为空（否则按位图是空白）");
      assert.ok(p.freq && Object.keys(p.freq).length <= 15, pw + " freq 键数不该超过 0-9 号池");
      assert.ok(p.hot && p.cold && p.hot.length && p.cold.length, pw + " hot/cold 不得为空");
      assert.ok(/^\d+:\d+$/.test(p.oddRatio), pw + " oddRatio 形如 a:b，实际 " + p.oddRatio);
      assert.ok(Object.keys((p.omission || {}).cur || {}).length > 0, pw + " omission.cur 不得为空");
    }
    assert.ok(Number.isFinite(an.avgSum), where + " avgSum 必须是数字");
    assert.ok(Number.isFinite(an.avgBigSmall), where + " avgBigSmall 必须是数字（前端展示位）");
    // form 只对 3 位型有意义（组三/组六/豹子）；5 位、7 位型必须为 null 而不是编出来的
    if (SPECS[kind].digits === 3) {
      assert.ok(an.form, where + " 三位型必须有 form");
      const f = an.form;
      assert.equal(f.group3 + f.group6 + f.bail, an.count, where + " 组三+组六+豹子 应等于期数（每期必居其一）");
    } else {
      assert.equal(an.form, null, where + " 非三位型的 form 应为 null（没有组三/组六概念）");
    }
  }
});

test("契约：形态转移对号码池型有内容、对数字型必须给出 note（前端据此显示「不适用」）", () => {
  for (const kind of ALL) {
    const sh = shapeTrans(kind, synthDraws(kind, 40), { window: 40 });
    if (SPECS[kind].type === "pool") {
      assert.ok(sh.sum, kind + ".shapeTrans 应有 sum 维度，实际键：" + Object.keys(sh).join(","));
    } else {
      // 「不支持」必须说出口；返回空对象会让前端 if (an.shape && an.shape.sum) 静默跳过，
      // 用户只看到「别的彩种有这张卡、这个没有」，分不清是功能缺失还是自己操作错了。
      assert.ok(typeof sh.note === "string" && sh.note.length > 0,
        kind + " 数字型的 shapeTrans 必须带 note 说明不支持，实际：" + JSON.stringify(sh));
    }
  }
});

test("契约：号码池型有遗漏走势、数字型 trendPool 明确返回空（前端不画空图而是说明原因）", () => {
  for (const kind of ALL) {
    const rows = trendPool(kind, synthDraws(kind, 40), 30);
    if (SPECS[kind].type === "pool") {
      assert.ok(rows.length > 0, kind + " 号码池型的 trendPool 不应为空");
      assert.ok(rows[0].miss && Object.keys(rows[0].miss).length, kind + " trend 行必须带 miss");
    } else {
      // 数字型无号码池，遗漏走势本就不适用 —— 空数组是「确定为空」，
      // 前端必须把这句「不适用」讲出来，而不是画一张空图让人以为坏了。
      assert.ok(Array.isArray(rows) && rows.length === 0, kind + " 数字型 trendPool 应返回空数组");
    }
  }
});

test("契约：8 个彩种 analyze 都不得因字段缺失而抛错（前端一次请求失败整页就白）", () => {
  for (const kind of ALL) {
    assert.doesNotThrow(() => analyzeAll(kind, synthDraws(kind, 40), 30), kind + " analyzeAll 抛错");
  }
});

test("契约：synthDraws 造的数据必须被各彩种真实解析（防用例自身写错而假绿）", () => {
  // 若 synthDraws 的字段名/位数与 SPECS 不符，上面所有断言都会在「空数据」上假绿。
  // 这里直接确认：造出来的期数与位数、以及各位置号池的并集大小都符合预期。
  for (const kind of ALL) {
    const ds = synthDraws(kind, 12);
    assert.equal(ds.length, 12, kind + " 应造出 12 期");
    for (const d of ds) {
      const s = SPECS[kind], main = d[s.fMain] || [];
      assert.equal(main.length, s.type === "pool" ? s.main.pick : s.digits,
        kind + " 每期主号码个数应为 " + (s.type === "pool" ? s.main.pick : s.digits));
      if (s.aux) assert.equal((d[s.fAux] || []).length, s.aux.pick, kind + " 每期副号码个数应为 " + s.aux.pick);
    }
    if (SPECS[kind].type === "digit") {
      assert.ok(posPoolUnion(kind).length > 0, kind + " 位置号池并集不应为空");
    }
  }
});
