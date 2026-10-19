// 复盘记分牌（Holm / SPRT）、开奖偏差 CUSUM、大乐透 2026 新规期望回报
import { test } from "node:test";
import assert from "node:assert/strict";
import { holm, sprt } from "../src/scoreboard.js";
import { zonesOf, cusumZone, driftReport, DRIFT_H } from "../src/drift.js";
import { dltEV, DLT_TOTAL, DLT_PROB } from "../src/ev.js";

test("Holm：与手算一致、保序单调、null 原样", () => {
  assert.deepEqual(holm([0.01, 0.04, 0.03, null]), [0.03, 0.06, 0.06, null]);
  assert.deepEqual(holm([0.5]), [0.5]);
});

test("SPRT：命中远低于 H1 → h0；远高 → h1；样本少 → continue", () => {
  assert.equal(sprt(250, 2500, 0.1).verdict, "h0");
  assert.equal(sprt(400, 2500, 0.1).verdict, "h1");
  assert.equal(sprt(11, 100, 0.1).verdict, "continue");
});

test("CUSUM：均匀随机不越界，人为偏置的号码越界并被点名", () => {
  const z = zonesOf("ssq")[0];
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const draw = bias => { const a = Array.from({ length: 33 }, (_, i) => i + 1); const out = bias ? [7] : []; while (out.length < 6) { const v = a[Math.floor(rnd() * 33)]; if (!out.includes(v)) out.push(v); } return out; };
  const fair = Array.from({ length: 500 }, () => draw(false));
  assert.ok(cusumZone(z, fair).maxAll < DRIFT_H[z.key] * 1.2);
  const mk = rows => rows.map((r, i) => ({ code: String(2026500 - i), red: r, blue: 1 }));
  const biased = Array.from({ length: 500 }, (_, i) => draw(i < 250));
  const rep = driftReport("ssq", mk(biased));
  assert.equal(rep.zones[0].alarm, true);
  assert.ok(rep.zones[0].alarms.some(a => a.name === "07" && a.dir === "偏多"));
});

test("CUSUM 区划：七星彩第 7 位单列 15 格；七乐彩不监测特别号", () => {
  assert.deepEqual(zonesOf("qxc").map(z => z.key), ["digit:10:6", "digit:15:1"]);
  assert.deepEqual(zonesOf("qlc").map(z => z.id), ["main"]);
  for (const k of ["ssq", "dlt", "qlc", "kl8", "fc3d", "pl3", "pl5", "qxc"]) for (const z of zonesOf(k)) assert.ok(DRIFT_H[z.key] > 0, k + " 缺阈值 " + z.key);
});

test("大乐透：七档中奖组合数自洽；奖池 ≥8 亿切换高档且回报率上升", () => {
  assert.equal(DLT_TOTAL, 324632 * 66);
  assert.equal(DLT_PROB.p3, 45 + 150);
  assert.equal(DLT_PROB.p7, 195750 + 812000 + 137025 + 142506);
  const lo = dltEV({ sales: 2.9e8, pool: 7.9e8 }), hi = dltEV({ sales: 2.9e8, pool: 8e8 });
  assert.equal(lo.tier, "1~8亿"); assert.match(hi.tier, /≥8亿/);
  assert.ok(hi.returnRate > lo.returnRate + 0.05, `${hi.returnRate} vs ${lo.returnRate}`);
  assert.ok(lo.addOn.ticket3.returnRate < lo.returnRate, "追加只分浮动奖，3 元整注回报率低于 2 元基本投注");
});
