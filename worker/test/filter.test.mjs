import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPool } from "../src/filter.js";

test("filter：无条件时枚举全部组合", () => {
  const r = filterPool("ssq", { pool: ["01", "02", "03", "04", "05", "06", "07"], pick: 6 });
  assert.equal(r.total, 7); // C(7,6)
  assert.equal(r.combos.length, 7);
});

test("filter：和值范围过滤", () => {
  const r = filterPool("ssq", { pool: ["01", "02", "03", "04", "05", "06", "07"], pick: 6, conditions: { sumMin: 22 } });
  // 组合和：缺07=21 缺06=22 缺05=23 缺04=24 缺03=25 缺02=26 缺01=27；>=22 共 6 注
  assert.equal(r.total, 6);
  assert.ok(r.combos.every(c => c.reduce((a, b) => a + Number(b), 0) >= 22));
});

test("filter：胆码必含、排除号必不含", () => {
  const r = filterPool("ssq", { pool: ["01", "02", "03", "04", "05", "06", "07", "08"], pick: 6, dan: ["01"], exclude: ["08"] });
  assert.ok(r.combos.every(c => c.includes("01") && !c.includes("08")));
  assert.equal(r.total, 6); // 池 7 个含胆，C(6,5)=6
});

test("filter：奇偶个数过滤", () => {
  const r = filterPool("ssq", { pool: ["01", "02", "03", "04", "05", "06"], pick: 3, conditions: { oddMin: 3 } });
  assert.equal(r.total, 1); // 只有 01 03 05
  assert.deepEqual(r.combos[0], ["01", "03", "05"]);
});

test("filter：组合空间过大时拒绝", () => {
  const r = filterPool("kl8", { pick: 10 }); // 全池 80 选 10 远超上限
  assert.ok(r.error);
});

test("filter：数字型彩种不适用", () => {
  const r = filterPool("fc3d", {});
  assert.ok(r.error);
});

test("filter：结果截断标记", () => {
  const pool = Array.from({ length: 14 }, (_, i) => String(i + 1).padStart(2, "0"));
  const r = filterPool("ssq", { pool, pick: 6 }); // C(14,6)=3003 > 2000
  assert.equal(r.total, 3003);
  assert.equal(r.combos.length, 2000);
  assert.equal(r.truncated, true);
});
