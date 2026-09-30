// 前端页面 JS 的语法门禁。
//
// frontend/index.html 不在 node --test 的覆盖范围内（它不是模块，没法 import），
// 于是一处括号不配对只会在浏览器里静默失败：整个 <script> 块不执行，页面看着正常、
// 点什么都不动。本轮改分析页时就真写出来过一处（多一个右括号），
// 由这个检查抓住 —— 所以把它固化成测试，而不是提交前靠手点。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const HTML_PATH = new URL("../../frontend/index.html", import.meta.url);

test("前端 index.html：每个内联 script 块都能通过语法解析", () => {
  const html = readFileSync(HTML_PATH, "utf8");
  const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1])
    .filter(code => code.trim().length > 0);
  assert.ok(blocks.length > 0, "没找到内联 script 块 —— 页面结构变了？");

  const dir = mkdtempSync(join(tmpdir(), "fe-syntax-"));
  const errs = [];
  blocks.forEach((code, i) => {
    const f = join(dir, `block${i}.js`);
    writeFileSync(f, code);
    try {
      execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    } catch (e) {
      errs.push(`script 块 #${i + 1}（${code.length} 字符）语法错误：\n${e.stderr.toString()}`);
    }
  });
  assert.equal(errs.length, 0, errs.join("\n---\n"));
});

test("前端 index.html：分析页必须同时具备号码池与数字型两条渲染路径", () => {
  const html = readFileSync(HTML_PATH, "utf8");
  // 数字型彩种（福彩3D/排列3/排列5/七星彩）没有号码池，分析页必须有独立的按位渲染分支。
  // 旧实现只有一条号码池路径，数字型走进去后按位图被空图覆盖、文本被整体赋值抹掉。
  assert.match(html, /function analyzeDigit\(/, "缺少数字型分析渲染函数 analyzeDigit");
  assert.match(html, /function drawGroupedChart\(/, "缺少多系列绘图函数（按位分组柱图需要）");
  assert.match(html, /if \(isDigit\) return await analyzeDigit/, "loadAnalyze 未按数字型分流");
  // 数字型不该出现号码池专属文案（号码频次/平均AC/质合比 这些对它没有意义）
  const digitFn = html.slice(html.indexOf("async function analyzeDigit"), html.indexOf("// 遗漏走势：统一引擎"));
  for (const word of ["平均AC", "质合比", "区间分布", "号码频次（"]) {
    assert.doesNotMatch(digitFn, new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "数字型渲染分支里不该出现号码池专属字段「" + word + "」");
  }
});

test("前端 index.html：mock 占位必须自己喊出来（不许把编造数据画成正常图表）", () => {
  const html = readFileSync(HTML_PATH, "utf8");
  assert.match(html, /function sourceBanner\(/, "缺少数据来源横幅 sourceBanner");
  // 三源全挂时 getDraws 返回一条编造的单期，count=1、freq 仍是满池 —— 不提示就是假图表
  assert.match(html, /当前不是真实开奖数据/, "缺少 mock 占位警示文案");
  assert.match(html, /未经第二源交叉校验/, "缺少单源（未经交叉校验）提示");
  assert.ok(html.includes("$('#stats').innerHTML = sourceBanner(an)"),
    "分析页未渲染来源横幅");
});

// 图表 0 宽事故的回归锁。
//
// ECharts 在 display:none 的容器上 init 出来量到 0 宽，之后必须 resize 才会重排。
// 分析页/审计页的图是在页面加载时（标签页还没显示）就画好的，切页时得补一次 resize。
// 原实现手写三个 if（__chart/__chart2/__chart3）逐个 resize —— 加了新图就忘了补：
// 分年柱图与审计页那三张图一直没人 resize，点开是空白；v0.15.5 新增的按位分组图
// 又踩了一次（数字型彩种改走 drawGroupedChart，新实例不在名单里）。
// 现在统一走 __charts 登记表 + resizeCharts()，这两条断言防止有人再写回逐个 if。
test("前端 index.html：所有图表实例必须登记，且切页时统一 resize（防 0 宽空白图）", () => {
  const html = readFileSync(HTML_PATH, "utf8");

  const inits = [...html.matchAll(/echarts\s*\.\s*init/g)];
  // 只允许 regChart 内部这一处直接 init
  assert.equal(inits.length, 1,
    "echarts.init 应只在 regChart 里出现一次，实际 " + inits.length + " 处（新增图表请走 regChart）");
  const idx = html.indexOf("function regChart(");
  assert.ok(idx >= 0, "缺少 regChart 登记表");
  assert.ok(html.indexOf("echarts.init") >= idx,
    "echarts.init 必须位于 regChart 内部");

  assert.match(html, /function resizeCharts\(/, "缺少 resizeCharts");
  assert.match(html, /setTimeout\(resizeCharts, 0\)/, "切页时未调用 resizeCharts");

  // 不允许再出现「按名字逐个 resize」的旧写法
  assert.doesNotMatch(html, /window\.__(chart|chart2|chart3|btchart|revchart|cbtchart|syncchart)\b/,
    "仍存在绕过登记表、直接引用 window.__xxx 图表实例的写法");
});

test("前端 index.html：重画前必须 dispose 旧实例并从登记表删除（防泄漏与复用已销毁实例）", () => {
  const html = readFileSync(HTML_PATH, "utf8");
  assert.match(html, /function disposeChart\(/, "缺少 disposeChart");
  // dispose 后必须 delete 登记项，否则 regChart 会把已 dispose 的实例当成可用实例返回
  assert.match(html, /dispose\(\)[\s\S]{0,80}delete __charts\[key\]/, "disposeChart 未从登记表删除 key");
  // 审计页那两块是「点加载就重建容器」，必须先销毁
  assert.match(html, /disposeChart\('cbtchart'\)/, "冷门度回看图重画前未销毁旧实例");
  assert.match(html, /disposeChart\('syncchart'\)/, "同步时序图重画前未销毁旧实例");
});
