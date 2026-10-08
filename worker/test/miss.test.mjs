import { test } from "node:test";
import assert from "node:assert/strict";
import { missStats } from "../src/miss.js";

// 约定：draws 新期在前（draws[0] 最新）
const ssqDraws = [
  { code: "2026003", red: ["01", "05", "12"], blue: "04" },
  { code: "2026002", red: ["02", "05", "09"], blue: "07" },
  { code: "2026001", red: ["03", "08", "12"], blue: "04" }
];

test("miss：双色球当前遗漏按「距最近出现期数」计", () => {
  const r = missStats("ssq", ssqDraws);
  assert.equal(r.kind, "ssq");
  assert.equal(r.count, 3);
  assert.equal(r.latest, "2026003");
  const m = Object.fromEntries(r.main.map(x => [x.num, x]));
  assert.equal(m["01"].cur, 0); // 最新一期刚出
  assert.equal(m["02"].cur, 1);
  assert.equal(m["03"].cur, 2);
  assert.equal(m["04"].cur, 3); // 窗口内从未出现 = 窗口期数
  assert.equal(m["05"].freq, 2);
  const a = Object.fromEntries(r.aux.map(x => [x.num, x]));
  assert.equal(a["04"].cur, 0);
  assert.equal(a["04"].freq, 2);
  assert.equal(a["07"].cur, 1);
});

test("miss：数字型逐位输出，七星彩第 7 位号池 0-14", () => {
  const draws = [
    { code: "26003", digits: ["1", "2", "3", "4", "5", "6", "12"] },
    { code: "26002", digits: ["1", "2", "3", "4", "5", "6", "9"] }
  ];
  const r = missStats("qxc", draws);
  assert.equal(r.perPos.length, 7);
  assert.equal(r.perPos[6].length, 15);
  const last = Object.fromEntries(r.perPos[6].map(x => [x.num, x]));
  assert.equal(last["12"].cur, 0);
  assert.equal(last["9"].cur, 1);
  assert.equal(last["14"].freq, 0);
});

test("miss：空样本不造数", () => {
  const r = missStats("dlt", []);
  assert.equal(r.count, 0);
  assert.equal(r.main, undefined);
});

test("miss：win 截断窗口", () => {
  const r = missStats("ssq", ssqDraws, 1);
  assert.equal(r.count, 1);
  const m = Object.fromEntries(r.main.map(x => [x.num, x]));
  assert.equal(m["02"].cur, 1);
});
