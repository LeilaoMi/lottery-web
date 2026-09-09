// scripts/coldness/ssq-fit.mjs —— 双色球「冷门度」系数的拟合 + 样本外验证 + 安慰剂 + 线上常量对账
//
// 为什么存在：worker/src/coldness.js 里那几个乘子（1.174 / 1.074 / 0.918 / 1.241 / 0.812）
// 是本仓库唯一被真实分奖数据证实、且样本外成立的可操作结论。没有复现脚本，它们就退化成
// 「一组没人能重跑的神秘常量」——过几个月数据变了也没人知道它们还成不成立。
//
// 方法与双色球随机性审计同源（scripts/randomness/）：
//   y = log(1 + 一等奖注数 / (销量/亿元))，单变量分组几何均值之比 = 可解释乘子；
//   旧 70% 拟合、新 30% 按时间顺序外推检验；每条效应配一个安慰剂。
//
// 三条不能违反的纪律（改这个文件前先读）：
// 1. 特征定义必须与 worker/src/coldness.js 的 present{} 逐字一致，否则「拟合的和上线的不是同一个东西」。
// 2. 蓝球冷热名单是【在训练段里按热度排序】挑出来的，检验段完全不参与 —— 否则就是拿答案挑题目。
// 3. 样本过滤条件是 n1>0 && n2>0：所以系数刻画的是「当期有头奖时」的分奖强度。
//    一等奖空出的期（约 4.7%）不在样本内 —— ratio 是「同奖人数的相对倍数」，不是一等奖命中率的倍数。
//    这一点必须写进报告，别让读数被当成后者。
//
// 用法：node scripts/coldness/ssq-fit.mjs [ssq.json 路径]
// 产出：stdout 报告 + docs/coldness-latest.md + scripts/coldness/out/ssq.json
// 退出码：安慰剂显著 / 样本外反号 / 五分位比塌掉 → 1（"跑挂了或结论崩了"，不是"结果不好看"）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pearson, spearman, mannWhitney, DATA_FILE, rel } from "../randomness/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT_DIR = join(HERE, "out");
const DOC_FILE = join(ROOT, "docs", "coldness-latest.md");
const WORKER_FILE = join(ROOT, "worker", "src", "coldness.js");
const DATA = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : DATA_FILE;

const mean = a => a.reduce((x, z) => x + z, 0) / a.length;
const L = [];
const out = (...a) => L.push(a.join(" "));
const f3 = x => Number(x).toFixed(3);

// ---------------------------------------------------------------- 数据
if (!existsSync(DATA)) {
  console.error(`!! 找不到数据文件 ${rel(DATA)}，先跑 node scripts/randomness/fetch-ssq.mjs`);
  process.exit(1);
}
const all = JSON.parse(readFileSync(DATA, "utf8"));
// 与冷热度拟合定义一致：要有销量才能归一，要有各奖级注数才有一致口径
const rows = all.filter(r => r.sales > 0 && r.n1 > 0 && r.n2 > 0);
const tail = x => x % 10;
// 特征定义逐字对齐 worker/src/coldness.js 的 present{}
const feat = r => ({
  code: r.code, date: r.date, sales: r.sales, n1: r.n1, n2: r.n2,
  allLe31: r.red.every(x => x <= 31) ? 1 : 0,
  hasTail8: r.red.some(x => tail(x) === 8) ? 1 : 0,
  hasTail4: r.red.some(x => tail(x) === 4) ? 1 : 0,
  consec: r.red.filter((x, i) => i && x - r.red[i - 1] === 1).length,
  blueHot: [5, 6, 7, 8, 9, 10, 11, 12].includes(r.blue) ? 1 : 0,
  blueCold: [1, 14, 15, 16].includes(r.blue) ? 1 : 0
});
const F = rows.map(feat);
const KEY = ["allLe31", "hasTail8", "hasTail4", "blueHot", "blueCold", "consec"];
const y = f => Math.log(1 + f.n1 / (f.sales / 1e8));
const y2 = f => Math.log(1 + f.n2 / (f.sales / 1e8));   // 二等奖 = 6 红无蓝 → 蓝球特征的安慰剂
// 朴素单变量乘子：分组几何均值之比（可解释、可手算复核，不做多元回归——多元系数没人能一眼验伪）
function multipliers(sub) {
  const o = {};
  for (const k of KEY) {
    const one = sub.filter(f => f[k] > 0), zero = sub.filter(f => f[k] === 0);
    o[k] = one.length >= 30 && zero.length >= 30 ? Math.exp(mean(one.map(y)) - mean(zero.map(y))) : 1;
  }
  return o;
}
const split = Math.floor(F.length * 0.7);
const train = F.slice(0, split), test = F.slice(split);   // 时间顺序：旧 70% 拟合，新 30% 外推
const Mtr = multipliers(train), Mte = multipliers(test);

// ---------------------------------------------------------------- 组合指数（只用训练段系数）
const idx = f => KEY.reduce((p, k) =>
  p * Math.pow(Math.max(0.2, Mtr[k]), f[k] === 0 ? (k === "consec" ? f.consec : 0) : 1), 1) * (1 + 0.12 * f.consec);
const te = test.map(idx), tr = train.map(idx);
const actual = test.map(f => f.n1 / (f.sales / 1e8));
const ord = te.map((v, i) => [v, actual[i]]).sort((a, b) => a[0] - b[0]);
const per = Math.floor(ord.length / 5);
const q1 = ord.slice(0, per).map(x => x[1]), q5 = ord.slice(-per).map(x => x[1]);
const ratio = mean(q5) / mean(q1), mw = mannWhitney(q5, q1);
const trOrd = tr.map((v, i) => [v, train[i].n1 / (train[i].sales / 1e8)]).sort((a, b) => a[0] - b[0]);
const trRatio = mean(trOrd.slice(-per).map(x => x[1])) / mean(trOrd.slice(0, per).map(x => x[1]));
// 安慰剂：蓝球特征打在「不看蓝」的二等奖上必须是 1
const plc = {};
for (const k of ["blueHot", "blueCold"]) {
  const one = test.filter(f => f[k] > 0), zero = test.filter(f => f[k] === 0);
  plc[k] = Math.exp(mean(one.map(y2)) - mean(zero.map(y2)));
}
// 绝对刻度：线上 avgFirstWinners 用的是「所有有销量的期」的均值（含一等奖空出的期）——
// 因为彩民每期都买，期望同奖人数要把 0 也算进去；而拟合样本只剩 n1>0 的期，两者不能混。
const saleRows = all.filter(r => r.sales > 0);
const avgN1all = mean(saleRows.map(r => r.n1));   // → 线上常量对账用这个
const avgN1pos = mean(F.map(f => f.n1));          // → 拟合样本内的条件均值，仅作说明
const zeroRate = 1 - saleRows.filter(r => r.n1 > 0).length / saleRows.length;

// ---------------------------------------------------------------- 与线上常量对账
const wtxt = readFileSync(WORKER_FILE, "utf8");
const shipped = {};
for (const m of wtxt.matchAll(/key:\s*'(\w+)',\s*label:[^}]*?m:\s*([0-9.]+)/g)) shipped[m[1]] = Number(m[2]);
const hotM = wtxt.match(/blueHotSet:\s*\[([\d,\s]+)\]/), coldM = wtxt.match(/blueColdSet:\s*\[([\d,\s]+)\]/);
const avgM = wtxt.match(/avgFirstWinners:\s*([0-9.]+)/);
const setOf = m => (m ? m[1].split(",").map(s => Number(s.trim())).sort((a, b) => a - b) : []);
const drift = KEY.filter(k => k in shipped).map(k => ({ k, fit: +f3(Mtr[k]), shipped: shipped[k], d: +(Mtr[k] - shipped[k]).toFixed(4) }));
const listsInSync = JSON.stringify(setOf(hotM)) === JSON.stringify([5, 6, 7, 8, 9, 10, 11, 12])
  && JSON.stringify(setOf(coldM)) === JSON.stringify([1, 14, 15, 16]);

// ---------------------------------------------------------------- 闸门（失败 = 结论崩了，不是结果不好看）
const fails = [];
if (!(ratio > 1.2)) fails.push(`五分位最热/最冷 ${f3(ratio)} ≤1.2 —— 拥挤度效应已弱到不值得作为功能存在`);
for (const k of ["allLe31", "hasTail8", "hasTail4", "blueHot", "blueCold"]) {
  if (!(k in Mte)) continue;
  if (Math.sign(Mtr[k] - 1) !== Math.sign(Mte[k] - 1)) fails.push(`${k} 样本外反号（${f3(Mtr[k])} → ${f3(Mte[k])}）—— 系数不可发布`);
}
for (const k of ["blueHot", "blueCold"]) {
  if (Math.abs(plc[k] - 1) > 0.05) fails.push(`安慰剂 ${k} 打在二等奖上 = ${f3(plc[k])}（应≈1）—— 实现里有混淆，本轮结论作废`);
}
if (!listsInSync) fails.push("蓝球冷热名单与 worker/src/coldness.js 不一致");
if (Math.abs(avgN1all - Number(avgM && avgM[1])) > 0.15) fails.push(`avgFirstWinners 漂移：本次实测（全体有销量期）${avgN1all.toFixed(2)} vs 线上 ${avgM && avgM[1]}`);
const warn = drift.filter(d => Math.abs(d.d) > 0.02);

// ---------------------------------------------------------------- 报告
out("# 双色球冷门度系数（自动生成，勿手改）");
out("");
out(`生成时间：${new Date().toISOString().slice(0, 16).replace("T", " ")}Z ｜ 数据：${rel(DATA)}（全量 ${all.length} 期，进入拟合 ${F.length} 期）`);
out("");
out("这个脚本在量的是**别的玩家有多爱买同一组号**：一等奖注数 / 每亿元销量。");
out("它只影响「万一中了要和多少人分奖」，**不改变中奖概率**，期望回报仍为负。");
out("");
out("## 0. 口径与已知限制（先说，免得读数被过度解读）");
out("");
out(`- 样本过滤 \`销量>0 且 n1>0 且 n2>0\`：拟合的是「当期有头奖时」的同奖人数强度。有销量的 ${saleRows.length} 期里有 ${F.length} 期进入拟合，`);
out(`  一等奖空出的期占 ${(zeroRate * 100).toFixed(1)}%（这些期照样要买，只是没人和你分），早期销量列缺失的年份被过滤掉（本份数据首条进入拟合的是 ${F[0].code}）。`);
out(`- 绝对刻度用**无条件**均值：全体有销量期的一等奖注数均值 = ${avgN1all.toFixed(2)}（线上常量 ${(avgM && avgM[1]) || "-"}）；`);
out(`  拟合样本内的**条件**均值 = ${avgN1pos.toFixed(2)}。两者差的正是上面 ${(zeroRate * 100).toFixed(1)}%；把后者当刻度会把 estWinners 系统性高估。`);
out("- `ratio` 是「同奖人数相对于平均水平的倍数」，**不是一等奖命中率的倍数** —— 冷门组合不会让你更容易中奖。");
out("- 单变量乘子之间不正交（生日区与尾数、冷热蓝有重叠），组合指数是**乘性近似**，不是无偏估计；");
out("  所以只看五分位单调性和样本外方向，不把某个系数的具体数值当精确刻度读。");
out("");
out("## 1. 单变量乘子（>1 = 买的人更多 = 更该避开）");
out("");
out("| 特征 | 旧 70% 拟合 | 新 30% 样本外 | 方向 | 线上常量 | 漂移 |");
out("|---|---|---|---|---|---|");
for (const k of KEY) {
  const sd = drift.find(d => d.k === k);
  out(`| \`${k}\` | ${f3(Mtr[k])} | ${f3(Mte[k])} | ${Math.sign(Mtr[k] - 1) === Math.sign(Mte[k] - 1) ? "一致" : "✗ 反号"} | ${sd ? sd.shipped : "—（未上线）"} | ${sd ? (sd.d >= 0 ? "+" : "") + sd.d.toFixed(4) : "-"} |`);
}
out("");
out("样本内 " + train.length + " 期 / 样本外 " + test.length + " 期，切分按时间顺序（训练段 " + train[0].code + "→" + train[train.length - 1].code + "）。");
out("");
out("## 2. 组合指数（系数只来自旧 70%，新 30% 完全没参与）");
out("");
out(`- Pearson r = ${pearson(te, actual).toFixed(4)}，Spearman ρ = ${spearman(te, actual).toFixed(4)}`);
out(`- 五分位（冷→热）实际一等奖注数/亿元：${ord.slice(0, 5).map((x, i) => "Q" + (i + 1) + " " + mean(ord.slice(i * per, (i + 1) * per).map(v => v[1])).toFixed(2)).join("  ")}`);
out(`- **最热 / 最冷 = ${ratio.toFixed(3)}**（Mann-Whitney p=${mw.p.toExponential(2)}）；样本内同口径 ${trRatio.toFixed(3)} —— 两者差距就是过拟合的量`) ;
out("");
out("## 3. 安慰剂（必须 ≈1，否则整套结论作废）");
out("");
out(`- \`blueHot\` 打在**不看蓝球**的二等奖上：${f3(plc.blueHot)}`);
out(`- \`blueCold\` 打在**不看蓝球**的二等奖上：${f3(plc.blueCold)}`);
out("- 二等奖只由 6 个红球决定，蓝球冷热不可能影响它；测出显著 = 归一化或分组写错了。");
out("");
out("## 4. 对账结论");
out("");
out(listsInSync ? "- 蓝球冷热名单与线上 `worker/src/coldness.js` 一致" : "- ✗ 蓝球冷热名单与线上不一致");
out(warn.length ? `- ⚠ 系数漂移 >0.02：${warn.map(d => `${d.k} ${d.fit}→线上 ${d.shipped}`).join("、")} —— 数据更新了，考虑重拟合并同步常量` : "- 线上常量与本次重拟合一致（漂移 ≤0.02）");
out("");
out("随机游戏，统计仅供娱乐，不保证中奖。冷门组合不会让你更容易中奖，只可能在中奖后少几个人分。");
out("");
out(fails.length ? "COLDNESS: FAIL" : "COLDNESS: PASS");
if (fails.length) for (const s of fails) out("  - " + s);

const text = L.join("\n") + "\n";
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(DOC_FILE, text);
writeFileSync(join(OUT_DIR, "ssq.json"), JSON.stringify({
  generated: new Date().toISOString(), nAll: all.length, nTrain: train.length, nTest: test.length,
  Mtr, Mte, placebo: plc, ratio, trRatio, mwP: mw.p,
  avgFirstWinners: +avgN1all.toFixed(3), avgFirstWinnersGivenWinners: +avgN1pos.toFixed(3), zeroWinnerRate: +zeroRate.toFixed(4),
  shipped, drift, listsInSync, fails
}, null, 1));
console.log(text);
console.error(`报告已写入 ${rel(DOC_FILE)}｜机器可读产物 ${rel(join(OUT_DIR, "ssq.json"))}`);
if (fails.length) {
  console.error(`\n!! 冷门度结论不再成立（${fails.length} 项）：\n   ${fails.join("\n   ")}`);
  console.error("COLDNESS: FAIL");
  process.exit(1);
}
console.error("COLDNESS: PASS");
