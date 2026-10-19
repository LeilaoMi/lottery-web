// 双色球期望回报与反热门机选：规则口径 / 概率 / 均分期望 / 选号约束
import { test } from "node:test";
import assert from "node:assert/strict";
import { SSQ_TOTAL, SSQ_PROB, expShare, ssqEV, ssqEVReport, coldPicks, ratiosOf } from "../src/ev.js";

const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };

test("奖级组合数与 C(33,6)×16 自洽", () => {
  assert.equal(SSQ_TOTAL, C(33, 6) * 16);
  assert.equal(SSQ_PROB.p3, 6 * 27);
  assert.equal(SSQ_PROB.p4, 6 * 27 * 15 + 15 * C(27, 2));
  assert.equal(SSQ_PROB.p5, 15 * C(27, 2) * 15 + 20 * C(27, 3));
  assert.equal(SSQ_PROB.p6, C(27, 6) + 6 * C(27, 5) + 15 * C(27, 4));
});

test("expShare：λ=0 独得（封顶），λ 越大越少，封顶生效", () => {
  assert.equal(expShare(3e6, 0), 3e6);
  assert.equal(expShare(9e6, 0), 5e6);
  assert.ok(expShare(1e7, 5) < expShare(1e7, 1));
  assert.ok(Math.abs(expShare(1e9, 3) - 5e6) < 1);
});

test("奖池 ≥1 亿走 55%+20% 两段（单注最高 1000 万），<1 亿走 75% 一段", () => {
  const big = ssqEV({ sales: 3.4e8, pool: 1e9 });
  const small = ssqEV({ sales: 3.4e8, pool: 2e7 });
  assert.ok(big.expectPay.first > 5e6 && big.expectPay.first <= 1e7);
  assert.ok(small.expectPay.first <= 5e6);
  assert.ok(big.ev > small.ev);
  assert.ok(big.returnRate > 0.4 && big.returnRate < 0.6, "回报率应落在 50% 附近：" + big.returnRate);
});

test("冷门倍率 <1 → EV 上升；蓝球特征不影响二等奖倍率", () => {
  const a = ssqEV({ sales: 3.4e8, pool: 1e9 });
  const b = ssqEV({ sales: 3.4e8, pool: 1e9, ratio1: 0.745, ratio2: 0.918 });
  assert.ok(b.ev > a.ev);
  const r = ratiosOf([1, 2, 3, 4, 5, 6], 1); // 全 ≤31 + 尾4 + 蓝冷
  assert.equal(r.ratio2, +(1.174 * 0.918).toFixed(3));
});

test("报告：详情不足如实报错；足够时给下一期与赛前回放", () => {
  assert.equal(ssqEVReport([{ code: "1" }]).error, "insufficient_detail");
  const rows = Array.from({ length: 10 }, (_, i) => ({ code: String(2026110 - i), date: "", detail: { sales: 3.4e8, pool: 9e8, prizes: [] } }));
  const r = ssqEVReport(rows);
  assert.equal(r.next.afterCode, "2026110");
  assert.equal(r.history.length, 9);
});

test("反热门机选：含 32/33、无尾 8、含尾 4、蓝球冷门、无 3 连号、不重复", () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ps = coldPicks(20, rnd);
  assert.equal(ps.length, 20);
  assert.equal(new Set(ps.map(p => p.red.join() + p.blue)).size, 20);
  for (const p of ps) {
    const r = p.red.map(Number);
    assert.ok(r.some(x => x >= 32));
    assert.ok(!r.some(x => x % 10 === 8));
    assert.ok(r.some(x => x % 10 === 4));
    assert.ok([1, 14, 15, 16].includes(Number(p.blue)));
    assert.ok(!r.some((x, i) => i >= 2 && r[i - 1] === x - 1 && r[i - 2] === x - 2));
    assert.ok(p.ratio < 1);
  }
});
