// scripts/coldness/dlt-fit.mjs —— 大乐透「冷门度」拟合：一次**负结果**的可复现留档
//
// 结论（写在前面，别白跑）：目标上样本外复现了（组合指数最热/最冷 1.30×，MW p=0.007），
// 但预注册的固定奖级安慰剂对所有候选特征全部失败 → keep=[]、coefficients={}。
// **大乐透没有可发布系数，worker 里也就没有它**（COLD_KINDS 只有 ssq）。
// 方法学上的死结：大乐透没有任何一档奖金只依赖后区（三等奖=前区5中+后区0中），
// 前区组合被超买时它的邻域(4中5)同样被超买 → 固定档安慰剂对前区特征天然偏严，
// 用这份数据无法区分「混淆」与「真实的邻域人气」。要真验证需要集合外的人气代理（各组合投注分布）。
// 完整叙述见 docs/coldness-dlt-2026-09.md；机器可读产物 out/dlt.json。
//
// 为什么不进 randomness.yml 的月度闸门：它的结论不随每月数据变化而翻盘（缺的是外部数据，不是时间），
// 放进 CI 只会把「尚未解决」显示成「构建坏了」。手动跑：node scripts/coldness/dlt-fit.mjs
// 数据：scripts/randomness/data/dlt_asc.txt（由 fetch-multi 生成，不进仓库）；也可传路径参数覆盖
// 零 npm 依赖，统计工具内联
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.argv[2] || path.join(HERE, '..', 'randomness', 'data', 'dlt_asc.txt');
const OUT = path.join(HERE, 'out', 'dlt.json');
if (!fs.existsSync(DATA)) { console.error('!! 找不到 ' + DATA + '，先跑 node scripts/randomness/fetch-multi.mjs dlt'); process.exit(1); }

/* ---------------- 0. 统计工具（内联，无依赖） ---------------- */
const lg = x => { const c = [76.18009172947146, -86.50532032941677, 24.0144412145769, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (let j = 0; j < 6; j++) s += c[j] / ++y; return -t + Math.log(2.5066282746310005 * s / x); };
function gser(a, x) { let ap = a, sum = 1 / a, del = sum; for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; } return sum * Math.exp(-x + a * Math.log(x) - lg(a)); }
function gcf(a, x) { const F = 1e-300; let b = x + 1 - a, c = 1 / F, d = 1 / b, h = d; for (let i = 1; i <= 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < F) d = F; c = b + an / c; if (Math.abs(c) < F) c = F; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break; } return Math.exp(-x + a * Math.log(x) - lg(a)) * h; }
const gammp = (a, x) => x < a + 1 ? gser(a, x) : 1 - gcf(a, x);
const chi2Upper = (x, df) => 1 - gammp(df / 2, x / 2);
const fp = (v) => (v >= 1e-3 ? v.toFixed(4) : v > 0 ? v.toExponential(2) : "<1e-300");
const erf = x => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; };
const ncdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
function mannWhitney(a, b) {
  const na = a.length, nb = b.length, all = a.map(x => [x, 0]).concat(b.map(x => [x, 1])).sort((p, q) => p[0] - q[0]);
  const R = new Array(all.length); let i = 0;
  while (i < all.length) { let j = i; while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) R[k] = r; i = j + 1; }
  let U = 0; for (let k = 0; k < all.length; k++) if (all[k][1] === 0) U += R[k];
  U -= na * (na + 1) / 2;
  const mu = na * nb / 2, sd = Math.sqrt(na * nb * (na + nb + 1) / 12), z = (U - mu) / sd;
  return { U, z, p: Math.min(1, 2 * (1 - ncdf(Math.abs(z)))) };
}
function pearson(x, y) { const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n; let s1 = 0, s2 = 0, s3 = 0; for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; s1 += a * b; s2 += a * a; s3 += b * b; } return s1 / Math.sqrt(s2 * s3); }
function spearman(x, y) { const rk = a => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); idx.forEach(([, i], pos) => r[i] = pos + 1); return r; }; return pearson(rk(x), rk(y)); }
const mean = a => a.reduce((x, z) => x + z, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((x, z) => x + (z - m) ** 2, 0) / (a.length - 1)); };
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const pad = (s, n) => String(s).padEnd(n);
const fx = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v)) ? 'NA' : v.toFixed(d);

/* ---------------- 1. 载入 + 列映射自证 ---------------- */
const lines = fs.readFileSync(DATA, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const N = s => (/^\d+$/.test(s) ? +s : NaN);
const recs = lines.map(f => {
  const t = f.split(/\s+/);
  return {
    code: t[0], date: t[1],
    front: [2, 3, 4, 5, 6].map(i => N(t[i])),
    back: [7, 8].map(i => N(t[i])),
    ordF: [9, 10, 11, 12, 13].map(i => N(t[i])),
    ordB: [14, 15].map(i => N(t[i])),
    sales: N(t[16]), pool: N(t[17]),
    n: [18, 20, 22, 24, 26, 28, 30, 32, 34].map(i => N(t[i])),   // 一至九等奖注数
    m: [19, 21, 23, 25, 27, 29, 31, 33, 35].map(i => N(t[i])),   // 一至九等奖单注奖金
    year: +t[1].slice(0, 4),
  };
});
console.log('=== 0. 列映射自证 ===');
console.log(`行数 ${recs.length}  日期 ${recs[0].date} → ${recs[recs.length - 1].date}  字段数集合 ${[...new Set(lines.map(l => l.split(/\s+/).length))].join(',')}`);
const frontAll = recs.flatMap(r => r.front), backAll = recs.flatMap(r => r.back);
console.log(`前区值域 ${Math.min(...frontAll)}-${Math.max(...frontAll)} (应 1-35)  后区值域 ${Math.min(...backAll)}-${Math.max(...backAll)} (应 1-12)`);
console.log(`前区严格升序 ${recs.every(r => r.front.every((v, i) => !i || v > r.front[i - 1])) ? 'OK' : 'FAIL'} / 前区无重复 ${recs.every(r => new Set(r.front).size === 5) ? 'OK' : 'FAIL'} / 后区无重复 ${recs.every(r => new Set(r.back).size === 2) ? 'OK' : 'FAIL'}`);
const setMatch = recs.filter(r => r.ordF.some(Number.isNaN) === false && [...r.front].sort((a, b) => a - b).join() === [...r.ordF].sort((a, b) => a - b).join() && [...r.back].sort((a, b) => a - b).join() === [...r.ordB].sort((a, b) => a - b).join());
const withOrder = recs.filter(r => !r.ordF.some(Number.isNaN));
console.log(`「开奖顺序」列(9-15)是前/后区集合的排列: ${setMatch.length}/${withOrder.length} 有顺序列的行（缺失集中在 2011 年前，共 ${recs.length - withOrder.length} 行）`);
console.log(`n1 非负整数 ${recs.every(r => Number.isInteger(r.n[0]) && r.n[0] >= 0) ? 'OK' : 'FAIL'}  n1=0 的行 ${recs.filter(r => r.n[0] === 0).length}/${recs.length}  sales>0 ${recs.every(r => r.sales > 0) ? 'OK' : 'FAIL'}`);
{ // sales 平滑性：相邻期 log 变化
  const d = []; for (let i = 1; i < recs.length; i++) d.push(Math.abs(Math.log(recs[i].sales / recs[i - 1].sales)));
  console.log(`sales 相邻期 |Δlog| 最大 ${Math.max(...d).toFixed(3)}（翻倍=0.693），>0.693 的跳变 ${d.filter(x => x > 0.693).length} 次 → 平滑`);
}
// 规则时代（用各时代均恒定的四/五/六等奖奖金签名分簇；一等奖/二等奖恒为浮动，三等奖在 2019-02-19 前也浮动）
const PRE = recs.filter(r => r.year < 2015), POST = recs.filter(r => r.year >= 2015);
const BUNDLE = r => [r.m[3], r.m[4], r.m[5]].join('/');
const regs = {};
recs.forEach(r => { const k = BUNDLE(r); (regs[k] = regs[k] || []).push(r); });
console.log('\n规则时代（按四/五/六等奖单注奖金签名分簇，簇内金额恒定）:');
for (const [k, rows] of Object.entries(regs).sort((a, b) => b[1].length - a[1].length)) {
  const mode = i => { const c = {}; rows.forEach(r => c[r.m[i]] = (c[r.m[i]] || 0) + 1); const t = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return t[0] + '(' + t[1] + '/' + rows.length + ')'; };
  console.log(`  签名 ${k.padEnd(12)} n=${String(rows.length).padStart(4)}  ${rows[0].date}→${rows[rows.length - 1].date}  ` + [2, 3, 4, 5, 6].map(i => `m${i + 1}=${mode(i)}`).join(' '));
}
// 固定奖金锚：owner 声称 m3=5000/m4=300/m5=150/m6=15/m7=5
const ANCHOR = { 2: 5000, 3: 300, 4: 150, 5: 15, 6: 5 };
console.log('\n固定奖金锚核对（三~七等奖单注奖金 = 固定值）:');
for (const i of [2, 3, 4, 5, 6]) {
  const want = ANCHOR[i];
  const hitAll = recs.filter(r => r.m[i] === want).length;
  const p2015 = POST.filter(r => r.m[i] === want).length, pre = PRE.filter(r => r.m[i] === want).length;
  const c = {}; recs.forEach(r => c[r.m[i]] = (c[r.m[i]] || 0) + 1);
  const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(t => t[0] + '×' + t[1]).join(' ');
  console.log(`  m${i + 1}=${want}: 全历史命中 ${hitAll}/${recs.length}（失配 ${recs.length - hitAll}）｜2015+ 命中 ${p2015}/${POST.length}｜2015前 命中 ${pre}/${PRE.length}｜实际众数 ${top}`);
}
// 单行缺陷：m3 众数不符
const defect = recs.filter(r => r.year >= 2019 && r.date >= '2019-02-20' && r.m[2] !== 10000 && !(r.date >= '2026-01-01'));
console.log(`  固定档众数异常行（剔除出安慰剂样本）: ${defect.map(r => r.code + '(m3=' + r.m[2] + ')').join(' ') || '无'}`);

// 交叉核对：与 scripts/randomness/fetch-multi.mjs 解析出的 data/dlt.json 逐期比号码
// （那份是【独立实现 + 独立源】：500.com 快照经另一套列映射解析），本文件自己把同一批 txt 重解析一遍。
// 两边号码一致 = 列映射没串行、期号没错位；号码之外（销量/奖级列）不在此断言范围内，如实留白。
const SIB = path.join(HERE, '..', 'randomness', 'data', 'dlt.json');
if (fs.existsSync(SIB)) {
  const api = JSON.parse(fs.readFileSync(SIB, 'utf8'));
  const byCode = new Map(recs.map(r => [r.code, r]));   // 两边都是 ~2900 期，线性 find 会退化成 O(n²)
  let ok = 0, miss = 0;
  for (const a of api) {
    const r = byCode.get(a.code); if (!r) { miss++; continue; }
    if ([...r.front].sort((x, y) => x - y).join() === a.front.map(Number).sort((x, y) => x - y).join() &&
      [...r.back].sort((x, y) => x - y).join() === a.back.map(Number).sort((x, y) => x - y).join()) ok++;
  }
  console.log(`  与姊妹解析(data/dlt.json) 号码交叉核对: ${ok}/${api.length} 一致${miss ? `，本地缺 ${miss} 期` : ''}`);
  if (ok < api.length - miss) console.log('  !! 有期号码不一致 —— 列映射或期号对齐有问题，本文件的结论全部存疑');
} else {
  console.log('  交叉核对跳过：没有 scripts/randomness/data/dlt.json（先跑 node scripts/randomness/fetch-multi.mjs dlt）');
}

/* ---------------- 2. 数据质量：前区均匀性（复现姊妹套件的污染结论） ---------------- */
function chi2Front(sub) {
  const c = new Array(36).fill(0); sub.forEach(r => r.front.forEach(v => c[v]++));
  const tot = sub.length * 5, e = tot / 35; let x = 0;
  for (let i = 1; i <= 35; i++) x += (c[i] - e) ** 2 / e;
  return { x, df: 34, p: chi2Upper(x, 34), n: sub.length };
}
console.log('\n=== 1. 前区均匀性检验（决定用哪个子集拟合）===');
for (const [name, sub] of [['全历史', recs], ['2015+', POST], ['2015 前', PRE]]) {
  const q = chi2Front(sub);
  console.log(`  ${pad(name, 8)} n=${pad(q.n, 5)} chi2=${q.x.toFixed(1)} df=${q.df} p=${fp(q.p)}${q.p < 0.01 ? '  ← 显著非均匀' : '  ← 与均匀一致'}`);
}
const halves = {};
{
  const fv = sub => { const c = new Array(36).fill(0); sub.forEach(r => r.front.forEach(v => c[v]++)); return c.slice(1); };
  const h1 = fv(recs.filter(r => r.year < 2011)), h2 = fv(recs.filter(r => r.year >= 2011 && r.year < 2015));
  const g1 = fv(recs.slice(0, Math.floor(recs.length / 2))), g2 = fv(recs.slice(Math.floor(recs.length / 2)));
  const a = fv(PRE), b = fv(POST);
  halves.pre2015_internal = pearson(h1, h2);
  halves.fullHistory_byRow = pearson(g1, g2);
  halves.pre_vs_post = pearson(a, b);
  console.log(`  前区频次分半相关：2007-2010 vs 2011-2014 r=${halves.pre2015_internal.toFixed(3)} ｜ 全历史按行数分半 r=${halves.fullHistory_byRow.toFixed(3)} ｜ 2015前 vs 2015+ r=${halves.pre_vs_post.toFixed(3)}`);
  console.log(`  → 2015 前内部自洽（r 高），但与 2015+ 反向相关：该「偏倚」不跨时代持续，符合回填/采集缺陷特征，不是球或投注的稳定结构`);
}
console.log(`  结论：只在 2015+ (n=${POST.length}) 上拟合与报告；2015 前的偏差按数据污染处理，仅作诊断。`);

/* ---------------- 3. 特征工程 ---------------- */
const tail = x => x % 10;
const 亿 = r => r.sales / 1e8;
const y1 = f => Math.log1p(f.r1);                       // log(1 + 一等奖注数/亿元)
const yFix = i => f => { const v = f.n[i] / 亿(f); return Math.log(v > 0 ? v : 1e-9) - f.regOff[i]; }; // 固定档：去时代均值后的对数率
function buildFeatures(sub) {
  // 时代内去均值（消除规则变更/口径造成的水平漂移），只用于固定档安慰剂
  const bundles = {};
  sub.forEach(f => { const k = f.sig; (bundles[k] = bundles[k] || []).push(f); });
  for (const k in bundles) {   // 三等奖奖金偏离本时代众数的行 = 采集缺陷，剔除出固定档安慰剂
    const g = bundles[k], c = {};
    g.forEach(f => c[f.m[2]] = (c[f.m[2]] || 0) + 1);
    const mode = +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
    g.forEach(f => { f.badFix = f.m[2] !== mode; });
  }
  for (const i of [2, 3, 4]) {
    for (const k in bundles) {
      const g = bundles[k].filter(f => f.n[i] > 0 && !f.badFix);
      const mu = g.length ? mean(g.map(f => Math.log(f.n[i] / 亿(f)))) : 0;
      bundles[k].forEach(f => { f.regOff[i] = mu; });
    }
  }
  return sub;
}
const toF = r => ({
  code: r.code, date: r.date, year: r.year, sig: BUNDLE(r),
  front: r.front, back: r.back, ordB: r.ordB, ordF: r.ordF,
  sales: r.sales, n1: r.n[0], n2: r.n[1], n: r.n, m: r.m, m1: r.m[0],
  r1: r.n[0] / 亿(r), r2: r.n[1] / 亿(r),
  regOff: {},
  allLe31: r.front.every(x => x <= 31) ? 1 : 0,
  hasTail8: r.front.some(x => tail(x) === 8) ? 1 : 0,
  hasTail4: r.front.some(x => tail(x) === 4) ? 1 : 0,
  nLe12hi: r.front.filter(x => x <= 12).length >= 2 ? 1 : 0,
  consec: r.front.some((x, i) => i && x - r.front[i - 1] === 1) ? 1 : 0,
  consec2: r.front.filter((x, i) => i && x - r.front[i - 1] === 1).length >= 2 ? 1 : 0,
  sumHi: 0,                              // 用 train 中位数定阈值，稍后回填
  frontSum: r.front.reduce((a, b) => a + b, 0),
  backOrder: Number.isNaN(r.ordB[0]) ? null : (r.ordB[0] < r.ordB[1] ? 1 : 0),   // 噪声安慰剂：后区两球开出先后（集合给定后仍是均匀置换）
  ordAsc: Number.isNaN(r.ordF[0]) ? null : (r.ordF[0] < r.ordF[4] ? 1 : 0),      // 噪声安慰剂：先开球 < 后开球（P=1/2，与集合无关）
  ordMaxFirst: Number.isNaN(r.ordF[0]) ? null : (r.ordF[0] === Math.max(...r.front) ? 1 : 0), // 噪声安慰剂：最大号第一个开（P=1/5）
});
const sumOf = f => f.frontSum;

// 后区冷热：只用 train 数据按「每亿元一等奖率」对 12 个后区号排序
function backSets(train) {
  const num = new Array(13).fill(0), den = new Array(13).fill(0);
  train.forEach(f => f.back.forEach(b => { num[b] += f.n1; den[b] += 亿(f); }));
  const rate = []; for (let b = 1; b <= 12; b++) rate.push([b, den[b] ? num[b] / den[b] : 0]);
  rate.sort((a, b) => b[1] - a[1]);
  const HOT = rate.slice(0, 3).map(x => x[0]), COLD = rate.slice(-3).map(x => x[0]);
  return { HOT, COLD, rank: rate.map(x => x[0] + ':' + x[1].toFixed(2)).join(' ') };
}
const attachBack = (list, HOT, COLD) => list.forEach(f => {
  f.backHot = f.back.some(b => HOT.includes(b)) ? 1 : 0;
  f.backCold = f.back.some(b => COLD.includes(b)) ? 1 : 0;
});

const KEY = ['allLe31', 'hasTail8', 'hasTail4', 'nLe12hi', 'consec', 'sumHi', 'backHot', 'backCold', 'backOrder', 'ordAsc', 'ordMaxFirst'];
const NOISE = ['backOrder', 'ordAsc', 'ordMaxFirst'];
const FIXED_TIER = { 2: '三等奖', 3: '四等奖', 4: '五等奖' };

function mults(sub, yget) {
  const out = {};
  for (const k of KEY) {
    const one = sub.filter(f => f[k] === 1), zero = sub.filter(f => f[k] === 0);
    if (one.length < 30 || zero.length < 30) { out[k] = { m: NaN, se: NaN, n1: one.length, n0: zero.length }; continue; }
    const d = mean(one.map(yget)) - mean(zero.map(yget));
    const se = Math.sqrt(sd(one.map(yget)) ** 2 / one.length + sd(zero.map(yget)) ** 2 / zero.length);
    out[k] = { m: Math.exp(d), se, n1: one.length, n0: zero.length };
  }
  return out;
}
// 带固定奖级密度作控制变量的 OLS：一等奖效应里扣除「本期整体中奖更多」这一共性，剩下的才是一等奖特有
function ols(y, cols) {
  const p = cols.length, n = y.length;
  const X = [];
  for (let j = 0; j < p; j++) { const c = cols[j]; X.push(c); }
  const XtX = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => { let s = 0; for (let i = 0; i < n; i++) s += X[a][i] * X[b][i]; return s; }));
  const Xty = X.map(c => { let s = 0; for (let i = 0; i < n; i++) s += c[i] * y[i]; return s; });
  // 高斯消元求 (X'X)^-1
  const m = XtX.map((r, i) => r.concat(Array.from({ length: p }, (_, j) => i === j ? 1 : 0)));
  for (let c = 0; c < p; c++) {
    let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    const d = m[c][c]; if (!d) return null;
    for (let j = 0; j < 2 * p; j++) m[c][j] /= d;
    for (let r = 0; r < p; r++) { if (r === c) continue; const f = m[r][c]; if (!f) continue; for (let j = 0; j < 2 * p; j++) m[r][j] -= f * m[c][j]; }
  }
  const Inv = m.map(r => r.slice(p));
  const b = Inv.map((row, a) => { let s = 0; for (let j = 0; j < p; j++) s += row[j] * Xty[j]; return s; });
  let rss = 0; for (let i = 0; i < n; i++) { let yh = 0; for (let j = 0; j < p; j++) yh += b[j] * X[j][i]; rss += (y[i] - yh) ** 2; }
  const s2 = rss / (n - p);
  return { b, se: b.map((_, j) => Math.sqrt(s2 * Inv[j][j])) };
}
const idxOf = (f, M, keys) => keys.reduce((p, k) => p * Math.pow(Math.min(3, Math.max(0.3, M[k].m)), f[k]), 1);
const quintiles = (vals, actual, q = 5) => {
  const ord = vals.map((v, i) => [v, actual[i]]).sort((a, b) => a[0] - b[0]);
  const per = Math.floor(ord.length / q), segs = [];
  for (let i = 0; i < q; i++) segs.push(ord.slice(i * per, i === q - 1 ? ord.length : (i + 1) * per).map(x => x[1]));
  return segs;
};

/* ---------------- 4. 主分析：2015+ 时序 70/30 ---------------- */
function runEra(sub, label) {
  const F = sub.map(toF);
  const split = Math.floor(F.length * 0.7);
  const train = F.slice(0, split), test = F.slice(split);
  const thr = median(train.map(sumOf));
  F.forEach(f => { f.sumHi = f.frontSum > thr ? 1 : 0; });
  const { HOT, COLD, rank } = backSets(train);
  attachBack(F, HOT, COLD);
  buildFeatures(train); buildFeatures(test);   // 时代内去均值（各自用本组均值，仅影响水平不影响组间比）
  const Mtr = mults(train, y1), Mte = mults(test, y1);
  return { F, train, test, thr, HOT, COLD, rank, Mtr, Mte };
}
const A = runEra(POST, '2015+');
console.log(`\n=== 2. 2015+ 子集 单特征「一等奖注数/亿元」乘子（>1 = 该特征组合被买得更凶 = 更该避开）===`);
console.log(`拟合窗口 ${A.train[0].date} → ${A.train[A.train.length - 1].date} (n=${A.train.length}) ｜ 检验窗口 ${A.test[0].date} → ${A.test[A.test.length - 1].date} (n=${A.test.length})  严格时序外推`);
console.log(`后区冷热号（仅用 train 排）: ${A.rank}  → HOT=${A.HOT.join(',')} COLD=${A.COLD.join(',')}`);
console.log(pad('特征', 16) + pad('样本内', 10) + pad('样本外', 10) + '同号?  样本外95%CI');
for (const k of KEY) {
  const a = A.Mtr[k].m, b = A.Mte[k];
  const ci = [Math.exp(Math.log(b.m) - 1.96 * b.se), Math.exp(Math.log(b.m) + 1.96 * b.se)];
  console.log(pad(k, 16) + pad(fx(a), 10) + pad(fx(b.m), 10) + pad(Math.sign(a - 1) === Math.sign(b.m - 1) ? '一致' : '✗反号', 7) + `[${fx(ci[0])}, ${fx(ci[1])}]  n=${b.n1}/${b.n0}`);
}

/* ---------------- 5. 安慰剂：固定奖金档 ---------------- */
console.log('\n=== 3. 安慰剂：同一特征在「固定单注奖金」档（三/四/五等奖）上的样本外乘子 ===');
console.log('三~七等奖奖金恒定 → 与销量归一后投注偏好理应不可检出；若也出现效应 = 混淆（时代漂移/口径），非人气');
const placebo = {};
for (const ti of [2, 3, 4]) {
  const use = A.test.filter(f => !f.badFix && f.n[ti] > 0);
  const Mp = mults(use, yFix(ti));
  placebo[ti] = Mp;
  console.log(`\n  目标 ${FIXED_TIER[ti]}注数/亿元（时代内去均值, n=${use.length}）:`);
  console.log('  ' + pad('特征', 16) + pad('一等奖', 10) + pad('本档', 10) + '比值  本档95%CI');
  for (const k of KEY) {
    const fl = A.Mte[k].m, pf = Mp[k];
    const ci = [Math.exp(Math.log(pf.m) - 1.96 * pf.se), Math.exp(Math.log(pf.m) + 1.96 * pf.se)];
    console.log('  ' + pad(k, 16) + pad(fx(fl), 10) + pad(fx(pf.m), 10) + pad(fx(fl / pf.m), 7) + `[${fx(ci[0])}, ${fx(ci[1])}]${(ci[0] <= 1 && ci[1] >= 1 && Math.abs(pf.m - 1) <= 0.05) ? '  ✓≈1' : ''}`);
  }
}

/* ---------------- 8b. 一等奖特异性：控制「本期整体中奖密度」后的偏效应 ---------------- */
console.log('\n=== 4b. 一等奖特异性检验（OLS: log 一等奖率 ~ 特征 + log四等奖率 + log五等奖率 + 截距，样本外）===');
console.log('固定档作控制变量吸收「本期整体中奖多/口径漂移」；若特征偏效应消失 → 不是「这一注组合被超买」，只是本期普遍中奖多');
const conditional = {};
{
  const use = A.test.filter(f => !f.badFix && f.n[3] > 0 && f.n[4] > 0 && !Number.isNaN(f.n[3]));
  const y = use.map(f => Math.log1p(f.r1));
  const c4 = use.map(yFix(3)), c5 = use.map(yFix(4));
  for (const k of KEY) {
    const rows = use.map((f, i) => [f[k], i]).filter(([v]) => v === 0 || v === 1);
    if (rows.length < 60) { conditional[k] = { m: NaN }; continue; }
    const idx = rows.map(([, i]) => i), xv = rows.map(([v]) => v);
    const fit = ols(idx.map(i => y[i]), [Array(rows.length).fill(1), xv, idx.map(i => c4[i]), idx.map(i => c5[i])]);
    if (!fit) { conditional[k] = { m: NaN }; continue; }
    const b = fit.b[1], se = fit.se[1];
    conditional[k] = { m: Math.exp(b), se, ci: [Math.exp(b - 1.96 * se), Math.exp(b + 1.96 * se)], n: rows.length };
    const marg = A.Mte[k].m;
    console.log('  ' + pad(k, 12) + '边际 ' + pad(fx(marg), 8) + '偏效应 ' + pad(fx(Math.exp(b)), 9) + `CI[${fx(conditional[k].ci[0])},${fx(conditional[k].ci[1])}]` + (conditional[k].ci[0] > 1 || conditional[k].ci[1] < 1 ? (b > 0 ? '  一等奖特有↑' : '  一等奖特有↓') : '  被固定档解释掉'));
  }
}
const condKeep = KEY.filter(k => !NOISE.includes(k) && Number.isFinite(conditional[k] && conditional[k].m) &&
  (conditional[k].ci[0] > 1 || conditional[k].ci[1] < 1) &&
  Math.sign(conditional[k].m - 1) === Math.sign(A.Mtr[k].m - 1));
console.log(`  仅按「一等奖特异性」可保留: ${condKeep.join(', ') || '(无)'}`);
/* ---------------- 6. 组合指数：样本外判别力 ---------------- */
const IDXKEY = ['allLe31', 'hasTail8', 'hasTail4', 'nLe12hi', 'consec', 'sumHi', 'backHot', 'backCold'];
const trIdx = A.train.map(f => idxOf(f, A.Mtr, IDXKEY)), teIdx = A.test.map(f => idxOf(f, A.Mtr, IDXKEY));
const teAct = A.test.map(f => f.r1), trAct = A.train.map(f => f.r1);
const r = pearson(teIdx, teAct), rho = spearman(teIdx, teAct);
const seq = quintiles(teIdx, teAct), seqIn = quintiles(trIdx, trAct);
const mw = mannWhitney(seq[4], seq[0]);
const ratioOut = mean(seq[4]) / mean(seq[0]), ratioIn = mean(seqIn[4]) / mean(seqIn[0]);
console.log('\n=== 4. 组合冷门指数（只用 train 系数构建）在样本外的表现 ===');
console.log(`Pearson r=${r.toFixed(4)}  Spearman ρ=${rho.toFixed(4)}  n=${A.test.length}（拟合从未看过检验窗口）`);
console.log('五分位（指数由冷→热）→ 一等奖注数/亿元:');
seq.forEach((s, i) => console.log(`  Q${i + 1}  中位 ${fx(median(s), 2).padStart(6)}  均值 ${fx(mean(s), 2).padStart(6)}  n=${s.length}`));
console.log(`最热 Q5 / 最冷 Q1: 样本外 ${fx(ratioOut)}  样本内 ${fx(ratioIn)}  （收缩幅度 ${fx((1 - ratioOut / ratioIn) * 100, 1)}%）  Mann-Whitney p=${mw.p.toExponential(2)}`);

/* ---------------- 7. keep / dropped ---------------- */
const keep = [], dropped = [];
for (const k of KEY) {
  const out = A.Mte[k], inS = A.Mtr[k];
  if (NOISE.includes(k)) continue;                                        // 只作噪声安慰剂
  if (!Number.isFinite(out.m) || !Number.isFinite(inS.m)) { dropped.push({ feature: k, reason: '样本量不足，无法估计' }); continue; }
  const signOK = Math.sign(inS.m - 1) === Math.sign(out.m - 1) && Math.abs(out.m - 1) > 0;
  const ciOut = [Math.exp(Math.log(out.m) - 1.96 * out.se), Math.exp(Math.log(out.m) + 1.96 * out.se)];
  const sig = ciOut[0] > 1 || ciOut[1] < 1;
  const pf = placebo[3][k]; // 四等奖（三时代均恒定的固定档）
  const ciP = [Math.exp(Math.log(pf.m) - 1.96 * pf.se), Math.exp(Math.log(pf.m) + 1.96 * pf.se)];
  const cleanP = ciP[0] <= 1 && ciP[1] >= 1 && Math.abs(pf.m - 1) <= 0.05;
  const cq = conditional[k];
  const specOK = cq && Number.isFinite(cq.m) && (cq.ci[0] > 1 || cq.ci[1] < 1) && Math.sign(cq.m - 1) === Math.sign(inS.m - 1);
  if (!signOK) dropped.push({ feature: k, reason: `样本外反号 (in ${fx(inS.m)} vs out ${fx(out.m)})` });
  else if (!sig) dropped.push({ feature: k, reason: `样本外与 1 无差异 (out ${fx(out.m)}, 95%CI [${fx(ciOut[0])}, ${fx(ciOut[1])}])` });
  else if (!cleanP) dropped.push({ feature: k, reason: `固定奖金档同样检出效应 → 混淆非人气 (四等奖 ${fx(pf.m)}, 95%CI [${fx(ciP[0])}, ${fx(ciP[1])}])` });
  else if (!specOK) dropped.push({ feature: k, reason: `控制固定档中奖密度后一等奖偏效应消失 (偏效应 ${fx(cq && cq.m)}, CI [${fx(cq && cq.ci[0])}, ${fx(cq && cq.ci[1])}])` });
  else keep.push(k);
}
console.log('\n=== 5. keep / dropped ===');
console.log('keep:', keep.join(', ') || '(无)');
dropped.forEach(d => console.log('  dropped:', d.feature, '—', d.reason));
// keep-only 指数
let keepStats = null;
if (keep.length) {
  const kk = keep.slice();
  const ki_tr = A.train.map(f => idxOf(f, A.Mtr, kk)), ki_te = A.test.map(f => idxOf(f, A.Mtr, kk));
  const qs = quintiles(ki_te, teAct);
  keepStats = { r: pearson(ki_te, teAct), rho: spearman(ki_te, teAct), ratio: mean(qs[qs.length - 1]) / mean(qs[0]), mw: mannWhitney(qs[qs.length - 1], qs[0]).p };
  console.log(`keep-only 指数样本外: r=${fx(keepStats.r, 4)} ρ=${fx(keepStats.rho, 4)} 热/冷=${fx(keepStats.ratio)} MW p=${keepStats.mw.toExponential(2)}`);
}
/* ---------------- 8. 真·噪声安慰剂（开球顺序，与集合无关，必须 =1.00） ---------------- */
const noise = {};
for (const k of NOISE) {
  const o = A.Mte[k], p3 = placebo[3][k];
  const ci = Number.isFinite(o.se) ? [Math.exp(Math.log(o.m) - 1.96 * o.se), Math.exp(Math.log(o.m) + 1.96 * o.se)] : [NaN, NaN];
  noise[k] = { onTier1: o.m, ci95: ci, onTier4: p3.m, n1: o.n1, n0: o.n0 };
  console.log(`噪声安慰剂 ${pad(k, 12)}: 一等奖 ${fx(o.m)} CI[${fx(ci[0])},${fx(ci[1])}]  四等奖 ${fx(p3.m)}  （纯开球顺序 → 必须≈1，否则估计量本身有偏）${(ci[0] <= 1 && ci[1] >= 1) ? ' ✓' : ' ✗ 有偏!'}`);
}
/* ---------------- 9. 钱的后果 ---------------- */
const q1 = A.test.map((f, i) => [teIdx[i], f]).sort((a, b) => a[0] - b[0]);
const per = Math.floor(q1.length / 5);
const cold = q1.slice(0, per).map(x => x[1]), hot = q1.slice(-per).map(x => x[1]);
const money = {
  coldMeanWinnersPerYi: mean(cold.map(f => f.r1)), hotMeanWinnersPerYi: mean(hot.map(f => f.r1)),
  coldMeanPrize: mean(cold.filter(f => f.n1 > 0).map(f => f.m1)), hotMeanPrize: mean(hot.filter(f => f.n1 > 0).map(f => f.m1)),
  coldZeroRate: cold.filter(f => f.n1 === 0).length / cold.length, hotZeroRate: hot.filter(f => f.n1 === 0).length / hot.length,
  coldMeanM1All: mean(cold.map(f => f.m1)), hotMeanM1All: mean(hot.map(f => f.m1)),
};
console.log('\n=== 6. 钱的后果（样本外五分位，冷=组合最不像"人人都在买"）===');
console.log(`最冷 Q1: 一等奖 ${fx(money.coldMeanWinnersPerYi, 2)} 注/亿元  零注率 ${(money.coldZeroRate * 100).toFixed(1)}%  单注均奖 ${(money.coldMeanPrize / 1e4).toFixed(1)} 万`);
console.log(`最热 Q5: 一等奖 ${fx(money.hotMeanWinnersPerYi, 2)} 注/亿元  零注率 ${(money.hotZeroRate * 100).toFixed(1)}%  单注均奖 ${(money.hotMeanPrize / 1e4).toFixed(1)} 万`);
console.log(`→ 中大奖时独享金额提升约 ${(money.coldMeanPrize / money.hotMeanPrize).toFixed(2)}×（中奖概率不变）`);
/* ---------------- 10. 时代对比（2015 前作诊断） ---------------- */
const B = runEra(PRE, 'pre2015');
console.log('\n=== 7. 时代对比（2015 前子集为诊断，非行为证据）===');
console.log(pad('特征', 16) + pad('2015+ in', 11) + pad('2015+ out', 11) + pad('2015前 in', 11) + pad('2015前 out', 11) + '跨时代同号');
const eraCmp = {};
for (const k of KEY) {
  const p = B.Mtr[k], q = B.Mte[k];
  const same = Math.sign(A.Mtr[k].m - 1) === Math.sign(p.m - 1) && Math.sign(A.Mte[k].m - 1) === Math.sign(q.m - 1);
  eraCmp[k] = { post2015: { in: A.Mtr[k].m, out: A.Mte[k].m }, pre2015: { in: p.m, out: q.m }, agree: same };
  console.log(pad(k, 16) + pad(fx(A.Mtr[k].m), 11) + pad(fx(A.Mte[k].m), 11) + pad(fx(p.m), 11) + pad(fx(q.m), 11) + (same ? '是' : '✗ 否'));
}
const nAgree = KEY.filter(k => eraCmp[k].agree).length;
console.log(`跨时代同号 ${nAgree}/${KEY.length}；姊妹套件报告 2015 前是回填/采集缺陷（分半相关 r=-0.26，本处 2015 前 chi2=${chi2Front(PRE).x.toFixed(1)} p=${fp(chi2Front(PRE).p)}），故 2015 前不一致处按数据污染解释，不作为行为证据。`);
/* ---------------- 11. 落盘 ---------------- */
const coef = {}; keep.forEach(k => coef[k] = +A.Mtr[k].m.toFixed(4));
const payload = {
  meta: {
    game: '大乐透', source: 'http://data.17500.cn/dlt_asc.txt', generated: new Date().toISOString(),
    target: 'log1p(一等奖注数 / (销量/亿元))', meaning: '>1 = 该特征组合被超买，中奖后与人分享更多；不改变中奖概率',
    dataWindow: '2015-01-03 → ' + POST[POST.length - 1].date + '（2015 前因回填缺陷排除）',
    fixedTierRowDropped: defect.map(r => r.code),
    caveat_tier3_era1: '2015-01~2019-02 期间三等奖为浮动奖，该段的固定档安慰剂使用四等奖/五等奖（三时代均恒定）',
    placeboLimitation: "大乐透没有任何一档奖金只依赖后区（三等奖=前区5中+后区0中，仍含前区），故固定奖级安慰剂对前区特征天然偏严：前区组合被超买时其邻域(4中5)也会推高低奖级注数。本报告按预注册规则执行（未通过即不发布），并在 stats.perFeature.tier1Specific 给出控制固定档密度后的一等奖特异偏效应。",
  },
  coefficients: coef,
  candidateCoefficients: Object.fromEntries(condKeep.map(k => [k, +A.Mtr[k].m.toFixed(4)])),
  candidateNote: 'candidateCoefficients 只通过「一等奖特异性(OLS 控制固定档密度)」这一条，未通过预注册的固定奖级安慰剂 → 不作正式发布，仅供进一步观察',
  keep,
  dropped,
  verdict: {
    compositeReplicatedOOS: mw.p < 0.05 && ratioOut > 1.05,
    singleFeatureReplicatedOOS: KEY.filter(k => !NOISE.includes(k) && Number.isFinite(A.Mte[k].m) && Math.sign(A.Mtr[k].m - 1) === Math.sign(A.Mte[k].m - 1) && (Math.exp(Math.log(A.Mte[k].m) - 1.96 * A.Mte[k].se) > 1 || Math.exp(Math.log(A.Mte[k].m) + 1.96 * A.Mte[k].se) < 1)),
    fixedTierPlaceboPassedForAnyFeature: keep.length > 0,
    estimatorUnbiasedPerNoisePlacebo: NOISE.every(k => noise[k] && Number.isFinite(noise[k].onTier1) && noise[k].ci95[0] <= 1 && noise[k].ci95[1] >= 1),
    publishableUnderPreregisteredGate: keep.length > 0,
  },
  stats: {
    nTrain: A.train.length, nTest: A.test.length,
    trainWindow: [A.train[0].date, A.train[A.train.length - 1].date],
    testWindow: [A.test[0].date, A.test[A.test.length - 1].date],
    composite: { indexKeys: IDXKEY, pearsonOut: +r.toFixed(4), spearmanOut: +rho.toFixed(4), hotColdRatioOut: +ratioOut.toFixed(4), hotColdRatioIn: +ratioIn.toFixed(4), mannWhitneyP: +mw.p.toExponential(3) },
    keepOnly: keepStats ? { r: +keepStats.r.toFixed(4), rho: +keepStats.rho.toFixed(4), ratio: +keepStats.ratio.toFixed(4), p: +keepStats.mw.toExponential(3) } : null,
    perFeature: Object.fromEntries(KEY.map(k => { const o = A.Mte[k], c = [Math.exp(Math.log(o.m) - 1.96 * o.se), Math.exp(Math.log(o.m) + 1.96 * o.se)]; const cq = conditional[k] && conditional[k].ci; return [k, { inSample: +A.Mtr[k].m.toFixed(4), outSample: +o.m.toFixed(4), ci95: [+c[0].toFixed(4), +c[1].toFixed(4)], n1: o.n1, n0: o.n0, placeboTier4: +placebo[3][k].m.toFixed(4), placeboTier3: +placebo[2][k].m.toFixed(4), placeboTier5: +placebo[4][k].m.toFixed(4), tier1Specific: conditional[k] && Number.isFinite(conditional[k].m) ? +conditional[k].m.toFixed(4) : null, tier1SpecificCI: cq ? [+cq[0].toFixed(4), +cq[1].toFixed(4)] : null }]; })),
    backRankTrainOnly: A.rank, hotBalls: A.HOT, coldBalls: A.COLD, frontSumThreshold: A.thr,
    noisePlacebo: noise,
    money: Object.fromEntries(Object.entries(money).map(([k, v]) => [k, +v.toFixed(4)])),
    quintilesOut: seq.map(s => +median(s).toFixed(3)),
  },
  uniformity: { all: chi2Front(recs), post2015: chi2Front(POST), pre2015: chi2Front(PRE), splitHalf: Object.fromEntries(Object.entries(halves).map(([k, v]) => [k, +v.toFixed(3)])) },
  eraComparison: eraCmp, eraAgreement: nAgree + '/' + KEY.length,
  nTrain: A.train.length, nTest: A.test.length,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log('\n写出', OUT);
