// coldness 单测：验证冷门度评分的方向、边界与"不改变中奖概率"的表述纪律
import { test } from "node:test";
import assert from "node:assert/strict";
import { coldness, COLD_KINDS } from "../src/coldness.js";

test("全部 ≤31 + 热门蓝球 = 最热组合，ratio > 1", () => {
  const r = coldness("ssq", ["01", "05", "12", "19", "23", "31"], ["09"]);
  assert.ok(r.ratio > 1.4, "全生日区+热蓝应显著偏热，实际 " + r.ratio);
  assert.equal(r.label, "很热");
  assert.ok(r.factors.some(f => f.key === "allLe31"));
  assert.ok(r.factors.some(f => f.key === "blueHot"));
});
test("含 32/33 + 冷门蓝球 = 最冷组合，ratio < 1", () => {
  const r = coldness("ssq", ["03", "11", "17", "26", "32", "33"], ["01"]);
  assert.ok(r.ratio < 0.85, "含大号+冷蓝应偏冷，实际 " + r.ratio);
  assert.ok(r.factors.some(f => f.key === "blueCold"));
  assert.ok(!r.factors.some(f => f.key === "allLe31"), "含 32/33 时不得计入 allLe31");
});
test("冷热两端的 estWinners 必须拉开明显差距", () => {
  const hot = coldness("ssq", ["01", "05", "12", "19", "23", "31"], ["09"]).estWinners;   // 全生日区 + 热蓝
  const cold = coldness("ssq", ["04", "11", "17", "26", "32", "33"], ["01"]).estWinners;  // 含大号 + 尾4 + 冷蓝
  assert.ok(hot / cold > 1.8, "热/冷同奖人数估算比应 >1.8，实际 " + (hot / cold).toFixed(2));
});
test("coldIndex 单调：ratio 越小越冷门，且恒在 0-100", () => {
  const a = coldness("ssq", ["01", "02", "03", "04", "05", "06"], ["08"]);
  const b = coldness("ssq", ["04", "14", "24", "25", "32", "33"], ["01"]);
  assert.ok(a.ratio > b.ratio && a.coldIndex < b.coldIndex, "ratio 与 coldIndex 必须反向");
  for (const r of [a, b]) { assert.ok(r.coldIndex >= 0 && r.coldIndex <= 100); }
});
test("输入校验：拒绝 5 个红球 / 重复号 / 越界号 / 非法蓝球 / 不支持彩种", () => {
  assert.ok(coldness("ssq", ["01", "02", "03", "04", "05"], ["03"]).error);
  assert.ok(coldness("ssq", ["01", "01", "03", "04", "05", "06"], ["03"]).error);
  assert.ok(coldness("ssq", ["01", "02", "03", "04", "05", "34"], ["03"]).error);
  assert.ok(coldness("ssq", ["01", "02", "03", "04", "05", "06"], ["17"]).error);
  assert.ok(coldness("ssq", ["01", "02", "03", "04", "05", "06"], []).error);
  const dlt = coldness("dlt", ["01", "02", "03", "04", "05"], ["01", "02"]);
  assert.equal(dlt.supported, false, "未拟合系数的彩种必须显式标 supported:false，不得凭空给分");
  assert.ok(!COLD_KINDS.dlt);
});
test("表述纪律：任何返回值都必须带「不改变中奖概率」的免责声明", () => {
  const r = coldness("ssq", ["01", "05", "12", "19", "23", "31"], ["09"]);
  assert.match(r.disclaimer, /不改变中奖概率/);
  assert.match(r.disclaimer, /期望回报仍为负/);
});
test("连号特征已被剔除（样本外反号），不得影响任何评分", () => {
  // 两组都不含任何被计分特征：无尾4/尾8、非全≤31、蓝球取中性的 13，唯一差别是有无连号
  const withConsec = coldness("ssq", ["01", "02", "03", "15", "26", "33"], ["13"]);
  const without = coldness("ssq", ["05", "09", "13", "17", "26", "33"], ["13"]);
  assert.deepEqual(withConsec.factors, [], "对照组自身不应命中任何特征，否则本测试失去意义");
  assert.deepEqual(without.factors, []);
  assert.equal(withConsec.ratio, 1);
  assert.equal(without.ratio, 1, "若把连号重新加回特征表，这两行断言会立刻失败");
});
test("容忍前导零与数字混传，且输出统一补零两位", () => {
  const r = coldness("ssq", [1, "05", " 12 ", "19", "23", "31"], [" 9 "]);
  assert.equal(r.error, undefined, "宽松解析不应报错");
  assert.deepEqual(r.main, ["01", "05", "12", "19", "23", "31"]);
  assert.deepEqual(r.aux, ["09"]);
});
