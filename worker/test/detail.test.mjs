import { test } from "node:test";
import assert from "node:assert/strict";
import { parse500 } from "../src/ssq.js";
import { parseDLT500 } from "../src/dlt.js";

// 夹具按 2026-10 实测 500 历史页列序构造（表头两行 + 数据行）
const SSQ_HTML = `<table>
<tr><td>期号</td><td>红球号码</td></tr>
<tr><td>2</td><td>26115</td><td>04</td><td>13</td><td>14</td><td>18</td><td>22</td><td>24</td><td>03</td><td>&nbsp;</td><td>909,402,631</td><td>15</td><td>6,031,127</td><td>131</td><td>147,585</td><td>337,573,290</td><td>2026-10-08</td></tr>
</table>`;
const DLT_HTML = `<table>
<tr><td>2</td><td>26114</td><td>08</td><td>12</td><td>15</td><td>29</td><td>30</td><td>09</td><td>12</td><td>747,810,334</td><td>5</td><td>7,702,634</td><td>142</td><td>85,822</td><td>277,888,881</td><td>2026-10-07</td></tr>
</table>`;

test("detail：双色球 500 行解析奖池/销量/一二等奖", () => {
  const [d] = parse500(SSQ_HTML);
  assert.equal(d.code, "2026115");
  assert.deepEqual(d.red, ["04", "13", "14", "18", "22", "24"]);
  assert.equal(d.blue, "03");
  assert.equal(d.detail.pool, 909402631);
  assert.equal(d.detail.sales, 337573290);
  assert.deepEqual(d.detail.prizes[0], { level: "一等奖", count: 15, amount: 6031127 });
  assert.deepEqual(d.detail.prizes[1], { level: "二等奖", count: 131, amount: 147585 });
});

test("detail：大乐透 500 行解析且带真实开奖日期", () => {
  const [d] = parseDLT500(DLT_HTML);
  assert.equal(d.code, "26114");
  assert.equal(d.date, "2026-10-07"); // 旧实现 date 恒为空，奖级规则按日期选版本会失真
  assert.equal(d.detail.pool, 747810334);
  assert.equal(d.detail.prizes[0].count, 5);
});

test("detail：列数不足时不造 detail、号码仍可用", () => {
  const html = `<table><tr><td>1</td><td>26115</td><td>04</td><td>13</td><td>14</td><td>18</td><td>22</td><td>24</td><td>03</td><td>&nbsp;</td></tr></table>`;
  const [d] = parse500(html);
  assert.equal(d.detail, undefined);
  assert.equal(d.red.length, 6);
});
