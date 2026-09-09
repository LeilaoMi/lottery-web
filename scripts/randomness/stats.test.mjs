// 统计内核单元测试：node --test scripts/randomness/stats.test.mjs
// 这些断言的意义：p 值函数若错了，整套审计就会把噪声说成发现（或反之）。
// 每个期望值都来自教科书/手算，不是从本实现里抄出来的。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chi2Upper, ncdf, binomP, mannWhitney, pearson, spearman, rng, drawK,
  comb, pHyper, pNCHG, dow, statsOf, simulate, nullSummary, validateRow,
} from "./lib.mjs";

test("正态 CDF 对已知分位数", () => {
  assert.ok(Math.abs(ncdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(ncdf(1.959964) - 0.975) < 1e-6);
  assert.ok(Math.abs(ncdf(-1.281552) - 0.10) < 1e-6);
  assert.ok(Math.abs(ncdf(3) - 0.998650) < 1e-6);
});

test("χ² 上尾 p 对已知临界值", () => {
  assert.ok(Math.abs(chi2Upper(3.841459, 1) - 0.05) < 1e-5);   // df=1
  assert.ok(Math.abs(chi2Upper(5.991465, 2) - 0.05) < 1e-5);   // df=2
  assert.ok(Math.abs(chi2Upper(11.07050, 5) - 0.05) < 1e-5);   // df=5
  assert.ok(Math.abs(chi2Upper(55.758, 40) - 0.0499) < 1e-3);  // df=40
  // df=2 有闭式解 exp(-x/2)：拿来当独立参照。本内核绝对精度约 1e-6（Lanczos logGamma 的限制），
  // 对 p 的判读足够；别按 1e-10 断言，那是实现给不到的。
  assert.ok(Math.abs(chi2Upper(4, 2) - Math.exp(-2)) < 5e-6, String(chi2Upper(4, 2)));
});

test("二项检验（连续性校正）", () => {
  const p = binomP(60, 100, 0.5);                 // z=(10-0.5)/5=1.9 → p=0.0574
  assert.ok(Math.abs(p - 0.05735) < 1e-3, String(p));
  assert.equal(binomP(5, 10, 0.5), null);        // 小样本拒绝出 p
});

test("Mann-Whitney：同分布应为零，位移后应显著", () => {
  const rand = rng(1);
  const a = Array.from({ length: 200 }, () => rand()), b = Array.from({ length: 200 }, () => rand());
  assert.ok(mannWhitney(a, b).p > 0.05);
  assert.ok(mannWhitney(a.map(x => x + 0.3), b).p < 1e-6);
});

test("Pearson / Spearman", () => {
  assert.ok(Math.abs(pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-12);
  assert.ok(Math.abs(pearson([1, 2, 3], [3, 2, 1]) + 1) < 1e-12);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [10, 20, 25, 100]) - 1) < 1e-12);
});

test("drawK 是不放回抽样：k 个互不相同、且取自 pool", () => {
  const rand = rng(7), pool = Array.from({ length: 33 }, (_, i) => i + 1);
  for (let i = 0; i < 500; i++) {
    const s = drawK(rand, pool, 6);
    assert.equal(s.length, 6);
    assert.equal(new Set(s).size, 6);
    assert.ok(s.every(x => pool.includes(x)));
  }
});

test("rng 确定性：同种子同序列", () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
});

test("超几何：C(33,6) 与全概率归一", () => {
  assert.equal(comb(33, 6), 1107568);
  assert.equal(comb(33, 6) * 16, 17721088);
  let s = 0; for (let h = 0; h <= 6; h++) s += pHyper(33, 6, 6, h);
  assert.ok(Math.abs(s - 1) < 1e-12);
});

test("非中心超几何 ω=1 必须逐位等于精确超几何", () => {
  const d = pNCHG(33, 6, 6, 1);
  for (let h = 0; h <= 6; h++) assert.ok(Math.abs(d[h] - pHyper(33, 6, 6, h)) < 1e-12);
  assert.ok(Math.abs(d._expect - 36 / 33) < 1e-12);   // 6×6/33
});

test("Sakamoto 星期：已知日期 + 与 Date.UTC 交叉核对", () => {
  assert.equal(dow(2000, 1, 1), 6);        // 2000-01-01 星期六
  assert.equal(dow(2026, 9, 8), 2);        // 双色球开奖日：周二
  assert.equal(dow(2026, 9, 6), 0);        // 周日
  for (const ms of [Date.UTC(2010, 0, 1), Date.UTC(2019, 2, 13), Date.UTC(2024, 11, 31)]) {
    const d = new Date(ms);
    assert.equal(dow(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), d.getUTCDay());
  }
});

test("statsOf 用在模拟数据上：χ² 期望是 27，不是 32（本仓库踩过的那颗雷）", () => {
  const s = nullSummary(simulate(4000, 300, 99).map(x => x.chi2R));
  assert.ok(Math.abs(s.mean - 27) < 4 * (s.sd / Math.sqrt(300)), String(s.mean));
  assert.ok(s.mean < 30, "如果接近 32，说明模拟退化成了有放回抽样");
});

test("validateRow 挡住脏行", () => {
  const ok = { code: "2026104", date: "2026-09-08", red: [11, 12, 13, 19, 20, 31], blue: 3, order: [11, 19, 13, 20, 12, 31] };
  assert.equal(validateRow(ok), null);
  assert.ok(validateRow({ ...ok, red: [11, 11, 13, 19, 20, 31] }));     // 重复
  assert.ok(validateRow({ ...ok, red: [11, 12, 13, 19, 20, 34] }));     // 越界
  assert.ok(validateRow({ ...ok, red: [11, 12, 13, 19, 31, 20] }));     // 未排序
  assert.ok(validateRow({ ...ok, blue: 17 }));                          // 蓝越界
  assert.ok(validateRow({ ...ok, order: [11, 19, 13, 20, 12, 12] }));   // 顺序与集合不符
});
