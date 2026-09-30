// 核对线上页面脚本的关键渲染事实（部署后验证用）。
const BASE = process.env.BASE || "https://cp.leilaomi.cc.cd";
const html = await (await fetch(BASE + "/")).text();
const has = (s) => html.includes(s);

console.log("页面长度:", html.length);
const checks = [
  ["图表登记表 regChart 已上线", has("function regChart(")],
  ["统一 resize 已上线", has("function resizeCharts(")],
  ["销毁函数 disposeChart 已上线", has("function disposeChart(")],
  ["切页调用 resizeCharts", has("setTimeout(resizeCharts, 0)")],
  ["旧的逐个 resize 写法已移除", !has("window.__chart.resize()")],
  ["冷门度回看图走登记表销毁", has("disposeChart('cbtchart')")],
  ["同步时序图走登记表销毁", has("disposeChart('syncchart')")],
  ["分析页按位路径已上线", has("analyzeDigitText(an)")],
  ["分析页号码池文字已抽成纯函数", has("function analyzePoolText(")],
  ["数字型文字已抽成纯函数", has("function analyzeDigitText(")],
  ["来源横幅已上线", has("当前不是真实开奖数据")],
  ["快乐8 号码已统一走 balls()", !has("o.nums.map(n => '<span class=" + JSON.stringify('"ball"'))],
];
let bad = 0;
for (const [label, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? "✓" : "✗"} ${label}`); }

const inits = (html.match(/echarts\s*\.\s*init/g) || []).length;
console.log(`\n  echarts.init 出现 ${inits} 次（应为 1，只在 regChart 内）`);
if (inits !== 1) bad++;

console.log(bad ? `\n失败 ${bad} 项` : "\n全部通过");
process.exit(bad ? 1 : 0);