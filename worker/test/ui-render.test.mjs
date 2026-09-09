// 前后端契约测试：把真实后端 verifyBatch 的响应灌进前端 renderVerifyBatch，断言渲染结果。
// 为什么要这一层：前端按字段名取值（summary.amountKnown、results[].grade…），后端改名或改口径时
// 页面不会报错，只会静默把「中了 3000 元」渲染成空白 —— 对彩票工具来说这是最坏的一类 bug。
// 前端脚本内联在 frontend/index.html 里，无法 import，所以用 vm 灌进最小 DOM 桩后取函数引用。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { verifyBatch } from "../src/verify-batch.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// 只暴露前端脚本真正会碰到的全局；缺一个就在加载阶段立刻抛 ReferenceError，而不是静默少测
function stubEl() {
  return new Proxy(function () {}, {
    get: (t, p) => (p === "value" ? "" : p === "toString" ? () => "" : stubEl()),
    apply: () => stubEl(),
    set: () => true,
  });
}
function loadFrontend() {
  const html = fs.readFileSync(path.join(ROOT, "frontend", "index.html"), "utf8");
  const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "frontend/index.html 里找不到内联脚本（结构变了要同步这个测试）");
  const ctx = vm.createContext({
    document: stubEl(), navigator: {}, location: { protocol: "http:", href: "http://localhost/" },
    localStorage: stubEl(), fetch: () => stubEl(), console, setTimeout, encodeURIComponent,
    JSON, Math, Date, RegExp, Number, Array, Object, String, parseInt, isNaN, addEventListener: () => {},
  });
  vm.runInContext(m[1] + "\n;globalThis.__fn = { renderVerifyBatch, hitText };", ctx);
  return ctx.__fn;
}
const FN = loadFrontend();

test("前端渲染：双色球固定奖金额与奖级按官方规则落在页面上", () => {
  const draws = [{ code: "2026104", date: "2026-09-08", red: ["01", "05", "12", "22", "28", "30"], blue: "04" }];
  // 期望值取自双色球官方奖级（6+1=一等；5+1=三等 3000；4+0=五等 10；2+1=六等 5），不是从代码输出反推的
  const tickets = [
    "01 05 12 22 28 30 + 04", // 6+1 → 一等（浮动，不给金额）
    "01 05 12 22 28 07 + 04", // 5+1 → 三等 3000
    "01 05 12 22 09 07 + 08", // 4+0 → 五等 10
    "01 02 03 04 05 06 + 04", // 2+1 → 六等 5
    "01 05 12 22 28 + 04",    // 主区只有 5 个 → 坏行
  ];
  const r = verifyBatch("ssq", draws, tickets, ["2026104"], 1);
  assert.equal(r.parsed, 4, "5 行里 4 行解析成功");
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.rounds[0].summary, {
    tickets: 4, multi: 1, winning: 4, byGrade: { 一等: 1, 三等: 1, 五等: 1, 六等: 1 },
    amountKnown: 3015, amountUnknownTier: 1, cost: 8, netIfKnown: 3007,
  });
  const html = FN.renderVerifyBatch(r);
  assert.ok(html.includes("三等"), "奖级要出现在页面上");
  assert.ok(html.includes("3000 元") && html.includes("10 元") && html.includes("5 元"), "固定奖金额按元给出");
  assert.ok(html.includes("—（见公告）"), "浮动奖用「见公告」占位，不能显示成 0 元");
  assert.ok(html.includes("另有 1 注中的是本站未给金额的奖级"), "未给金额的奖级要有显式提示");
  assert.ok(html.includes("第 5 行"), "坏行要带用户粘贴时的行号");
  assert.ok(html.includes("净差 3007 元"), "汇总口径：3015 奖金 - 8 元成本");
  // esc(undefined) 渲染成空串，所以后端字段改名（amountKnown 等）只能靠断言具体数值抓住
  assert.ok(html.includes("已给金额奖金 3015 元"), "汇总行要显示后端算好的已知金额");
  assert.ok(html.includes("成本 8 元"), "成本按每注 2 元 × 倍数");
  assert.ok(html.includes("长期期望回报为负"), "免责说明跟着渲染，不能只在 JSON 里");
  assert.ok(!/undefined|\[object Object\]/.test(html), "页面上不许出现 undefined / [object Object]");
});

test("前端渲染：期号不存在时给可读提示而不是空卡片", () => {
  const draws = [{ code: "2026104", date: "2026-09-08", red: ["01", "05", "12", "22", "28", "30"], blue: "04" }];
  const r = verifyBatch("ssq", draws, ["01 05 12 22 28 30 + 04"], ["2026999"], 1);
  assert.equal(r.rounds[0].drawn, false);
  const html = FN.renderVerifyBatch(r);
  assert.ok(html.includes("2026999") && html.includes("期号不存在或尚未开奖"), "未开奖期要写明期号与原因");
  assert.ok(!html.includes("<table>"), "没有结果就不该渲染中奖表");
});

test("前端渲染：大乐透只给奖级不给金额（金额未校验的彩种不假装有数）", () => {
  const draws = [{ code: "26104", date: "2026-09-07", front: ["01", "05", "12", "22", "30"], back: ["03", "07"] }];
  const r = verifyBatch("dlt", draws, ["01 05 12 22 30 + 03 07"], ["26104"], 1);
  assert.equal(r.rounds[0].results[0].grade, "一等");
  assert.equal(r.rounds[0].results[0].amount, null);
  assert.deepEqual(r.amountUnverified, ["dlt"]);
  const html = FN.renderVerifyBatch(r);
  assert.ok(html.includes("—（见公告）"), "金额未校验 → 用「见公告」占位");
  assert.ok(!/<td>0 元<\/td>/.test(html), "中奖行不许显示成 0 元（汇总行的 0 元是合法累计值，不在此列）");
  assert.ok(html.includes("另有 1 注中的是本站未给金额的奖级"), "要有注数级别的未给金额提示");
  assert.ok(html.includes("该彩种固定奖金额本站未逐字段校验"), "要有彩种级别的说明");
});

test("前端渲染：数字彩按位命中与快乐8中奖金额走同一条通路", () => {
  const d3 = [{ code: "2026242", date: "2026-09-08", digits: ["9", "2", "7"] }];
  const r3 = verifyBatch("fc3d", d3, ["9 2 7", "9 2 8", "927"], ["2026242"], 1);
  const g = r3.rounds[0].results.map(x => x.grade);
  assert.deepEqual(g, ["直选", "未中", "直选"], "9 2 7 与连写 927 都算直选中，9 2 8 未中");
  const html3 = FN.renderVerifyBatch(r3);
  assert.ok(html3.includes("1040 元"), "福彩3D 直选 1040 元要落进页面");
  assert.ok(html3.includes("按位"), "命中列要显示按位命中数");

  const kl = [{ code: "2026242", date: "2026-09-08", nums: ["03", "17", "28", "44", "55", "61", "70", "77"] }];
  const rk = verifyBatch("kl8", kl, ["03 17 28 44 55"], ["2026242"], 1);
  const rr = rk.rounds[0].results[0];
  assert.equal(rr.hitNums, 5);
  assert.ok(typeof rr.amount === "number" && rr.amount > 0, "快乐8 选5中5 有确定金额");
  const htmlK = FN.renderVerifyBatch(rk);
  assert.ok(htmlK.includes("选 5 中 5"), "快乐8 的命中口径是「选几个中几个」");
  assert.ok(htmlK.includes(rr.amount + " 元"), "快乐8 金额按元显示");
});
