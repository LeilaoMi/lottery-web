// 多彩种随机性审计内核：把 lib.mjs（双色球专用）的教训一般化到 8 个彩种。
// 零依赖：只用 node 内置模块 + lib.mjs 的经过校验的原语。
//
// ============================ 从 lib.mjs 继承的血泪教训（一般化版）============================
// 【核心陷阱】逐号频次 χ² 的零分布【不是】 df = poolSize-1。
//   一期开出的 k 个号互不相同 ⇒ poolSize 个格子负相关 ⇒  E[χ²] = poolSize × (1 - k/poolSize)。
//   双色球红球 33×(1-6/33)=27（蒙特卡洛实测 26.91）；快乐8 20-of-80：80×(1-20/80)=60，绝不是 df=79。
//   → drawn>=2 的号码池一律蒙特卡洛造零分布；drawn==1（蓝球/特别号，逐期独立）与数字型每一位
//     （逐期独立均匀）解析 df=range-1 就是【对的】，不蒙特卡洛（别过度工程）。
//   解析 df=poolSize-1 的值只打印出来当反面教材。
// 【双轨】模拟/真实共用同一个统计函数；为 span/consec 保存【排序】数组，为位置检验另存【原始顺序】。
//   混淆二者会冒出一个假的"第 3 位显著"。
// ==============================================================================

import { rng, drawK, comb, pHyper, chi2Upper, nullSummary, mcP, fmtP } from "./lib.mjs";

export { nullSummary, mcP, fmtP, chi2Upper };

// ---------------------------------------------------------------- 彩种规格表（参数化，绝不硬编码 33/6/27）
// type=pool：groups 每项 {key,label,N(池大小=号码个数),k(每期开出个数),order(文件是否给开奖顺序)}
//   drawn k==1 的组（蓝球/七乐彩特别号）视作逐期独立，解析 df=N-1。
// type=digit：positions 每项 {key,label,R(该位取值个数)}，逐位逐期独立均匀 → 解析 df=R-1。
export const KINDS = {
  ssq: { name: "双色球", type: "pool", groups: [
    { key: "main", label: "红球", N: 33, k: 6, order: true },
    { key: "blue", label: "蓝球", N: 16, k: 1, order: false } ] },
  dlt: { name: "大乐透", type: "pool", groups: [
    { key: "front", label: "前区", N: 35, k: 5, order: true },
    { key: "back", label: "后区", N: 12, k: 2, order: true } ] },
  qlc: { name: "七乐彩", type: "pool", groups: [
    { key: "main", label: "基本号", N: 30, k: 7, order: false },
    { key: "special", label: "特别号", N: 30, k: 1, order: false } ] },
  kl8: { name: "快乐8", type: "pool", groups: [
    { key: "main", label: "开奖号", N: 80, k: 20, order: false } ] },
  fc3d: { name: "福彩3D", type: "digit", positions: [
    { key: "p0", label: "百位", R: 10 }, { key: "p1", label: "十位", R: 10 }, { key: "p2", label: "个位", R: 10 } ] },
  pl3: { name: "排列3", type: "digit", positions: [
    { key: "p0", label: "百位", R: 10 }, { key: "p1", label: "十位", R: 10 }, { key: "p2", label: "个位", R: 10 } ] },
  pl5: { name: "排列5", type: "digit", positions: [
    { key: "p0", label: "万位", R: 10 }, { key: "p1", label: "千位", R: 10 }, { key: "p2", label: "百位", R: 10 },
    { key: "p3", label: "十位", R: 10 }, { key: "p4", label: "个位", R: 10 } ] },
  qxc: { name: "七星彩", type: "digit", positions: [
    { key: "p0", label: "第1位", R: 10 }, { key: "p1", label: "第2位", R: 10 }, { key: "p2", label: "第3位", R: 10 },
    { key: "p3", label: "第4位", R: 10 }, { key: "p4", label: "第5位", R: 10 }, { key: "p5", label: "第6位", R: 10 },
    { key: "sp", label: "特别号", R: 15, nonuniform: true } ] },   // 七星彩第7位 0-14 但实测【非均匀】(0-9≈9%、10-14≈1.8%)：均匀性检验不适用，改按经验分布测独立性
};
export const KIND_ORDER = ["ssq", "dlt", "qlc", "kl8", "fc3d", "pl3", "pl5", "qxc"];

// 号码池 E[χ²]（不放回负相关），解析 df=poolSize-1 的对照值。
export const eChi2Pool = (N, k) => N * (1 - k / N);

// ---------------------------------------------------------------- 号码池单组统计（真实与模拟共用）
// vals: 每期 k 个【升序】号码（1..N）；ords: 每期【原始开奖顺序】或 null。返回固定字段。
export function groupStats(vals, ords) {
  const n = vals.length, N = 0, k = vals[0].length;
  const pool = new Set(); for (const v of vals) for (const x of v) pool.add(x);
  const lo = Math.min(...pool), hi = Math.max(...pool);
  // 以值域 1..maxVal 建格；用真实出现的最大值定 N，避免调用方传错池大小
  const Ncell = hi;
  const cnt = new Array(Ncell + 1).fill(0);
  const mem = new Array(n);
  for (let i = 0; i < n; i++) { const u = new Uint8Array(Ncell + 1); for (const x of vals[i]) { u[x] = 1; cnt[x]++; } mem[i] = u; }
  const expC = n * k / Ncell;
  let chi2 = 0, maxz = 0, minz = -1e9;
  const sdC = Math.sqrt(expC * (1 - k / Ncell));
  for (let x = lo; x <= hi; x++) {
    chi2 += (cnt[x] - expC) ** 2 / expC;
    const z = (cnt[x] - expC) / sdC; if (z > maxz) maxz = z; if (z < minz) minz = z;
  }
  // 与上期重合数：均值 + 分布 χ²（期望用精确超几何 N,k,k）
  let ovSum = 0; const ovDist = new Array(k + 1).fill(0);
  for (let i = 1; i < n; i++) { let c = 0; const s = new Set(vals[i - 1]); for (const x of vals[i]) if (s.has(x)) c++; ovSum += c; ovDist[c]++; }
  const hp = []; let hsum = 0; for (let h = 0; h <= k; h++) { hp[h] = pHyper(Ncell, k, k, h); hsum += hp[h]; } // 归一核对用
  let ovChi2 = 0; for (let h = 0; h <= k; h++) { const e = hp[h] * (n - 1); ovChi2 += (ovDist[h] - e) ** 2 / e; }
  const ovMean = ovSum / (n - 1);
  // 单号 lag-1 自相关（对出现过的号取平均）
  let ac = 0, ncell = 0;
  for (let x = lo; x <= hi; x++) {
    let s1 = 0, s2 = 0, s12 = 0;
    for (let i = 1; i < n; i++) { const a = mem[i - 1][x], b = mem[i][x]; s1 += a; s2 += b; s12 += a * b; }
    const p = (s1 + s2) / (2 * (n - 1)); ac += (s12 / (n - 1) - p * p); ncell++;
  }
  ac /= Math.max(1, ncell);
  // 遗漏（gap）均值/最大值
  let gSum = 0, gMax = 0, gN = 0;
  for (let x = lo; x <= hi; x++) { let last = -1; for (let i = 0; i < n; i++) if (mem[i][x]) { if (last >= 0) { const g = i - last; gSum += g; gN++; if (g > gMax) gMax = g; } last = i; } }
  // 形态：和值 / 跨度 / 奇数 / 连号（用已排序 vals）
  let sumMean = 0, spanMean = 0, oddMean = 0, consec = 0;
  for (let i = 0; i < n; i++) {
    const v = vals[i]; sumMean += v.reduce((a, b) => a + b, 0); spanMean += v[k - 1] - v[0];
    let odd = 0; for (const x of v) if (x % 2) odd++; oddMean += odd;
    if (v.some((x, j) => j && x - v[j - 1] === 1)) consec++;
  }
  // 位置 χ²：仅在提供原始顺序时（教训：用 ord，不用排序后的 vals）
  let chi2Pos = 0;
  if (ords) for (let p = 0; p < k; p++) { const c = new Array(Ncell + 1).fill(0); for (let i = 0; i < n; i++) c[ords[i][p]]++; for (let x = lo; x <= hi; x++) chi2Pos += (c[x] - n / Ncell) ** 2 / (n / Ncell); }
  return { chi2, maxz, minz, ovMean, ovChi2, ac, gapMean: gN ? gSum / gN : 0, gapMax: gMax,
    sumMean: sumMean / n, spanMean: spanMean / n, oddMean: oddMean / n, consecRate: consec / n, chi2Pos,
    _Ncell: Ncell, _k: k };
}

// 蒙特卡洛一个号码池组（同 drawK 不放回，与真实摇号同构）
export function simulateGroup(N, k, n, sims, seed, withOrder) {
  const rand = rng(seed), base = Array.from({ length: N }, (_, i) => i + 1), out = [];
  for (let s = 0; s < sims; s++) {
    const vs = [], os = [];
    for (let i = 0; i < n; i++) { const d = drawK(rand, base, k); vs.push(d.slice().sort((a, b) => a - b)); if (withOrder) os.push(d); }
    out.push(groupStats(vs, withOrder ? os : null));
  }
  return out;
}

// ---------------------------------------------------------------- 数字型逐位统计
// digs: 每期该位一个整数（0..R-1）。逐位逐期独立 ⇒ 解析 df=R-1 就是对的（不过度工程、不蒙特卡洛）。
export function digitStats(digs) {
  const n = digs.length, R = Math.max(...digs) + 1 > 0 ? Math.max(10, Math.max(...digs) + 1) : 10;
  const cnt = new Array(R).fill(0); for (const d of digs) cnt[d]++;
  const expC = n / R; let chi2 = 0;
  for (let x = 0; x < R; x++) chi2 += (cnt[x] - expC) ** 2 / expC;
  // 与上期同位相同的比率（独立 ⇒ 期望 1/R，逐期二元）
  let same = 0; for (let i = 1; i < n; i++) if (digs[i] === digs[i - 1]) same++;
  const sameRate = same / (n - 1);
  // lag-1 自相关（0/1 指示序列的交叉积均值；独立 ⇒ 期望≈0）
  let s1 = 0, s2 = 0, s12 = 0; for (let i = 1; i < n; i++) { const a = digs[i - 1], b = digs[i]; s12 += a * b; s1 += a; s2 += b; }
  const mean = (s1 + s2) / (2 * (n - 1)), e2 = (s1 + s2) / (2 * (n - 1));
  const acNum = s12 / (n - 1) - mean * mean;
  return { chi2, df: R - 1, R, sameRate, expSame: 1 / R, ac: acNum, n };
}

// ---------------------------------------------------------------- 功效 / 最小可检相对偏倚
// 单个格子的二项检验：真实偏差 |p-p0|≥delta 时，80% 功效、双侧 α 的最小可检 delta。
// n = (z_{α/2}+z_β)^2 · p(1-p) / δ^2  →  δ = (z+z')·sqrt(p(1-p)/n)。
export function detectability(p0, n, alpha = 0.05, power = 0.8) {
  const za = alpha === 0.05 ? 1.959964 : alpha === 0.01 ? 2.575829 : qnorm(1 - alpha / 2);
  const zb = power === 0.8 ? 0.8416212 : power === 0.9 ? 1.281552 : qnorm(power);
  const delta = (za + zb) * Math.sqrt(p0 * (1 - p0) / n);
  const rel = delta / p0;
  // 反过来：要检出 relBias 的相对偏差需要多少期
  return { delta, relBias: rel, za, zb };
}
export const nForRelBias = (p0, relBias, alpha = 0.05, power = 0.8) => {
  const za = alpha === 0.05 ? 1.959964 : alpha === 0.01 ? 2.575829 : qnorm(1 - alpha / 2);
  const zb = power === 0.8 ? 0.8416212 : power === 0.9 ? 1.281552 : qnorm(power);
  return Math.ceil((za + zb) ** 2 * (1 - p0) / (p0 * relBias * relBias));
};
function qnorm(p) { // 逆正态（Acklam 近似），仅非常规 α/power 用到
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155429958e1];
  const c = [-7.784894002430293e-3, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// split-half 频次相关（真实 + 蒙特卡洛零分布），对号码池组与数字位通用。
// freq: 每期一个数组（号码集合或逐位数字）；cells: 该统计下每期的格计数函数
export function splitHalfFreq(draws) { // draws: 每期 = 一个号数组（池）或长度 positions 的数字数组
  const n = draws.length, h1 = draws.slice(0, n >> 1), h2 = draws.slice(n >> 1);
  const val = sub => { const c = new Map(); for (const d of sub) for (const x of d) c.set(x, (c.get(x) || 0) + 1); return c; };
  const a = val(h1), b = val(h2), keys = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
  return { r: pearsonSimple(keys.map(k => a.get(k) || 0), keys.map(k => b.get(k) || 0)), n1: h1.length, n2: h2.length, keys: keys.length };
}
function pearsonSimple(x, y) { const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; } return sxy / Math.sqrt(sxx * syy); }
