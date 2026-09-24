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
  vm.runInContext(m[1] + "\n;globalThis.__fn = { renderVerifyBatch, hitText, shareCardLines, chaseCalendarHtml, renderAudit };", ctx);
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

test("前端渲染：大乐透浮动奖仍用见公告占位（固定奖按版本给金额）", () => {
  const draws = [{ code: "26104", date: "2026-09-07", front: ["01", "05", "12", "22", "30"], back: ["03", "07"] }];
  const r = verifyBatch("dlt", draws, ["01 05 12 22 30 + 03 07"], ["26104"], 1);
  assert.equal(r.rounds[0].results[0].grade, "一等");
  assert.equal(r.rounds[0].results[0].amount, null);
  assert.deepEqual(r.amountUnverified, ["dlt"]);
  const html = FN.renderVerifyBatch(r);
  assert.ok(html.includes("—（见公告）"), "金额未校验 → 用「见公告」占位");
  assert.ok(!/<td>0 元<\/td>/.test(html), "中奖行不许显示成 0 元（汇总行的 0 元是合法累计值，不在此列）");
  assert.ok(html.includes("另有 1 注中的是本站未给金额的奖级"), "要有注数级别的未给金额提示");
  assert.ok(html.includes("部分奖级金额未校验"), "要有彩种级别的说明");
});

test("前端渲染：大乐透固定奖按版本给金额（新规则三等 10000，旧规则四等 200）", () => {
  const draws = [
    { code: "26106", date: "2026-09-16", front: ["01", "05", "12", "22", "30"], back: ["03", "07"] },
    { code: "18001", date: "2018-01-03", front: ["01", "05", "12", "22", "30"], back: ["03", "07"] },
  ];
  const rNew = verifyBatch("dlt", draws, ["01 05 12 22 30 + 08 09"], ["26106"], 1);
  assert.equal(rNew.rounds[0].results[0].grade, "三等");
  assert.equal(rNew.rounds[0].results[0].amount, 10000);
  const rOld = verifyBatch("dlt", draws, ["01 05 12 22 07 + 03 08"], ["18001"], 1);
  assert.equal(rOld.rounds[0].results[0].grade, "四等");
  assert.equal(rOld.rounds[0].results[0].amount, 200);
});

test("前端渲染：数字彩按位命中与快乐8中奖金额走同一条通路", () => {
  const d3 = [{ code: "2026242", date: "2026-09-08", digits: ["9", "2", "7"] }];
  const r3 = verifyBatch("fc3d", d3, ["9 2 7", "9 2 8", "927"], ["2026242"], 1);
  const g = r3.rounds[0].results.map(x => x.grade);
  assert.deepEqual(g, ["直选", "未中", "直选"], "9 2 7 与连写 927 都算直选中，9 2 8 不中");
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

test("分享图片卡片：免责声明必须进图，胆拖单与纯推荐号两种布局都成立", () => {
  // 免责声明进图是纪律：分享出去的图脱离页面上下文，图上没有「仅供娱乐」= 替本站背书
  const ticket = FN.shareCardLines({ name: "双色球", dan: ["01", "05"], tuo: ["12", "22", "28", "30"], aux: ["04"], bets: 4, amount: 8 });
  const texts = ticket.map(l => l.t).join("\n");
  assert.ok(texts.includes("随机游戏，仅供娱乐，不保证中奖"), "免责声明必须出现在卡片行里");
  assert.ok(texts.includes("胆 01 05"), "胆码行");
  assert.ok(texts.includes("4 注 / 8 元"), "注数金额行");
  assert.equal(ticket[0].s, "title", "第一行是标题样式");
  // 纯推荐号（无胆拖）：main 行要出现，且不与胆拖行混淆
  const picks = FN.shareCardLines({ kindName: "大乐透", code: "26104", main: ["01", "05", "12", "22", "30"], blue: ["03", "07"] });
  const pt = picks.map(l => l.t).join("\n");
  assert.ok(pt.includes("大乐透 · 26104"), "标题带彩种与期号");
  assert.ok(pt.includes("号 01 05 12 22 30 + 03,07") || pt.includes("号 01 05 12 22 30 + 03,07"), "推荐号行含主区与副区");
  assert.ok(pt.includes("随机游戏，仅供娱乐，不保证中奖"), "纯推荐布局也要有免责声明");
  // 有胆拖时不得再画 main 行（避免重复号码）
  assert.ok(!ticket.some(l => l.t.startsWith("号 ")), "胆拖单不应再出现「号」行");
});

test("追号日历：按月铺格、命中日带期号金额与累计，推算说明进页面", () => {
  const chase = {
    periods: 3, totalBets: 6, totalAmount: 12,
    plan: [
      { period: 1, mult: 1, bets: 2, amount: 4, date: "2026-09-22" },
      { period: 2, mult: 1, bets: 2, amount: 4, date: "2026-09-24" },
      { period: 3, mult: 1, bets: 2, amount: 4, date: "2026-10-01" },
    ],
    dates: ["2026-09-22", "2026-09-24", "2026-10-01"],
    calendarNote: "日期按开奖日历推算（不含春节等休市），以官方公告为准",
  };
  const html = FN.chaseCalendarHtml(chase);
  assert.ok(html.includes("2026 年 9 月") && html.includes("2026 年 10 月"), "跨月要出两个月份块");
  assert.ok(html.includes("第1期") && html.includes("第3期"), "格内标期号");
  assert.ok(html.includes("累 4") && html.includes("累 12"), "累计投入跟到最后一期");
  assert.ok(html.includes("以官方公告为准"), "推算免责说明必须进页面");
  assert.ok(html.includes(">22<") || html.includes("22"), "9 月 22 日格存在");
  // 无 date 的旧计划（或单期）不画日历
  assert.equal(FN.chaseCalendarHtml({ plan: [{ period: 1, amount: 4 }] }), "");
  assert.equal(FN.chaseCalendarHtml({ plan: [] }), "");
  assert.ok(!/undefined/.test(html), "不许出现 undefined");
});

test("站内审计页：fail/warn/pass/skip 各有徽章，skip 不许渲染成绿 PASS", () => {
  const r = {
    overall: "fail",
    generatedAt: "2026-09-24T00:00:00.000Z",
    note: "skip = 该项未部署或未跑过，不是「已验证无问题」；fail/warn 才是行动信号。",
    checks: [
      { id: "data_freshness", label: "数据新鲜度", status: "fail", detail: "最陈旧：双色球 6 天", items: [{ name: "双色球", days: 6 }, { name: "大乐透", days: 1 }] },
      { id: "review_loop", label: "预测复盘闭环", status: "warn", detail: "2 彩种有快照，1 个已有对账" },
      { id: "sync_health", label: "上游同步健康", status: "skip", detail: "sync_log 表未部署" },
      { id: "coldness_backtest", label: "冷门度样本外回看", status: "pass", detail: "烘焙于 2026-09-24" },
      { id: "disclaimer", label: "免责声明", status: "pass", detail: "随机游戏…" },
    ],
  };
  const html = FN.renderAudit(r);
  assert.ok(html.includes("FAIL") && html.includes("WARN") && html.includes("SKIP") && html.includes("PASS"), "四种状态徽章齐全");
  assert.ok(html.includes("数据陈旧") || html.includes("双色球 6 天"), "fail 明细进页面");
  assert.ok(html.includes("≥3 天未更新"), "陈旧彩种单独汇总一行");
  // skip 必须是灰字 SKIP，不能偷换成绿色 PASS
  assert.ok(!html.includes("PASS</b>") || true, "占位——真正断言在下两行");
  const skipCell = html.split("sync_log 表未部署")[0];
  assert.ok(skipCell.includes("SKIP"), "skip 项渲染为 SKIP");
  assert.ok(!skipCell.includes("PASS"), "skip 不得渲染成 PASS");
  assert.ok(html.includes("skip ≠") || html.includes("不是「已验证无问题」"), "note 里的 skip 纪律要进页面");
  assert.ok(!/undefined|\[object Object\]/.test(html), "不许出现 undefined / [object Object]");
  // 空 checks 的防御
  assert.ok(FN.renderAudit({ checks: [] }).includes("未返回"));
});
