// scripts/coldness/check-sync.mjs —— CI 快检：线上冷门度常量 vs 已提交拟合产物（不重拟合）
//
// 与 ssq-fit.mjs 的分工：
//   ssq-fit.mjs（randomness.yml 月度）：重跑数据 → 样本外验证 → 安慰剂 → 对账（分钟级、要联网拉数）
//   check-sync.mjs（sync.yml 每次 push）：只读仓库内三份已提交产物做一致性断言（毫秒级、纯离线）
//
// 抓的是「有人手改了 coldness.js 却没重跑拟合」「拟合产物与 Worker 脱节」「回看数据被掏空」
// 这三类静默腐烂——它们不会让单测变红，只会让站上展示的系数来历不明。
// 退出码：0 = 一致；1 = 脱节（CI 直接红）。
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const fail = [];
const ok = (...m) => console.log("ok:", ...m);
const bad = (...m) => { fail.push(m.join(" ")); console.error("::error::" + m.join(" ")); };

// ① 拟合产物存在且闸门全过
const outPath = join(ROOT, "scripts", "coldness", "out", "ssq.json");
if (!existsSync(outPath)) {
  bad("scripts/coldness/out/ssq.json 不存在 —— 先跑 node scripts/coldness/ssq-fit.mjs");
  process.exit(1);
}
const fit = JSON.parse(readFileSync(outPath, "utf8"));
if (Array.isArray(fit.fails) && fit.fails.length) bad("拟合产物自带 fails:", fit.fails.join("; "));
else ok("拟合产物 fails 为空");
if (!fit.listsInSync) bad("拟合产物 listsInSync=false —— 蓝球名单曾与线上不一致");
else ok("listsInSync=true");

// ② 线上常量 vs 拟合产物的 shipped / Mtr（漂移 ≤0.02，与 ssq-fit 的 warn 阈值一致）
const wtxt = readFileSync(join(ROOT, "worker", "src", "coldness.js"), "utf8");
const shipped = {};
for (const m of wtxt.matchAll(/key:\s*'(\w+)',\s*label:[^}]*?m:\s*([0-9.]+)/g)) shipped[m[1]] = Number(m[2]);
const hotM = wtxt.match(/blueHotSet:\s*\[([\d,\s]+)\]/);
const coldM = wtxt.match(/blueColdSet:\s*\[([\d,\s]+)\]/);
const avgM = wtxt.match(/avgFirstWinners:\s*([0-9.]+)/);
const setOf = m => (m ? m[1].split(",").map(s => Number(s.trim())).sort((a, b) => a - b) : []);

const expectHot = [5, 6, 7, 8, 9, 10, 11, 12], expectCold = [1, 14, 15, 16];
if (JSON.stringify(setOf(hotM)) !== JSON.stringify(expectHot)) bad("blueHotSet 与预期不符:", setOf(hotM));
else ok("blueHotSet 一致");
if (JSON.stringify(setOf(coldM)) !== JSON.stringify(expectCold)) bad("blueColdSet 与预期不符:", setOf(coldM));
else ok("blueColdSet 一致");

for (const [k, ship] of Object.entries(shipped)) {
  const ref = (fit.Mtr && fit.Mtr[k] != null) ? fit.Mtr[k] : (fit.shipped && fit.shipped[k]);
  if (ref == null) { bad(k + " 在拟合产物里找不到参照值"); continue; }
  if (Math.abs(ship - ref) > 0.02) bad(k + " 线上 " + ship + " vs 拟合 " + ref.toFixed(4) + " 漂移 >0.02 —— 改了常量没重跑拟合？");
  else ok(k + " " + ship + " ≈ " + ref.toFixed(4));
}
for (const k of ["allLe31", "hasTail8", "hasTail4", "blueHot", "blueCold"]) {
  if (!(k in shipped)) bad("coldness.js 缺少已发布特征 " + k);
}
if (!avgM) bad("coldness.js 解析不到 avgFirstWinners");
else if (fit.avgFirstWinners != null && Math.abs(Number(avgM[1]) - fit.avgFirstWinners) > 0.15)
  bad("avgFirstWinners 线上 " + avgM[1] + " vs 拟合 " + fit.avgFirstWinners);
else ok("avgFirstWinners " + (avgM && avgM[1]));

// ③ 站内回看产物：非空、样本外五分位单调趋势成立（ratioTest > 1.2，与 ssq-fit 闸门同源）
const btPath = join(ROOT, "worker", "src", "coldness-backtest.js");
if (!existsSync(btPath)) bad("worker/src/coldness-backtest.js 不存在");
else {
  const btSrc = readFileSync(btPath, "utf8");
  const m = btSrc.match(/export const COLDBT = ([\s\S]+);?\s*$/);
  if (!m) bad("coldness-backtest.js 解析不到 COLDBT");
  else {
    const bt = JSON.parse(m[1].trim().replace(/;\s*$/, ""));
    if (!Array.isArray(bt.testQuintiles) || bt.testQuintiles.length !== 5) bad("testQuintiles 应为 5 档");
    else ok("testQuintiles 5 档");
    if (!(bt.ratioTest > 1.2)) bad("ratioTest " + bt.ratioTest + " ≤1.2 —— 回看数据与已发布结论矛盾");
    else ok("ratioTest " + bt.ratioTest);
    if (fit.backtest && fit.backtest.ratioTest != null && Math.abs(fit.backtest.ratioTest - bt.ratioTest) > 1e-9)
      bad("backtest.ratioTest 与 out/ssq.json 不一致 —— 两份产物不同步");
    else ok("backtest 与 out/ssq.json 同步");
  }
}

// ④ docs 里的月度闸门结论仍在（防止有人把 FAIL 留在仓库里当绿灯）
const docPath = join(ROOT, "docs", "coldness-latest.md");
if (!existsSync(docPath)) bad("docs/coldness-latest.md 不存在");
else {
  const doc = readFileSync(docPath, "utf8");
  if (!/^COLDNESS: PASS$/m.test(doc)) bad("docs/coldness-latest.md 末尾不是 COLDNESS: PASS");
  else ok("docs COLDNESS: PASS");
}

if (fail.length) {
  console.error(`\n!! 冷门度常量对账失败（${fail.length} 项）。重跑 node scripts/coldness/ssq-fit.mjs 并同步 coldness.js，或还原手改。`);
  process.exit(1);
}
console.log("冷门度常量对账：线上 coldness.js ↔ 拟合产物 ↔ 站内回看 三者一致");
