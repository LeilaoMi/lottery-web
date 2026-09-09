// 随机性审计内核：统计量、蒙特卡洛工具、数据加载与新鲜度闸门。
// 零依赖：只用 node 内置模块（仓库没有 node_modules，也必须保持没有）。
// 每个 p 值函数都对着教科书已知值做过校验，见同目录 stats.test.mjs（node --test）。
//
// ============================ 血泪教训（改代码前必读）============================
// 1. 逐号频次 χ² 的零分布【不是】df=32 的卡方。
//    一期开出的 6 个红球互不相同 ⇒ 33 个格子之间负相关 ⇒ E[χ²] = 33 × (1 - 6/33) = 27。
//    用解析的 df=32 会把真实的 p=0.021 粉饰成 p=0.069。
//    → 零分布一律用蒙特卡洛构造（同一个 statsOf、同样的不放回抽样），解析值只打印出来当反面教材。
// 2. 模拟数据与真实数据必须共用同一个统计函数（任何"两份实现"的分叉都会造出假的显著）。
//    模拟里 red 数组要为跨度/连号统计【排序】，但位置检验必须另外保存【原始开奖顺序】。
//    早期草稿把两者混为一谈，结果冒出一个假的"第 3 位显著"。见 statsOf 的 red/ord 双轨。
// 3. 投注侧探针靠安慰剂识别（一等地=6红+1蓝，二等地=6红无蓝，六等地=只看蓝）：
//    红球特征必须在含红奖级有效、在纯蓝的六等地为 NULL；蓝球特征必须在含蓝奖级有效、在纯红的二等地为 NULL。
//    安慰剂显著 = 实现里有混淆 = 整套结果不可信 → analyze.mjs 会大声失败（exit 1），不会静默放行。
// 4. 中奖注数必须按销量归一化（每亿元），并做年代/开奖日分层复现，否则"效应"可能只是销量波动的影子。
// 5. 不许报"挑出来的最小 p"。诚实的统计量是相关均匀性族上的族内 max|z| 联合校正。
//    33 个号 × 6 个年代 = 198 个格子 ⇒ 任何"冷热号定位"都是事后挑选。
// 6. 整套必须确定性：固定种子 + 自己打印验收检查（观测值逐位复现、ω=1 精确超几何），
//    好让后来的人能区分"跑挂了"和"真的是零结果"。
// ==============================================================================

import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// 显示用相对路径：Windows 上 join 给出反斜杠，不能用 replace(/.../) 硬切
export const rel = p => (p.startsWith(ROOT + "/") || p.startsWith(ROOT + "\\")) ? p.slice(ROOT.length + 1).replace(/\\/g, "/") : p;
export const DATA_FILE = join(ROOT, "scripts", "randomness", "data", "ssq.json");
export const REPORT_FILE = join(ROOT, "docs", "randomness-latest.md");
export const SOURCE_FILE = "http://data.17500.cn/ssq_asc.txt";
export const CWL_INDEX = "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/";
export const CWL_API =
  "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30&pageNo=1&pageSize=30&systemType=PC";
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---------------------------------------------------------------- 分布与检验
const lg = x => { // log Gamma（Lanczos）
  const c = [76.18009172947146, -86.50532032941677, 24.0144412145769, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
};
function gser(a, x) { let ap = a, sum = 1 / a, del = sum; for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; } return sum * Math.exp(-x + a * Math.log(x) - lg(a)); }
function gcf(a, x) { const FPMIN = 1e-300; let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d; for (let i = 1; i <= 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN; c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break; } return Math.exp(-x + a * Math.log(x) - lg(a)) * h; }
const gammp = (a, x) => (x < a + 1 ? gser(a, x) : 1 - gcf(a, x));      // 下不完全正则化
export const chi2Upper = (x, df) => 1 - gammp(df / 2, x / 2);           // 上尾 p（仅用于对照，见教训 1）
function erf(x) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
export const ncdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
export const twoSidedZ = z => Math.min(1, 2 * (1 - ncdf(Math.abs(z))));
// 双侧正态近似（连续性校正）；小样本返 null
export function binomP(k, n, p0) {
  if (n < 20 || p0 <= 0 || p0 >= 1) return null;
  const mu = n * p0, sd = Math.sqrt(n * p0 * (1 - p0));
  return Math.min(1, 2 * (1 - ncdf((Math.abs(k - mu) - 0.5) / sd)));
}
export function mannWhitney(a, b) { // 大样本正态近似双侧（带并列校正的秩）
  const na = a.length, nb = b.length, all = a.map(x => [x, 0]).concat(b.map(x => [x, 1]));
  all.sort((x, y) => x[0] - y[0]);
  const R = new Array(all.length); let i = 0;
  while (i < all.length) { let j = i; while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) R[k] = r; i = j + 1; }
  let U = 0; for (let k = 0; k < all.length; k++) if (all[k][1] === 0) U += R[k];
  U -= na * (na + 1) / 2;
  const mu = na * nb / 2, sd = Math.sqrt(na * nb * (na + nb + 1) / 12);
  const z = (U - mu) / sd;
  return { U, z, p: Math.min(1, 2 * (1 - ncdf(Math.abs(z)))) };
}
export function pearson(x, y) { const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; } return sxy / Math.sqrt(sxx * syy); }
export function spearman(x, y) { const rk = a => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); idx.forEach(([v, i], pos) => r[i] = pos + 1); return r; }; return pearson(rk(x), rk(y)); }

// ---------------------------------------------------------------- 确定性随机数
export function rng(seed) { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ t >>> 15, 1 | t); r = (r + Math.imul(r ^ r >>> 7, 61 | r)) ^ r; return ((r ^ r >>> 14) >>> 0) / 4294967296; }; }
// 部分 Fisher-Yates：从 pool 里不放回取 k 个不重复号（与真实摇号同构，见教训 2）
export function drawK(rand, pool, k) { const a = pool.slice(); for (let i = 0; i < k; i++) { const j = i + Math.floor(rand() * (a.length - i)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a.slice(0, k); }

// ---------------------------------------------------------------- 组合与超几何
export function comb(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - i + 1) / i; return Math.round(r); }
export const pHyper = (N, K, n, h) => comb(n, h) * comb(N - n, K - h) / comb(N, K);
// 非中心超几何（球不等权 ω，仍是不放回）。验收：ω=1 必须逐位等于 pHyper（见教训 6）。
export function pNCHG(N, K, n, w) {
  let zs = 0; const raw = [];
  for (let h = Math.max(0, K - (N - n)); h <= Math.min(n, K); h++) { const t = comb(n, h) * comb(N - n, K - h) * Math.pow(w, h); raw[h] = t; zs += t; }
  const out = []; for (let h = 0; h <= n; h++) out[h] = (raw[h] || 0) / zs;
  out._expect = out.reduce((a, p, h) => a + p * h, 0);
  return out;
}

// ---------------------------------------------------------------- 纯日历星期
// Sakamoto：不依赖时区、不依赖 Date 解析。t2 草稿用 getUTCDay 套 Asia/Shanghai 的日期，
// 星期标签整体错了一位（把周四的层标成了周三）——别再碰 Date。
export function dow(y, m, d) { const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]; if (m < 3) y -= 1; return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[m - 1] + d) % 7; }
export const WK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const drawDow = dateStr => { const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number); return dow(y, m, d); };

// ---------------------------------------------------------------- 统计量族（真实与模拟共用！）
// 返回字段固定；顺序无关，但【任何改动都会平移蒙特卡洛 p 值】，所以只能加字段不能改已有定义。
export const STAT_NAMES = ["chi2R", "chi2B", "maxz", "minz", "ovMean", "ovChi2", "bSameRate", "ac",
  "gapMean", "gapMax", "sumMean", "spanMean", "consecRate", "same10Rate", "oddMean", "chi2Z", "chi2Pos"];
// 族内（均匀性/形态）成员，用于族内 max|z| 联合校正（教训 5）
export const FAMILY = ["chi2R", "sumMean", "oddMean", "chi2Z", "maxz", "minz", "spanMean"];
const RED33 = Array.from({ length: 33 }, (_, i) => i + 1);
const OVER_P = [0, 1, 2, 3, 4, 5, 6].map(k => comb(6, k) * comb(27, 6 - k) / comb(33, 6)); // 精确超几何：与上期重合 k 个

export function statsOf(red, blue, ord) {
  const n = red.length, cntR = new Array(34).fill(0), cntB = new Array(17).fill(0);
  const mem = new Array(n);
  for (let i = 0; i < n; i++) { const u = new Uint8Array(34); for (const x of red[i]) { u[x] = 1; cntR[x]++; } mem[i] = u; cntB[blue[i]]++; }
  const expR = n * 6 / 33, expB = n / 16;
  let chi2R = 0, chi2B = 0, maxz = 0, minz = 1e9;
  for (let x = 1; x <= 33; x++) { chi2R += (cntR[x] - expR) ** 2 / expR; const z = (cntR[x] - expR) / Math.sqrt(expR * (1 - 6 / 33)); if (z > maxz) maxz = z; if (z < minz) minz = z; }
  for (let x = 1; x <= 16; x++) chi2B += (cntB[x] - expB) ** 2 / expB;
  let ovSum = 0; const ovDist = new Array(7).fill(0);
  for (let i = 1; i < n; i++) { let c = 0; for (const x of red[i]) if (mem[i - 1][x]) c++; ovSum += c; ovDist[c]++; }
  const ovMean = ovSum / (n - 1);
  let bSame = 0; for (let i = 1; i < n; i++) if (blue[i] === blue[i - 1]) bSame++;
  let ac = 0; // 单号 lag-1 自相关（33 个号交叉积的平均）
  for (let x = 1; x <= 33; x++) {
    let s1 = 0, s2 = 0, s12 = 0;
    for (let i = 1; i < n; i++) { const a = mem[i - 1][x], b = mem[i][x]; s1 += a; s2 += b; s12 += a * b; }
    const p = (s1 + s2) / (2 * (n - 1)); ac += (s12 / (n - 1) - p * p);
  }
  ac /= 33;
  let gSum = 0, gMax = 0, gN = 0; // 红球遗漏
  for (let x = 1; x <= 33; x++) { let last = -1; for (let i = 0; i < n; i++) if (mem[i][x]) { if (last >= 0) { const g = i - last; gSum += g; gN++; if (g > gMax) gMax = g; } last = i; } }
  let sumMean = 0, spanMean = 0, consec = 0, same10 = 0, oddMean = 0; // 形态（span/consec 用已排序的 red）
  const zCnt = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const r = red[i]; sumMean += r.reduce((a, b) => a + b, 0); spanMean += r[5] - r[0];
    if (r.some((x, k) => k && x - r[k - 1] === 1)) consec++;
    const tail = new Array(10).fill(0); let odd = 0;
    for (const x of r) { tail[x % 10]++; if (x % 2) odd++; }
    for (const t of tail) if (t >= 2) same10 += t - 1;
    oddMean += odd;
    for (const x of r) zCnt[x <= 11 ? 0 : x <= 22 ? 1 : 2]++;
  }
  let chi2Z = 0; const expZ = n * 6 / 3; for (const c of zCnt) chi2Z += (c - expZ) ** 2 / expZ;
  // 开奖顺序位置检验（球机/球序物理效应最可能留痕处）：用 ord（原始顺序），不是排序后的 red
  let chi2Pos = 0;
  for (let p = 0; p < 6; p++) { const c = new Array(34).fill(0); for (let i = 0; i < n; i++) c[ord[i][p]]++; for (let x = 1; x <= 33; x++) chi2Pos += (c[x] - n / 33) ** 2 / (n / 33); }
  let ovChi2 = 0; for (let k = 0; k <= 6; k++) { const e = OVER_P[k] * (n - 1); ovChi2 += (ovDist[k] - e) ** 2 / e; }
  return { chi2R, chi2B, maxz, minz: -minz, ovMean, ovChi2, bSameRate: bSame / (n - 1), ac,
    gapMean: gSum / gN, gapMax: gMax, sumMean: sumMean / n, spanMean: spanMean / n,
    consecRate: consec / n, same10Rate: same10 / n, oddMean: oddMean / n, chi2Z, chi2Pos };
}

// 一次蒙特卡洛：跑 sims 条长度为 n 的 iid 均匀序列，返回每条的统计量。
// 注意 rand 的消耗顺序 = 每期 drawK(6) 再 1 个蓝球 —— 改动会让 p 值平移（可复现性优先）。
export function simulate(n, sims, seed) {
  const rand = rng(seed), out = [];
  for (let s = 0; s < sims; s++) {
    const rd = [], bd = [], od = [];
    for (let i = 0; i < n; i++) { const six = drawK(rand, RED33, 6); rd.push(six.slice().sort((a, b) => a - b)); bd.push(1 + Math.floor(rand() * 16)); od.push(six); }
    out.push(statsOf(rd, bd, od));
  }
  return out;
}
export function nullSummary(arr) { const a = arr.slice().sort((x, y) => x - y); const mu = a.reduce((s, v) => s + v, 0) / a.length;
  return { mean: mu, sd: Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / (a.length - 1)), q025: a[Math.floor(a.length * 0.025)], q975: a[Math.floor(a.length * 0.975)] }; }
export function mcP(pool, observed) { // 双侧：两尾计数取大者 ×2，含"等于观测"的保守计数
  const ge = pool.filter(x => x >= observed).length, le = pool.filter(x => x <= observed).length, m = pool.length;
  return { p: Math.min(1, 2 * Math.min(ge, le) / m), oneSided: ge / m, ge, le, sims: m };
}
export const fmtP = p => (p === null || p === undefined ? "-" : p < 1e-9 ? "<1e-9" : p < 1e-4 ? p.toExponential(1) : p.toFixed(4));

// ---------------------------------------------------------------- 数据与新鲜度闸门
// 结构铁律（与 fetch-ssq 同源）：期号 7 位、红 6 个 01-33 无重复且升序、蓝 01-16、
// 开奖顺序是红球集合的一个排列。
export function validateRow(r) {
  if (!/^\d{7}$/.test(String(r.code))) return "期号格式";
  if (!Array.isArray(r.red) || r.red.length !== 6) return "红球个数";
  if (r.red.some(n => !(Number.isInteger(n) && n >= 1 && n <= 33))) return "红球越界";
  if (new Set(r.red).size !== 6) return "红球重复";
  if (String(r.red.join()) !== String([...r.red].sort((a, b) => a - b).join())) return "红球未排序";
  if (!(Number.isInteger(r.blue) && r.blue >= 1 && r.blue <= 16)) return "蓝球越界";
  if (!Array.isArray(r.order) || new Set(r.order).size !== 6) return "开奖顺序重复";
  if ([...r.order].sort((a, b) => a - b).join() !== r.red.join()) return "开奖顺序与集合不符";
  return null;
}

// 缺数据 / 过期都必须拒绝运行（不能静默通过），见 deliverable A 最后一条。
export function loadDraws({ maxAgeDays = 45 } = {}) {
  if (!existsSync(DATA_FILE)) {
    throw new Error(`数据文件不存在：${DATA_FILE}\n` +
      `  → 先跑：node scripts/randomness/fetch-ssq.mjs（零依赖，只要网络）\n` +
      `  审计拒绝在"没有数据"的情况下输出结论——那是最容易骗人的一种通过。`);
  }
  const rows = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  if (!Array.isArray(rows) || rows.length < 500) throw new Error(`数据文件不可用：只有 ${Array.isArray(rows) ? rows.length : 0} 条记录（${DATA_FILE}）`);
  const bad = [];
  rows.forEach((r, i) => { const v = validateRow(r); if (v && bad.length < 5) bad.push(`${r && r.code}: ${v}`); });
  if (bad.length) throw new Error(`数据文件结构校验失败（前 5 条）：${bad.join(" ; ")}\n  → 数据被改坏或源改版，重跑 fetch-ssq.mjs`);
  const lastDate = rows[rows.length - 1].date.slice(0, 10);
  const ageDays = Math.floor((Date.now() - Date.parse(lastDate + "T12:00:00Z")) / 86400000);
  if (ageDays > maxAgeDays && !process.env.RANDOMNESS_ALLOW_STALE) {
    throw new Error(`数据过期：最新一期 ${lastDate} 距今 ${ageDays} 天（阈值 ${maxAgeDays} 天）\n` +
      `  → 跑 node scripts/randomness/fetch-ssq.mjs 刷新；离线复现请显式 RANDOMNESS_ALLOW_STALE=1\n` +
      `  审计不会用陈旧数据给出"本期结论"。`);
  }
  return { rows, ageDays, mtime: statSync(DATA_FILE).mtime.toISOString().slice(0, 10), lastDate };
}
export const yearOf = r => +String(r.code).slice(0, 4);
