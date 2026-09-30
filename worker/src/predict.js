// 统一预测引擎：8 个彩种共用同一套「分析 / 杀号 / 定胆 / 推荐」实现，避免各彩种逻辑各写一套而互相打架。
// 纯函数、无网络依赖，便于单测。所有输出统一为：
//   { kind, name, type, window, count, analysis, kill, dan, picks, disclaimer }
import { pad2 } from "./small.js";

export const SPECS = {
  ssq: { name: "双色球", type: "pool", main: { min: 1, max: 33, pick: 6, label: "红球" }, aux: { min: 1, max: 16, pick: 1, label: "蓝球" }, suggest: 6, fMain: "red", fAux: "blue" },
  dlt: { name: "大乐透", type: "pool", main: { min: 1, max: 35, pick: 5, label: "前区" }, aux: { min: 1, max: 12, pick: 2, label: "后区" }, suggest: 5, fMain: "front", fAux: "back" },
  qlc: { name: "七乐彩", type: "pool", main: { min: 1, max: 30, pick: 7, label: "基本号" }, aux: { min: 1, max: 30, pick: 1, label: "特别号" }, suggest: 7, fMain: "main", fAux: "special" },
  kl8: { name: "快乐8", type: "pool", main: { min: 1, max: 80, pick: 20, label: "号码" }, aux: null, suggest: 10, fMain: "nums", fAux: null },
  fc3d: { name: "福彩3D", type: "digit", digits: 3, suggest: 3, fMain: "digits" },
  pl3: { name: "排列3", type: "digit", digits: 3, suggest: 3, fMain: "digits" },
  pl5: { name: "排列5", type: "digit", digits: 5, suggest: 5, fMain: "digits" },
  qxc: { name: "七星彩", type: "digit", digits: 7, suggest: 7, fMain: "digits" }
};

const PRIMES = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79]);
const DISCLAIMER = "随机游戏，统计仅供娱乐，不保证中奖";
export { DISCLAIMER };

// 推荐的最小样本：少于这个期数时，"高频号 / 最冷号 / 均值回归 / 胆码" 全是并列后按号池顺序取第一个，
// 实际等价于"取号池里最小的几个号"，却被标成"近 30 期高频号"——比不给更糟。
// 与 backtest(569)/calibrate(622)/thresholdTune(763) 的"样本不足"门槛同风格，宁缺毋假。
const MIN_DRAWS = 5;
const insufficientNote = n =>
  `样本不足（近 ${n} 期，最少 ${MIN_DRAWS} 期）：数据太少时高频/最冷/胆码会退化成"并列取最小号"，故不给参考号码`;
// 给「会产出号」的端点用：样本不足时返回 null，调用方据此短路。
// 门槛只覆盖会凭空造号的能力（推荐/杀号/胆码/胆拖单）；analyze/trend 是纯描述统计，
// 标着「近 N 期」给 3 期的统计不构成造假，所以不设门槛。
export function sampleGate(draws) {
  const n = Array.isArray(draws) ? draws.length : 0; // 库里实际有几期（门槛只看「够不够」，不截断）
  return n < MIN_DRAWS ? { insufficient: true, count: n, note: insufficientNote(n) } : null;
}

export function specOf(kind) {
  const s = SPECS[kind];
  if (!s) throw new Error("unknown kind " + kind);
  return s;
}
// 号码池 / 三区划分都是 SPEC 的纯函数，却被 killList 等每次调用都重算一遍
// （periods=60 的回测里 killList 被调 60 次，zonesOf 一项就占 0.3~0.9ms）。按 min-max 记忆化。
// 缓存返回的是共享数组：调用方只读不改，SPEC 也不可变，因此安全。
const _poolMemo = new Map(), _zoneMemo = new Map();
export function poolOf(zone) {
  const k = zone.min + ":" + zone.max;
  let o = _poolMemo.get(k);
  if (!o) { o = []; for (let i = zone.min; i <= zone.max; i++) o.push(pad2(i)); _poolMemo.set(k, o); }
  return o;
}

// 数字型逐位号池：3D/排列3/排列5 每位 0-9；七星彩第 1-6 位 0-9，第 7 位是独立号池 0-14
// （10-14 各约 1.8%，合计约 9% 的实际开奖）。原先各处硬编码 10 格的后果：七星彩第 7 位的
// 频次/遗漏少算那 9%、杀号永远杀不到 10-14（错杀率被系统性抬高）、胆码与「最热/最冷」永远取不到
// 10-14（命中率被压低）、随机基准也只在 0-9 里抽——复盘与回测的基线跟着一起错。
// scripts/randomness/lib-kinds.mjs 早已按 R:15 + nonuniform 建模，这里补齐 Worker 侧口径。
export function posPool(kind, p) {
  const last = kind === "qxc" && p === 6 ? 14 : 9;
  return Array.from({ length: last + 1 }, (_, i) => String(i));
}
// 该位的随机单号基线 = 1/号池大小。均匀抽样时该值与实际分布是否均匀无关
// （Σ P(抽中 d)·P(开 d) = (1/|pool|)·Σ P(开 d) = 1/|pool|），故七星彩第 7 位取 1/15。
export function posBaseline(kind, p) { return 1 / posPool(kind, p).length; }
// 数字型整注基线 = 各位基线等权平均（复盘/回测把所有位的命中与分母各自求和，等价于按位平均）。
export function digitBaseline(kind) {
  const n = specOf(kind).digits;
  let sum = 0;
  for (let p = 0; p < n; p++) sum += posBaseline(kind, p);
  return sum / n;
}

// 取一期的号码：统一成「字符串数组」，屏蔽各彩种字段差异
export function mainOf(d, kind) {
  if (!d) return []; // 上游缺期时静默返回空，避免 (null)[field] 崩掉整条预测链
  const s = specOf(kind);
  if (s.type === "digit") return (d[s.fMain] || []).map(x => String(x));
  const v = d[s.fMain];
  return (Array.isArray(v) ? v : v ? [v] : []).map(x => pad2(Number(String(x).trim())));
}
export function auxOf(d, kind) {
  if (!d) return [];
  const s = specOf(kind);
  if (!s.fAux) return [];
  const v = d[s.fAux];
  return (Array.isArray(v) ? v : v ? [v] : []).map(x => pad2(Number(String(x).trim())));
}

function uniqSorted(a) { return [...new Set(a)].sort(); }
// 先去重再 Fisher–Yates 抽样：sort(() => Math.random()-0.5) 是有偏洗牌（比较器随机时
// 各排列不等概），随机基准策略拿它当对照会失真；去重放最前，否则候选池带重复项时
// 「先切 n 个再去重」会不足 n 个
function pickN(arr, n) {
  const a = [...new Set(arr)];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n).sort();
}

export function acValue(nums) {
  const n = nums.map(Number), set = new Set();
  for (let i = 0; i < n.length; i++) for (let j = i + 1; j < n.length; j++) set.add(Math.abs(n[i] - n[j]));
  return set.size - (n.length - 1);
}

// ---------- 统计显著性：精确二项检验 p 值（双侧，较小尾 ×2） ----------
// 观察 hits/n 是否显著偏离基线 p0。n < 20 返回 null：样本不足不做显著性宣称。
// p < 0.05 视为「显著偏离」；对杀号而言方向是越低越好，p 只回答「是否偏离」，方向由调用方判断。
// 为什么不用正态近似：小样本 / 贴边界（k=0 或 k=n）时近似误差大，而复盘与回测的
// 杀错率经常落在这些区域——既然标榜统计诚实，内核就该处处精确（log 空间 logsumexp
// 求尾概率，避免大 n 下 (1-p0)^n 下溢；只朝尾部方向求和，偏离均值越远项数越少）。
function logFactTable(n) {
  const t = new Float64Array(n + 1);
  for (let i = 2; i <= n; i++) t[i] = t[i - 1] + Math.log(i);
  return t;
}
export function binomP(hits, n, p0) {
  if (!(n >= 20) || !(p0 > 0 && p0 < 1) || !(hits >= 0 && hits <= n)) return null;
  const k = Math.round(hits);
  const lp = Math.log(p0), lq = Math.log1p(-p0);
  const L = logFactTable(n); // L[i] = ln(i!)
  const logPmf = i => L[n] - L[i] - L[n - i] + i * lp + (n - i) * lq;
  // 双侧口径与原正态近似一致：取较小一侧尾概率 ×2 再夹到 [0,1]
  const lower = k <= n * p0;
  let max = -Infinity, sum = 0;
  if (lower) {
    for (let i = 0; i <= k; i++) {
      const t = logPmf(i);
      if (t > max) { sum = sum * Math.exp(max - t) + 1; max = t; } else sum += Math.exp(t - max);
    }
  } else {
    for (let i = n; i >= k; i--) {
      const t = logPmf(i);
      if (t > max) { sum = sum * Math.exp(max - t) + 1; max = t; } else sum += Math.exp(t - max);
    }
  }
  const tail = Math.exp(max + Math.log(sum));
  return +Math.min(1, 2 * tail).toFixed(4);
}

// 期号 → 年代桶：优先 date 字段取年份，退化用 code 前缀（7 位=2026103，5 位=26103）
function eraOf(d) {
  if (d && d.date && /^\d{4}/.test(String(d.date))) return String(d.date).slice(0, 4);
  const iss = d && d.code != null ? String(d.code) : (d && d.issue != null ? String(d.issue) : "");
  if (/^\d{7}/.test(iss)) return iss.slice(0, 4);
  if (/^\d{5}/.test(iss)) return "20" + iss.slice(0, 2);
  return "未知";
}

// 频率 + 遗漏（遗漏：当前未出现期数 / 历史平均间隔 / 历史最大间隔）
// 性能关键：cur 由 lastSeen O(1) 推导，不再逐期重扫（原实现 O(pool×draws) 次 getNums，
// 是 600 期回测的 CPU 大头；等价性：cur = 最新索引 - 最后出现索引，从未出现则为总期数）
export function freqStats(draws, pool, getNums) {
  const freq = {}, lastSeen = {}, gaps = {};
  for (const k of pool) { freq[k] = 0; lastSeen[k] = null; gaps[k] = []; }
  const asc = draws.slice().reverse(); // 由旧到新
  asc.forEach((d, i) => {
    for (const k of getNums(d)) {
      if (freq[k] === undefined) continue;
      freq[k]++;
      if (lastSeen[k] !== null) gaps[k].push(i - lastSeen[k] - 1);
      lastSeen[k] = i;
    }
  });
  const cur = {}, avg = {}, max = {}, L = asc.length;
  for (const k of pool) {
    const ls = lastSeen[k];
    cur[k] = ls !== null ? (L - 1 - ls) : L;
    const g = gaps[k];
    avg[k] = g.length ? +(g.reduce((a, b) => a + b, 0) / g.length).toFixed(2) : L;
    max[k] = g.length ? Math.max(...g) : L;
  }
  return { freq, cur, avg, max };
}

function zonesOf(zone) {
  const k = zone.min + ":" + zone.max;
  let memo = _zoneMemo.get(k);
  if (memo) return memo;
  const { min, max } = zone, span = max - min + 1, w = Math.ceil(span / 3);
  memo = [0, 1, 2].map(i => ({ i, from: min + i * w, to: Math.min(max, min + (i + 1) * w - 1) }));
  _zoneMemo.set(k, memo);
  return memo;
}
function zoneIdx(zones, v) { for (const z of zones) if (v >= z.from && v <= z.to) return z.i; return zones.length - 1; }

// ---------- 杀号：市面常见公式加权投票，票数越高越该杀 ----------
// 10 类公式带稳定 key：回测按 key 统计各自命中率（backtest.kill.formulas），
// calibrate() 据此生成动态权重，无效公式自动降权——这就是「校准杀号」。
export const FORMULAS = {
  last: "上期出号", neighbor: "邻号", sumtail: "和值尾", span: "跨度", extreme: "极号",
  hottail: "热尾", coldroad: "冷012路", prime: "质合偏态", hotzone: "热区", prev2: "上上期号"
};
export function killList(kind, draws, opts = {}) {
  const s = specOf(kind);
  if (s.type === "digit") return killDigits(kind, draws);
  // 按需分配：raw 只被 byFormula（仅回测要）消费，why/reasons 只被线上杀号页展示消费。
  // 原实现无条件建 raw[k]={} 与 why[k]=[] 并对每个号 push，回测每点调 60 次、每次白付这份钱
  // （实测 reasons 一项在 periods=60 时占 kl8 2.5ms / ssq 1.2ms）。输出按开关裁剪，逐字段等价。
  const wantRaw = !!opts.perFormula, wantReasons = opts.reasons !== false;
  const pool = poolOf(s.main), votes = {}, raw = {}, why = {};
  // 分公式名单在 add() 里顺手记（第一次给「某号×某公式」投票时入列），
  // 省掉事后 for(10 个公式) × pool.filter 的全池扫描：快乐8 号池 80，periods=60 时这一项最贵
  const fLists = {};
  for (const k of pool) { votes[k] = 0; if (wantRaw) raw[k] = {}; if (wantReasons) why[k] = []; }
  const w = opts.weights || {};
  const add = (k, v, key, label) => {
    if (votes[k] === undefined) return;
    if (wantRaw) {
      const r = raw[k];
      if (r[key] === undefined) (fLists[key] || (fLists[key] = [])).push(k);
      r[key] = (r[key] || 0) + v;          // 原始票：分公式统计用，不受权重影响
    }
    const wv = w[key] !== undefined ? w[key] : 1;
    votes[k] += v * wv;
    if (wantReasons && v * wv > 0) why[k].push(label);  // 权重为 0 的公式不算实际贡献，不进 reasons
  };
  const last = draws[0], prev = draws[1];
  if (!last) return { main: [], aux: [] };
  const N = mainOf(last, kind).map(Number).sort((a, b) => a - b);
  const sum = N.reduce((a, b) => a + b, 0), span = N[N.length - 1] - N[0];
  const zones = zonesOf(s.main);

  for (const x of N) add(pad2(x), 1, "last", "上期出号");                              // 1 上期号
  for (const x of N) { add(pad2(x + 1), 0.5, "neighbor", "邻号"); add(pad2(x - 1), 0.5, "neighbor", "邻号"); } // 2 邻号
  const tail = sum % 10;
  for (const k of pool) if (Number(k) % 10 === tail) add(k, 1, "sumtail", "和值尾" + tail);   // 3 和值尾
  for (const v of [span - 1, span, span + 1]) add(pad2(v), 1, "span", "跨度" + span);          // 4 跨度
  add(pad2(N[N.length - 1] + 1), 1, "extreme", "极号+1");                                      // 5 极大+1
  add(pad2(N[0] - 1), 1, "extreme", "极号-1");                                                 // 5 极小-1
  const tailCnt = {};
  for (const x of N) tailCnt[x % 10] = (tailCnt[x % 10] || 0) + 1;
  const hotTail = +Object.entries(tailCnt).sort((a, b) => b[1] - a[1])[0][0];
  for (const k of pool) if (Number(k) % 10 === hotTail) add(k, 0.5, "hottail", "热尾" + hotTail); // 6 热尾
  const road = [0, 0, 0];
  for (const x of N) road[x % 3]++;
  const coldRoad = road.indexOf(Math.min(...road));
  for (const k of pool) if (Number(k) % 3 === coldRoad) add(k, 0.5, "coldroad", "冷路" + coldRoad);  // 7 冷012路
  const primeCnt = N.filter(x => PRIMES.has(x)).length;
  if (primeCnt >= Math.ceil(N.length * 2 / 3)) { for (const k of pool) if (PRIMES.has(Number(k))) add(k, 0.5, "prime", "质数过多"); }
  else if (primeCnt <= Math.floor(N.length / 3)) { for (const k of pool) if (!PRIMES.has(Number(k)) && Number(k) > 1) add(k, 0.5, "prime", "合数过多"); } // 8 质合
  const zc = [0, 0, 0];
  for (const x of N) zc[zoneIdx(zones, x)]++;
  const hotZone = zc.indexOf(Math.max(...zc));
  for (const k of pool) if (zoneIdx(zones, Number(k)) === hotZone) add(k, 0.5, "hotzone", "热区" + (hotZone + 1)); // 9 热区
  if (prev) for (const x of mainOf(prev, kind)) add(pad2(Number(x)), 0.3, "prev2", "上上期号");   // 10 上上期

  const main = pool.map(k => wantReasons
    ? { n: k, votes: +votes[k].toFixed(2), reasons: [...new Set(why[k])] }
    : { n: k, votes: +votes[k].toFixed(2) })
    .filter(x => x.votes > 0).sort((a, b) => b.votes - a.votes || Number(a.n) - Number(b.n));
  const aux = s.aux ? killAux(kind, draws) : [];
  const out = { main, aux, threshold: killThreshold(main, opts.thFrac) };
  if (wantRaw) {
    // byFormula 的唯一消费方是 backtest，而它只取 arr.length 与 arr.filter(…)——纯集合语义。
    // 原来的「按票数排序」没有任何消费方（predict.test.mjs 也只查名单不重复），纯属白付。
    // 故只保证「集合正确、无重复」，顺序不作保证。
    out.byFormula = {};
    for (const key of Object.keys(FORMULAS)) out.byFormula[key] = fLists[key] || [];
  }
  return out;
}
function killThreshold(list, frac = 0.3) {
  if (!list.length) return 99;
  const f = Math.min(0.5, Math.max(0.05, Number(frac) || 0.3)); // 投票分位截断：默认杀票数前 30%
  const v = list.map(x => x.votes).sort((a, b) => b - a);
  return +(v[Math.min(v.length - 1, Math.floor(v.length * f))] || 0).toFixed(2);
}
function killAux(kind, draws) {
  const s = specOf(kind), pool = poolOf(s.aux), votes = {};
  for (const k of pool) votes[k] = 0;
  const last = draws[0]; if (!last) return [];
  const A = auxOf(last, kind).map(Number);
  for (const x of A) { if (votes[pad2(x)] !== undefined) votes[pad2(x)] += 1; if (votes[pad2(x + 1)] !== undefined) votes[pad2(x + 1)] += 0.5; if (votes[pad2(x - 1)] !== undefined) votes[pad2(x - 1)] += 0.5; }
  const st = freqStats(draws, pool, d => auxOf(d, kind));
  const cold = pool.slice().sort((a, b) => st.cur[b] - st.cur[a]).slice(0, Math.ceil(pool.length * 0.2));
  for (const k of cold) votes[k] += 0.5;
  return pool.map(k => ({ n: k, votes: +votes[k].toFixed(2) })).filter(x => x.votes > 0).sort((a, b) => b.votes - a.votes);
}
function killDigits(kind, draws) {
  const s = specOf(kind), perPos = [];
  for (let p = 0; p < s.digits; p++) {
    const digits = posPool(kind, p);
    const votes = {}; for (const d of digits) votes[d] = 0;
    const last = draws[0];
    if (last) {
      const arr = mainOf(last, kind);
      const v = Number(arr[p]);
      votes[String(v)] += 1;
      votes[String((v + 1) % 10)] += 0.5; votes[String((v + 9) % 10)] += 0.5;
      votes[String((v + 5) % 10)] += 0.5;
    }
    const st = freqStats(draws, digits, d => { const a = mainOf(d, kind); return a[p] !== undefined ? [String(a[p])] : []; });
    const cold = digits.slice().sort((a, b) => st.cur[b] - st.cur[a]).slice(0, 2);
    for (const c of cold) votes[c] += 0.5;
    perPos.push({ pos: p + 1, kill: digits.map(d => ({ n: d, votes: +votes[d].toFixed(2) })).filter(x => x.votes > 0).sort((a, b) => b.votes - a.votes) });
  }
  return { perPos };
}

// ---------- 定胆：频率 + 遗漏回归 + 邻号 + 重号 ----------
// 胆码打分（danList 与回测共用，保证口径一致）
// ---------- 回测专用的滚动统计 ----------
// 为什么需要它：回测每个测试点 i 都要「当期之前」的历史统计。旧实现对每个点重算
// freqStats(hist, …)，代价 O(点 × 历史长度 × 池)。一旦把口径统一成【全量历史】（与线上 analyzeAll 一致），
// 单是 ssq + 650 期就实测 11ms，越过免费版 Workers 单请求 10ms CPU 额度。
// 这里改成预扫一次：把每个号的出现位置记成偏移表，之后每个点只做一次二分 + 指针推进。
// 代价降到 O(历史 × 每期号码数 + 点数 × 池)，比旧实现还快，于是全量口径装得进预算。
// 等价性：freq/cur 的定义与 freqStats 完全一致（cur = 从窗口最新端数到该号出现为止的期数，
// 全窗口都没出现则取窗口长度 L），regress.test.mjs 用随机数据逐点比对锁死这一点。
export function rollingOffsets(draws, pool, getNums) {
  const at = {};
  for (const k of pool) at[k] = [];
  for (let j = 0; j < draws.length; j++) {
    for (const k of getNums(draws[j])) if (at[k] !== undefined) at[k].push(j);
  }
  for (const k of pool) at[k].reverse(); // 转成「从最新到最旧」
  return at;
}
// 窗口 = draws[start..end)（start 越靠后＝历史越短），返回该窗口下的 freq / cur / avg / max。
// at[k] 是【降序】（reverse 过，末元素最新）。于是「≥边界的元素」都排在数组前段，二分得到的下标
// 正是这类元素的个数：
//   loS = #{a >= start}   loE = #{a >= end}（loE <= loS）
//   窗口内出现 = 索引区间 [loE, loS)，次数 = loS - loE；其中最靠新的一次是 a[loS-1]
// avg/max 由「窗口内相邻两次出现之间的间隔」推出，与 freqStats 的 gaps 定义一致。
export function rollingAt(at, pool, start, N) { return rollingRange(at, pool, start, N); }
export function rollingRange(at, pool, start, end) {
  const freq = {}, cur = {}, avg = {}, max = {}, L = end - start;
  for (const k of pool) {
    const a = at[k];
    let loS = 0, hiS = a.length;
    while (loS < hiS) { const m = (loS + hiS) >> 1; if (a[m] >= start) loS = m + 1; else hiS = m; }
    let loE = 0, hiE = a.length;
    while (loE < hiE) { const m = (loE + hiE) >> 1; if (a[m] >= end) loE = m + 1; else hiE = m; }
    const cnt = loS - loE;
    freq[k] = cnt;
    cur[k] = cnt > 0 ? a[loS - 1] - start : L;
    if (cnt < 2) { avg[k] = L; max[k] = L; continue; }   // freqStats：无 gaps 时 avg = max = L
    let sum = 0, mx = 0;
    for (let j = loE + 1; j < loS; j++) { const g = a[j - 1] - a[j] - 1; sum += g; if (g > mx) mx = g; }
    const n = cnt - 1;
    avg[k] = +(sum / n).toFixed(2);
    max[k] = mx;
  }
  return { freq, cur, avg, max };
}
function scorePool(st, pool, lastN) {
  const near = new Set();
  for (const x of lastN) { near.add(pad2(Number(x) + 1)); near.add(pad2(Number(x) - 1)); }
  const maxF = Math.max(1, ...Object.values(st.freq));
  return pool.map(k => {
    const n = Number(k), f = st.freq[k], c = st.cur[k], a = st.avg[k];
    let v = (f / maxF) * 2;                                   // 频率
    if (a > 0 && c >= a * 0.8 && c <= a * 1.4) v += 1.2;      // 遗漏到达均值区（该出）
    else if (a > 0 && c > a * 2) v += 0.4;                    // 超长遗漏微弱加分
    if (near.has(k)) v += 0.6;                                // 上期邻号
    if (lastN.includes(k) && f / maxF > 0.6) v += 0.8;        // 热重号
    return { n: k, score: +v.toFixed(3), freq: f, cur: c, avg: a, max: st.max[k] };
  }).sort((a, b) => b.score - a.score);
}

export function danList(kind, draws, win = 30) {
  const s = specOf(kind);
  if (s.type === "digit") return danDigits(kind, draws, win);
  const w = draws.slice(0, win), pool = poolOf(s.main);
  const st = freqStats(w, pool, d => mainOf(d, kind));
  const lastN = mainOf(draws[0] || {}, kind);
  const sc = scorePool(st, pool, lastN);
  const aux = s.aux ? danAux(kind, draws, win) : [];
  return { main: sc.slice(0, 8), aux };
}
function danAux(kind, draws, win) {
  const s = specOf(kind), w = draws.slice(0, win), pool = poolOf(s.aux);
  const st = freqStats(w, pool, d => auxOf(d, kind));
  const lastA = auxOf(draws[0] || {}, kind).map(Number);
  const maxF = Math.max(1, ...Object.values(st.freq));
  return pool.map(k => {
    const f = st.freq[k], c = st.cur[k], a = st.avg[k];
    let v = (f / maxF) * 2;
    if (a > 0 && c >= a * 0.8 && c <= a * 1.4) v += 1.2;
    let dv = 99; for (const x of lastA) dv = Math.min(dv, Math.abs(Number(k) - x));
    if (dv === 1) v += 0.5; if (dv === 0) v -= 0.4;
    return { n: k, score: +v.toFixed(3), freq: f, cur: c, avg: a };
  }).sort((a, b) => b.score - a.score).slice(0, Math.max(s.aux.pick + 2, 4));
}
function danDigits(kind, draws, win) {
  const s = specOf(kind), w = draws.slice(0, win), perPos = [];
  for (let p = 0; p < s.digits; p++) {
    const digits = posPool(kind, p);
    const st = freqStats(w, digits, d => { const a = mainOf(d, kind); return a[p] !== undefined ? [String(a[p])] : []; });
    const maxF = Math.max(1, ...Object.values(st.freq));
    const lastD = mainOf(draws[0] || {}, kind)[p];
    const list = digits.map(k => {
      const c = st.cur[k], a = st.avg[k];
      let v = (st.freq[k] / maxF) * 2;
      if (a > 0 && c >= a * 0.8 && c <= a * 1.4) v += 1.2;
      if (lastD !== undefined) { const dv = Math.abs(Number(k) - Number(lastD)); if (dv === 1) v += 0.5; }
      return { n: k, score: +v.toFixed(3), freq: st.freq[k], cur: c, avg: a };
    }).sort((a, b) => b.score - a.score);
    perPos.push({ pos: p + 1, dan: list.slice(0, 5), hot: list[0].n, cold: list[list.length - 1].n });
  }
  return { perPos };
}

// ---------- 统一分析 ----------
export function analyzeAll(kind, draws, win = 30) {
  const s = specOf(kind);
  if (s.type === "digit") return analyzeDigits(kind, draws, win);
  const w = draws.slice(0, win), pool = poolOf(s.main);
  const st = freqStats(draws, pool, d => mainOf(d, kind));
  const auxPool = s.aux ? poolOf(s.aux) : [];
  const auxSt = s.aux ? freqStats(draws, auxPool, d => auxOf(d, kind)) : null;
  const byFreq = pool.slice().sort((a, b) => st.freq[b] - st.freq[a] || Number(a) - Number(b));
  let odd = 0, big = 0, sum = 0, prime = 0, consec = 0, repeat = 0, acSum = 0;
  const road = [0, 0, 0], tail = {}, zc = [0, 0, 0];
  const zones = zonesOf(s.main), mid = (s.main.min + s.main.max) / 2;
  w.forEach((d, i) => {
    const N = mainOf(d, kind).map(Number).sort((a, b) => a - b);
    odd += N.filter(x => x % 2).length;
    big += N.filter(x => x > mid).length;
    sum += N.reduce((a, b) => a + b, 0);
    prime += N.filter(x => PRIMES.has(x)).length;
    acSum += acValue(N);
    for (const x of N) { road[x % 3]++; const t = x % 10; tail[t] = (tail[t] || 0) + 1; zc[zoneIdx(zones, x)]++; }
    for (let j = 1; j < N.length; j++) if (N[j] - N[j - 1] === 1) consec++;
    if (i + 1 < w.length) { const prev = new Set(mainOf(w[i + 1], kind)); repeat += mainOf(d, kind).filter(x => prev.has(x)).length; }
  });
  const cnt = Math.max(1, w.length), pick = s.main.pick;
  // 副区转移矩阵：上期副区号 → 下期副区号 的历史转移频次（七乐彩同池 30×30 噪声大，跳过）
  let auxTransition = null;
  if (auxSt && s.aux && !(s.aux.min === s.main.min && s.aux.max === s.main.max)) {
    const tc = {};
    for (let i = 0; i + 1 < w.length; i++) {
      const from = auxOf(w[i + 1], kind), to = auxOf(w[i], kind); // w 由新到旧：w[i+1] 是更早一期
      for (const f of from) for (const t of to) tc[f + ">" + t] = (tc[f + ">" + t] || 0) + 1;
    }
    const curFrom = auxOf(draws[0] || {}, kind)[0] || null;
    let top = Object.entries(tc).filter(([k]) => k.startsWith(curFrom + ">"))
      .sort((a, b) => b[1] - a[1] || Number(a[0].split(">")[1]) - Number(b[0].split(">")[1]))
      .slice(0, 6).map(([k, v]) => ({ to: k.split(">")[1], count: v }));
    let note = "";
    if (!top.length) {
      // 上期副区号在窗口内没有转移样本（出现 0/1 次），退回全窗口高频转移
      top = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([k, v]) => ({ to: k.split(">")[1], count: v }));
      note = "上期副区号在窗口内无转移样本，以下为全窗口高频转移";
    }
    auxTransition = { from: curFrom, top, total: w.length - 1, ...(note ? { note } : {}) };
  }
  return {
    window: win, count: w.length,
    hot: byFreq.slice(0, pick), cold: byFreq.slice(-pick).reverse(),
    freq: st.freq, omission: { cur: st.cur, avg: st.avg, max: st.max },
    auxFreq: auxSt ? auxSt.freq : {}, auxOmission: auxSt ? { cur: auxSt.cur, avg: auxSt.avg, max: auxSt.max } : {},
    auxTransition,
    oddRatio: odd + ":" + (w.length * pick - odd),
    bigRatio: big + ":" + (w.length * pick - big),
    avgSum: Math.round(sum / cnt), avgAC: +(acSum / cnt).toFixed(2),
    primeRatio: prime + ":" + (w.length * pick - prime),
    road012: road, tail, zoneDist: zc,
    avgConsec: +(consec / cnt).toFixed(2), avgRepeat: +(repeat / cnt).toFixed(2)
  };
}
function analyzeDigits(kind, draws, win) {
  const s = specOf(kind), w = draws.slice(0, win), perPos = [];
  let sum = 0;
  for (let p = 0; p < s.digits; p++) {
    const digits = posPool(kind, p);
    const st = freqStats(draws, digits, d => { const a = mainOf(d, kind); return a[p] !== undefined ? [String(a[p])] : []; });
    const byF = digits.slice().sort((a, b) => st.freq[b] - st.freq[a] || Number(a) - Number(b));
    const odd = w.reduce((acc, d) => { const a = mainOf(d, kind); return acc + (a[p] !== undefined && Number(a[p]) % 2 ? 1 : 0); }, 0);
    perPos.push({
      pos: p + 1, freq: st.freq, hot: byF.slice(0, 3), cold: byF.slice(-3).reverse(),
      omission: { cur: st.cur, avg: st.avg, max: st.max }, oddRatio: odd + ":" + (w.length - odd)
    });
  }
  for (const d of w) sum += mainOf(d, kind).reduce((a, b) => a + Number(b), 0);
  const bigSmall = w.map(d => mainOf(d, kind).filter(x => Number(x) >= 5).length);
  const zu = s.digits === 3
    ? { group3: w.filter(d => { const a = mainOf(d, kind); return new Set(a).size === 2; }).length, group6: w.filter(d => { const a = mainOf(d, kind); return new Set(a).size === 3; }).length, bail: w.filter(d => new Set(mainOf(d, kind)).size === 1).length }
    : null;
  return {
    window: win, count: w.length, digits: s.digits, perPos,
    avgSum: +(sum / Math.max(1, w.length)).toFixed(2),
    avgBigSmall: +(bigSmall.reduce((a, b) => a + b, 0) / Math.max(1, w.length)).toFixed(2),
    form: zu
  };
}

// ---------- 结构打分：和值/奇偶/大小/区间/跨度/AC ----------
// 形态过滤：和值落理想区 ±1.3tol、跨度在区间的 50%~98%
function shapeOk(main, zone) {
  const n = main.map(Number).sort((a, b) => a - b);
  if (n.length < 2) return true;
  const sum = n.reduce((a, b) => a + b, 0);
  const ideal = zone.pick * (zone.min + zone.max) / 2, tol = zone.pick * (zone.max - zone.min) / 6;
  const span = n[n.length - 1] - n[0], range = zone.max - zone.min;
  return Math.abs(sum - ideal) <= tol * 1.3 && span >= range * 0.5 && span <= range * 0.98;
}
export function structScore(nums, zone) {
  const n = nums.map(Number).sort((a, b) => a - b);
  if (n.length < 2) return 0;
  const pick = zone.pick, min = zone.min, max = zone.max, mid = (min + max) / 2;
  const sum = n.reduce((a, b) => a + b, 0), ideal = pick * (min + max) / 2;
  const tol = pick * (max - min) / 6;
  let s = 0;
  if (Math.abs(sum - ideal) <= tol) s += 3; else if (Math.abs(sum - ideal) <= tol * 1.6) s += 1.5;
  const odd = n.filter(x => x % 2).length;
  if (odd >= Math.floor(pick / 2) && odd <= Math.ceil(pick / 2) + 1) s += 2;
  const big = n.filter(x => x > mid).length;
  if (big >= Math.floor(pick / 2) && big <= Math.ceil(pick / 2) + 1) s += 2;
  const zones = zonesOf(zone), zc = [0, 0, 0];
  for (const x of n) zc[zoneIdx(zones, x)]++;
  if (zc.every(x => x > 0)) s += 2;
  const span = n[n.length - 1] - n[0];
  const lo = (max - min) * 0.5, hi = (max - min) * 0.95;
  if (span >= lo && span <= hi) s += 1;
  const ac = acValue(n);
  if (ac >= pick - 1 && ac <= pick + 4) s += 1;
  return +s.toFixed(2);
}

// ---------- 统一推荐：6 套策略，与双色球原有 6 套一一对应 ----------
export function recommendAll(kind, draws, opts = {}) {
  const s = specOf(kind);
  const win = Math.min(100, Math.max(5, opts.win || 30));
  // 数字型没有号码池，先分流，不要触碰 s.main
  if (s.type === "digit") return recommendDigits(kind, draws, win);
  const filter = !!opts.filter;
  const n = Math.min(s.main.max - s.main.min + 1, Math.max(1, opts.n || s.suggest));
  const an = analyzeAll(kind, draws, win);
  // 门槛必须在 killList/danList 之前：样本极小时 tailCnt 可能为空，那里会直接抛
  if (an.count < MIN_DRAWS) return {
    kind, name: s.name, type: s.type, window: win, count: an.count,
    analysis: an, kill: null, dan: null, picks: [], insufficient: true,
    last: draws[0] ? { code: draws[0].code, main: mainOf(draws[0], kind), aux: auxOf(draws[0], kind) } : null,
    note: insufficientNote(an.count), disclaimer: DISCLAIMER
  };
  const kl = killList(kind, draws), dl = danList(kind, draws, win);
  const pool = poolOf(s.main);
  const killed = new Set((kl.main || []).filter(x => x.votes >= (kl.threshold ?? 99)).map(x => x.n));
  const lastN = new Set(mainOf(draws[0] || {}, kind));
  const byFreqDesc = pool.slice().sort((a, b) => an.freq[b] - an.freq[a] || Number(a) - Number(b));
  const byColdDesc = pool.slice().sort((a, b) => an.omission.cur[b] - an.omission.cur[a] || Number(a) - Number(b));
  const auxN = s.aux ? s.aux.pick : 0;
  const auxTop = (dl.aux || []).slice(0, Math.max(auxN, 3)).map(x => x.n);
  const auxCold = s.aux ? poolOf(s.aux).slice().sort((a, b) => an.auxOmission.cur[b] - an.auxOmission.cur[a]).slice(0, auxN) : [];
  const auxPoolAll = s.aux ? poolOf(s.aux) : [];
  // 副区与主区同池时（七乐彩基本号 / 特别号），特别号不得与基本号重复
  const auxPick = (i, excl = []) => {
    if (!s.aux) return [];
    const cand = [...auxTop, ...auxPoolAll].filter(x => !excl.includes(x));
    const p = cand.slice(i, i + auxN);
    while (p.length < auxN && p.length < auxPoolAll.length) {
      const c = auxPoolAll[Math.floor(Math.random() * auxPoolAll.length)];
      if (!p.includes(c) && !excl.includes(c)) p.push(c);
    }
    return p.sort();
  };
  const mk = (name, arr, note, auxIdx = 0, auxOverride = null) => {
    // filter=1 时做形态过滤（和值落理想区、跨度合理），最多重抽 12 次
    let main = [];
    for (let t = 0; t < 12; t++) {
      main = pickN(arr.filter(x => !isNaN(Number(x))), n).slice(0, n);
      if (!filter || shapeOk(main, s.main)) break;
    }
    // 结构分按「实际选号个数」评估：快乐8 选 8 个时不能用开奖 20 个号的基准
    const aux = (auxOverride && !auxOverride.some(x => main.includes(x))) ? auxOverride : auxPick(auxIdx, main);
    const nums = main.map(Number);
    return {
      name, main, aux,
      score: structScore(main, { ...s.main, pick: main.length }),
      sum: nums.reduce((a, b) => a + b, 0), span: Math.max(...nums) - Math.min(...nums),
      note
    };
  };
  const picks = [
    // 注意：an.freq 来自 freqStats(draws, …)——按全部期数统计，win 只截断 road/odd/tail 那部分，
    // 所以这里不能写死"近 30 期"，否则 draws 多于 win 时标签就是假的
    mk("稳健·热号", byFreqDesc.slice(0, Math.max(n + 4, 10)), "全部 " + draws.length + " 期高频号为主", 0),
    mk("进取·遗漏", byColdDesc.slice(0, Math.max(n + 4, 10)), "优先回补长遗漏号", 0, auxCold.length ? auxCold : null),
    mk("均衡", [...byFreqDesc.slice(0, 8), ...byColdDesc.slice(0, 6), ...(dl.main || []).slice(0, 3).map(x => x.n)], "冷热混合 + 胆码", 1),
    mk("区间覆盖", zoneCover(kind, pool, byFreqDesc, n, s), "三区均匀覆盖", 1),
    mk("杀号缩水", pool.filter(x => !killed.has(x)).sort((a, b) => (dl.main || []).findIndex(y => y.n === b) - (dl.main || []).findIndex(y => y.n === a)), "剔除 " + killed.size + " 个杀号后按胆码排序", 2),
    mk("随机基准", pool, "纯随机对照", 2)
  ];
  return {
    kind, name: s.name, type: s.type, window: win, count: an.count,
    analysis: an, kill: kl, dan: dl, picks,
    last: draws[0] ? { code: draws[0].code, main: mainOf(draws[0], kind), aux: auxOf(draws[0], kind) } : null,
    disclaimer: DISCLAIMER
  };
}
function zoneCover(kind, pool, byFreqDesc, n, s) {
  const zones = zonesOf(s.main), out = [];
  const order = [...byFreqDesc];
  for (let r = 0; r < Math.ceil(n / 2) + 2; r++) {
    for (const z of zones) {
      const cand = order.find(k => !out.includes(k) && Number(k) >= z.from && Number(k) <= z.to);
      if (cand) { out.push(cand); if (out.length >= n) break; }
    }
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}
function recommendDigits(kind, draws, win) {
  const s = specOf(kind);
  const an = analyzeAll(kind, draws, win);
  if (an.count < MIN_DRAWS) return {
    kind, name: s.name, type: s.type, window: win, count: an.count,
    analysis: an, kill: null, dan: null, picks: [], insufficient: true,
    last: draws[0] ? { code: draws[0].code, digits: mainOf(draws[0], kind) } : null,
    formHint: s.digits === 3 ? { 组三: an.form.group3, 组六: an.form.group6, 豹子: an.form.bail } : null,
    note: insufficientNote(an.count), disclaimer: DISCLAIMER
  };
  const kl = killList(kind, draws), dl = danList(kind, draws, win);
  const mk = (name, fn, note) => {
    const digits = [];
    for (let p = 0; p < s.digits; p++) digits.push(fn(p));
    return { name, digits, number: digits.join(""), score: digitScore(digits, an), note };
  };
  const picks = [
    mk("稳健·热号", p => (an.perPos[p].hot[0]), "各位取最热号"),
    mk("进取·遗漏", p => (an.perPos[p].cold[0]), "各位取最冷号"),
    mk("胆码优先", p => (dl.perPos[p].dan[0].n), "各位取胆码第一名"),
    mk("杀号规避", p => {
      const killed = new Set((kl.perPos[p].kill || []).filter(x => x.votes >= 1).map(x => x.n));
      const cand = an.perPos[p].hot.find(x => !killed.has(x));
      return cand !== undefined ? cand : an.perPos[p].hot[0];
    }, "剔除各位杀号后取最热"),
    mk("均值回归", p => {
      const om = an.perPos[p].omission, digits = posPool(kind, p);
      return digits.slice().sort((a, b) => Math.abs(om.cur[a] - om.avg[a]) - Math.abs(om.cur[b] - om.avg[b]))[0];
    }, "遗漏最接近历史均值"),
    // 对照组必须从该位真实号池均匀抽样：七星彩第 7 位抽 0-9 会让随机基线整体偏高（见 posPool 注释）
    mk("随机基准", p => { const pool = posPool(kind, p); return pool[Math.floor(Math.random() * pool.length)]; }, "纯随机对照")
  ];
  return {
    kind, name: s.name, type: s.type, window: win, count: an.count,
    analysis: an, kill: kl, dan: dl, picks,
    last: draws[0] ? { code: draws[0].code, digits: mainOf(draws[0], kind) } : null,
    formHint: s.digits === 3 ? { 组三: an.form.group3, 组六: an.form.group6, 豹子: an.form.bail } : null,
    disclaimer: DISCLAIMER
  };
}
function digitScore(digits, an) {
  let s = 0;
  digits.forEach((d, p) => {
    const f = an.perPos[p].freq;
    const maxF = Math.max(1, ...Object.values(f));
    s += (f[d] || 0) / maxF;
  });
  return +(s / digits.length).toFixed(3);
}

// ---------- 回测：把「经验权重」变成有数据背书的指标 ----------
// 设计要点（与线上引擎同一口径）：
//  - 每个测试点 i 只用 draws[i+1..]（即当期之前）的历史统计做预测，与真实开奖比对，杜绝未来函数
//  - 口径与线上逐项对齐：热号/冷号吃【全量历史】（= analyzeAll 的 freqStats(draws, …)），
//    胆码吃【win 窗口】（= danList(kind, draws, win)）。旧注释写「复用同一打分，保证线上给什么、回测验什么」
//    当时是假的：freq 实际吃全量而回测只喂 hist.slice(0, win)，两边根本不是同一个口径。
//  - 唯一仍不对齐的是杀号：线上 killList 用全部历史，回测为 CPU 封顶 100 期（见下方 note，别当它已对齐）
//  - 输出均带随机基线：单号命中率 = pick/poolSize；命中低于基线才有信息量（尤其杀号）
export function backtest(kind, draws, opts = {}) {
  const s = specOf(kind);
  const N = Array.isArray(draws) ? draws.length : 0;
  const warmup = Math.max(10, Math.min(opts.warmup || 30, Math.max(1, N - 1)));
  const win = Math.max(10, Math.min(opts.win || 30, 60));
  const maxP = Math.max(0, Math.min(600, N - warmup));
  const periods = Math.max(0, Math.min(opts.periods || 15, maxP));
  // 免费版 Workers 单请求 CPU 限 10ms：按步长抽样把测试点数封顶。
  // 上限从 60 收到 40：每点成本随彩种差很多（快乐8 号池 80 且每期 20 个号，10 个杀号公式要扫全池），
  // 实测 650 期深历史下 60 点时快乐8 约 12.7ms、七星彩约 11.2ms，会顶穿额度；40 点时最差约 8.5ms。
  // 默认 periods=15~20 不受影响，只有显式传大 periods 时抽样更粗——而 stride/tested 本来就回报给前端。
  const MAX_POINTS = 40;
  const stride = periods > MAX_POINTS ? Math.ceil(periods / MAX_POINTS) : 1;
  const note = "纯统计对照，不构成任何预测保证；某项长期优于基线也不代表未来有效。"
    + "热号/冷号按全量历史统计（与线上一致）；胆码按 win=" + win + " 窗口（与 danList 一致）；"
    + "杀号统计窗口封顶 100 期（CPU 上限），与线上 killList 的全量历史不完全对齐";
  if (N < warmup + 1 || periods <= 0) return { kind, name: s.name, type: s.type, periods: 0, note: "样本不足，无法回测", disclaimer: DISCLAIMER };
  if (s.type === "digit") return backtestDigit(kind, draws, { warmup, win, periods, stride, note });

  const pool = poolOf(s.main), size = pool.length, pick = s.main.pick;
  const guessN = Math.min(s.suggest, size), danK = 8, base = pick / size;
  const hot = { hit: 0 }, cold = { hit: 0 }, dan = { hit: 0 };
  const kill = { killed: 0, hit: 0 };
  const killAgg = {};
  const aux = s.aux ? { pick: s.aux.pick, size: s.aux.max - s.aux.min + 1, hot: { hit: 0 }, kill: { killed: 0, hit: 0 } } : null;
  let tested = 0;
  const eras = {}; // 分年代桶：策略稳定性观察（era → {tested, hot, cold, dan, kk, kh}）
  // 全量口径的滚动统计只预扫一次（O(历史×每期号码数)），循环内每点只查表
  const offMain = rollingOffsets(draws, pool, d => mainOf(d, kind));
  const offAux = aux ? rollingOffsets(draws, poolOf(s.aux), d => auxOf(d, kind)) : null;
  // draws 由新到旧：测试最近 periods 期（步长抽样），历史为 draws[i+1..]
  for (let i = periods - 1; i >= 0; i -= stride) {
    const hist = draws.slice(i + 1);
    if (hist.length < warmup) continue;
    const actual = new Set(mainOf(draws[i], kind));
    // 口径纪律（与线上引擎逐项对齐，改一处就要同步另一处）：
    //   热号/冷号 → 对应 recommendAll 的 byFreqDesc，源自 analyzeAll 的 freqStats(draws, …)，即【全量历史】
    //   胆码     → 对应 danList(kind, draws, win)，那个函数是【显式 win 窗口】的，不能跟着改成全量
    //   副区热号 → 对应 analyzeAll 的 auxSt，同样是全量
    // 旧实现三处共用一个 hist.slice(0, win) 的 st：热/冷口径与线上不符（win 只截断 road/odd/tail，
    // freq 实际吃全部期数），而 dan 恰好因为共用才碰巧对上了线上。改成全量后必须给 dan 单独一份。
    // 全量部分走滚动统计（见 rollingOffsets），不在每个点重扫整段历史——否则免费版 10ms CPU 不够用。
    const stFull = rollingAt(offMain, pool, i + 1, N);
    // 胆码口径 = danList 的 hist.slice(0, win)，即全局下标区间 [i+1, i+1+min(win, hist.length))。
    // 与 stFull 同一张预扫表，只是窗口换成 win：口径不变，但省掉每点重扫 30 期（scorePool 只要
    // freq/cur/avg/max，rollingRange 全都给，且与 freqStats 逐值等价——已用 39.9 万个值对拍锁死）。
    const stDan = rollingRange(offMain, pool, i + 1, i + 1 + Math.min(win, hist.length));
    const lastN = mainOf(hist[0] || {}, kind);
    const hotTop = pool.slice().sort((a, b) => stFull.freq[b] - stFull.freq[a] || Number(a) - Number(b)).slice(0, guessN);
    const coldTop = pool.slice().sort((a, b) => stFull.cur[b] - stFull.cur[a] || Number(a) - Number(b)).slice(0, guessN);
    const danTop = scorePool(stDan, pool, lastN).slice(0, danK).map(x => x.n);
    const hHit = hotTop.filter(k => actual.has(k)).length, cHit = coldTop.filter(k => actual.has(k)).length, dHit = danTop.filter(k => actual.has(k)).length;
    hot.hit += hHit; cold.hit += cHit; dan.hit += dHit;
    // killAux 的遗漏统计窗口封顶 100 期：600 期跨度时历史数组很长，不封顶 CPU 会失控
    // opts.weights：校准权重（来自 calibrate）——传入后回测的就是「加权杀号」的真实命中率
    // 统计窗口封顶 100 期保证 CPU 有界；数字型 killDigits 忽略 weights。
    // reasons 只在「按号展示为什么被杀」时需要，回测只算票数 → 关掉省掉每号一个 Set 分配
    const kl = killList(kind, hist.slice(0, 100), { perFormula: true, reasons: false, weights: opts.weights, thFrac: opts.thFrac }), th = kl.threshold ?? 99;
    const killed = (kl.main || []).filter(x => x.votes >= th).map(x => x.n);
    const kHit = killed.filter(k => actual.has(k)).length;
    kill.killed += killed.length;
    kill.hit += kHit;
    // 年代桶累积（命中数已在上面捕获，这里只做归档）
    const era = eraOf(draws[i]);
    const eb = eras[era] || (eras[era] = { tested: 0, hot: 0, cold: 0, dan: 0, kk: 0, kh: 0 });
    eb.tested++; eb.hot += hHit; eb.cold += cHit; eb.dan += dHit; eb.kk += killed.length; eb.kh += kHit;
    if (kl.byFormula) {
      for (const [key, arr] of Object.entries(kl.byFormula)) {
        const a = killAgg[key] || (killAgg[key] = { killed: 0, hit: 0 });
        a.killed += arr.length;
        a.hit += arr.filter(k => actual.has(k)).length;
      }
    }
    if (aux) {
      const aPool = poolOf(s.aux);
      const aSt = rollingAt(offAux, aPool, i + 1, N); // 全量历史，与 analyzeAll 的 auxSt 同口径
      const aAct = new Set(auxOf(draws[i], kind));
      const aHot = aPool.slice().sort((x, y) => aSt.freq[y] - aSt.freq[x] || Number(x) - Number(y)).slice(0, aux.pick);
      aux.hot.hit += aHot.filter(k => aAct.has(k)).length;
      const aKilled = (kl.aux || []).filter(x => x.votes >= (killThreshold(kl.aux) ?? 99)).map(x => x.n);
      aux.kill.killed += aKilled.length;
      aux.kill.hit += aKilled.filter(k => aAct.has(k)).length;
    }
    tested++;
  }
  if (!tested) return { kind, name: s.name, type: s.type, periods: 0, note: "样本不足，无法回测", disclaimer: DISCLAIMER };
  const rate = (a, b) => +(a / Math.max(1, b)).toFixed(3);
  const out = {
    kind, name: s.name, type: s.type, periods, tested, stride, warmup, win,
    guessN, pick, poolSize: size, baseline: +base.toFixed(4),
    strategies: {
      hot: { avgHit: +(hot.hit / tested).toFixed(3), hitRate: rate(hot.hit, tested * guessN), baseline: +base.toFixed(4), p: binomP(hot.hit, tested * guessN, base), note: "预测 " + guessN + " 个，单号基线 " + base.toFixed(4) },
      cold: { avgHit: +(cold.hit / tested).toFixed(3), hitRate: rate(cold.hit, tested * guessN), baseline: +base.toFixed(4), p: binomP(cold.hit, tested * guessN, base) },
      dan: { k: danK, avgHit: +(dan.hit / tested).toFixed(3), hitRate: rate(dan.hit, tested * danK), baseline: +(danK * base).toFixed(4), p: binomP(dan.hit, tested * danK, base) } // hitRate 的随机基线是单号 base（danK*base 是 avgHit 基线，>1 不能当 p0）
    },
    kill: {
      killedTotal: kill.killed, killedHit: kill.hit,
      hitRate: rate(kill.hit, kill.killed), baseline: +base.toFixed(4),
      p: binomP(kill.hit, kill.killed, base),
      verdict: kill.killed === 0 ? "无杀号样本" : (kill.hit / kill.killed < base ? "有效（低于随机基线）" : "无信息（不低于随机基线）"),
      formulas: Object.entries(FORMULAS).map(([key, label]) => {
        const a = killAgg[key] || { killed: 0, hit: 0 };
        const r = a.killed > 0 ? +(a.hit / a.killed).toFixed(4) : null;
        return { key, label, killed: a.killed, hit: a.hit, rate: r, baseline: +base.toFixed(4), p: binomP(a.hit, a.killed, base),
          verdict: a.killed === 0 ? "无样本" : (r < base ? "有效" : "无信息") };
      })
    },
    note, disclaimer: DISCLAIMER
  };
  // 分年代稳定性：策略是「长期有效」还是「最近退化」，分年看一眼便知
  out.eras = Object.entries(eras).map(([era, b]) => ({
    era, tested: b.tested,
    hotRate: +(b.hot / Math.max(1, b.tested * guessN)).toFixed(3),
    danRate: +(b.dan / Math.max(1, b.tested * danK)).toFixed(3),
    killRate: b.kk ? +(b.kh / b.kk).toFixed(3) : null,
    killN: b.kk
  })).sort((a, b) => a.era < b.era ? -1 : 1);
  if (aux) {
    const aBase = aux.pick / aux.size;
    out.aux = {
      pick: aux.pick, poolSize: aux.size, baseline: +aBase.toFixed(4),
      hot: { hitRate: rate(aux.hot.hit, tested * aux.pick), baseline: +aBase.toFixed(4) },
      kill: { killedTotal: aux.kill.killed, hitRate: rate(aux.kill.hit, aux.kill.killed), baseline: +aBase.toFixed(4) }
    };
  }
  return out;
}

function backtestDigit(kind, draws, cfg) {
  const s = specOf(kind), N = draws.length;
  const perPos = Array.from({ length: s.digits }, (_, p) => ({ pos: p + 1, hotHits: 0, coldHits: 0, killTotal: 0, killHit: 0, tested: 0 }));
  // 逐位预扫：七星彩第 7 位是 15 格，与前 6 位不同，号池必须按位取（见 posPool）
  const off = Array.from({ length: s.digits }, (_, p) => {
    const pool = posPool(kind, p);
    return { pool, at: rollingOffsets(draws, pool, d => { const a = mainOf(d, kind); return a[p] !== undefined ? [String(a[p])] : []; }) };
  });
  for (let i = cfg.periods - 1; i >= 0; i -= cfg.stride) {
    const hist = draws.slice(i + 1);
    if (hist.length < cfg.warmup) continue;
    const actual = mainOf(draws[i], kind);
    // killList 与「位」无关，却原来被写在逐位循环里 → 七星彩每个测试点白算 7 遍、排列5 白算 5 遍。
    // 提到循环外是严格等价（只用到 kl.perPos[p]），也是数字型回测能不能进 10ms CPU 额度的关键。
    // 统计窗口封顶 100 期保证 CPU 有界；数字型 killDigits 忽略 weights。
    const kl = killList(kind, hist.slice(0, 100), { weights: cfg.weights });
    for (let p = 0; p < s.digits; p++) {
      const { pool: DIG, at } = off[p];
      const st = rollingAt(at, DIG, i + 1, N); // 全量历史，与 analyzeDigits 的 freqStats(draws, …) 同口径
      const row = perPos[p];
      const hot1 = DIG.slice().sort((a, b) => st.freq[b] - st.freq[a] || Number(a) - Number(b))[0];
      const cold1 = DIG.slice().sort((a, b) => st.cur[b] - st.cur[a] || Number(a) - Number(b))[0];
      row.hotHits += hot1 === String(actual[p]) ? 1 : 0;
      row.coldHits += cold1 === String(actual[p]) ? 1 : 0;
      const k1 = (kl.perPos[p].kill || [])[0];
      if (k1 && k1.votes > 0) { row.killTotal++; row.killHit += k1.n === String(actual[p]) ? 1 : 0; }
      row.tested++;
    }
  }
  const bl = +digitBaseline(kind).toFixed(4);
  return {
    kind, name: s.name, type: s.type, periods: cfg.periods, tested: perPos[0].tested, stride: cfg.stride, warmup: cfg.warmup, win: cfg.win,
    baseline: bl,
    perPos: perPos.map(r => ({
      pos: r.pos,
      baseline: +posBaseline(kind, r.pos - 1).toFixed(4),
      hotRate: +(r.hotHits / Math.max(1, r.tested)).toFixed(3),
      coldRate: +(r.coldHits / Math.max(1, r.tested)).toFixed(3),
      killRate: r.killTotal ? +(r.killHit / r.killTotal).toFixed(3) : null,
      tested: r.tested
    })),
    note: "各位独立同分布，单位随机基线 = 1 / 该位号池大小（逐位基线见 perPos[].baseline；七星彩第 7 位号池 15 格，基线 6.7%，其余位 10%）；killRate 为首位杀号命中开奖的比例，越低越好。"
      + "热号/冷号按全量历史统计（与线上一致）；杀号统计窗口封顶 100 期（CPU 上限），与线上 killList 的全量历史不完全对齐", disclaimer: DISCLAIMER
  };
}

// ---------- 校准：按分公式回测命中率生成动态权重 ----------
// rate 越高于基线，权重越低（无效公式自动降权）；权重区间 [0.2, 2]
// 样本量保护（审计发现）：killed < 10 的公式不参与加权——小样本 rate=0 会被误判成「神公式」放大噪音；
// killed ≥ 10 后按样本量线性收缩到满强度（killed=40 达满强度），小样本极端权重被压向 1
function weightsFrom(bt) {
  const weights = {};
  if (bt.kill && bt.kill.formulas) {
    for (const f of bt.kill.formulas) {
      if (f.killed === 0 || f.rate == null) { weights[f.key] = 1; continue; }
      const clamped = Math.max(0.2, Math.min(2, +(2 - f.rate / f.baseline).toFixed(3)));
      weights[f.key] = f.killed < 10 ? 1 : +(1 + (clamped - 1) * Math.min(1, f.killed / 40)).toFixed(3);
    }
  }
  return weights;
}
// holdout 模式（opts.holdout>0，如 0.3）：只用旧段拟合权重，在新段分别回测「带权重 / 不带权重」的
// 杀号命中率——新段上 calibrated 仍低于 raw 才说明校准有外推价值（防「同一段数据既调权又报成绩」的过拟合）。
// CPU 说明：显式传 holdout 才计算，默认路径不涨 CPU（免费版单请求限制）。
export function calibrate(kind, draws, opts = {}) {
  const hFrac = Math.max(0, Math.min(opts.holdout || 0, 0.5));
  const s = specOf(kind);
  if (hFrac > 0 && s.type !== "digit") {
    const N = draws.length;
    // draws 新→旧：新段 = 最近 hFrac 比例（slice(0,m)），旧段 = 其余（slice(m)）用于拟合
    // （验证代理抓出的反转 bug：原实现 m=N*(1-hFrac) 导致拟合只剩最旧 hFrac 段）
    const m = Math.max(opts.warmup || 30, Math.floor(N * hFrac));
    const evalN = m;
    if (evalN < 20) {
      const bt0 = backtest(kind, draws, { periods: opts.periods || 12, warmup: opts.warmup || 30, win: opts.win || 30 });
      return { weights: weightsFrom(bt0), periods: bt0.periods, formulas: (bt0.kill && bt0.kill.formulas) || [], holdout: { note: "样本不足：新段 < 20 期，未做外推检验" } };
    }
    const fitPart = draws.slice(m), evalPart = draws.slice(0, m); // fitPart=旧段（N-m 期）拟合，evalPart=新段（m 期，含最新）评估
    const fitBt = backtest(kind, fitPart, { periods: opts.periods || 12, warmup: opts.warmup || 30, win: opts.win || 30 });
    const weights = weightsFrom(fitBt);
    const withW = backtest(kind, evalPart, { periods: opts.evalPeriods || 60, warmup: opts.warmup || 30, win: opts.win || 30, weights });
    const raw = backtest(kind, evalPart, { periods: opts.evalPeriods || 60, warmup: opts.warmup || 30, win: opts.win || 30 });
    const k = b => b && b.kill ? { hitRate: b.kill.hitRate, baseline: b.kill.baseline, killedTotal: b.kill.killedTotal, p: b.kill.p } : null;
    return {
      weights, periods: fitBt.periods, formulas: (fitBt.kill && fitBt.kill.formulas) || [],
      holdout: {
        splitAt: m, fitN: fitPart.length, evalN, evalPeriods: withW.periods, tested: withW.tested,
        calibrated: k(withW), raw: k(raw),
        note: "权重仅用旧段（fitN 期）拟合；新段上 calibrated 仍低于 raw 才说明校准有外推价值"
      }
    };
  }
  const bt = backtest(kind, draws, { periods: opts.periods || 12, warmup: opts.warmup || 30, win: opts.win || 30 });
  const res = { weights: weightsFrom(bt), periods: bt.periods, formulas: (bt.kill && bt.kill.formulas) || [] };
  if (hFrac > 0 && s.type === "digit") res.holdout = { note: "数字型无加权杀号聚合，holdout 不适用" };
  return res;
}

// ---------- 杀号阈值寻优：默认「杀票数前 30%」是不是最优分位？ ----------
// 方法：旧 70% 段上对 5 个分位分别回测找 train 最优 → 所有分位在新 30% 段上评估。
// 诚实判据：train 最优阈值在 test 上与 test oracle（事后最优）差距小 → 阈值有意义；
// 差距大 / 各分位差不多 → 说明命中率对阈值不敏感，默认 30% 即可（大概率是噪音，别调）。
export function thresholdTune(kind, draws, opts = {}) {
  const s = specOf(kind);
  if (s.type !== "pool") return { kind, name: s && s.name, note: "数字型不支持阈值寻优", disclaimer: DISCLAIMER };
  const N = draws.length;
  const m = Math.max(30, Math.floor(N * 0.3));
  if (N - m < 40) return { kind, name: s.name, note: "样本不足（新段 < 40 期）", disclaimer: DISCLAIMER };
  const fitPart = draws.slice(m), evalPart = draws.slice(0, m); // 同 holdout 口径：旧段拟合、新段验证
  const FRACS = [0.2, 0.25, 0.3, 0.35, 0.4];
  const run = part => FRACS.map(f => {
    // periods 可由调用方降档（免费版 10ms CPU：10 次 backtest 是重计算，线上实测超限时降 20）
    const bt = backtest(kind, part, { periods: opts.periods || 40, warmup: 30, win: 30, thFrac: f });
    return { frac: f, hitRate: bt.kill.hitRate, killedTotal: bt.kill.killedTotal, tested: bt.tested };
  });
  const train = run(fitPart), test = run(evalPart);
  const trainBest = train.reduce((a, b) => (b.hitRate < a.hitRate ? b : a));
  const oracle = test.reduce((a, b) => (b.hitRate < a.hitRate ? b : a));
  const atTrainBest = test.find(x => x.frac === trainBest.frac);
  const gap = +(atTrainBest.hitRate - oracle.hitRate).toFixed(4);
  return {
    kind, name: s.name, tested: { train: fitPart.length, test: evalPart.length },
    train, test, trainBest, oracle, gap,
    verdict: gap <= 0.005
      ? "train 最优阈值在 test 上接近事后最优——阈值有信息量"
      : "train 最优在 test 上明显逊于事后最优——阈值不敏感/过拟合，默认 30% 即可",
    note: "分位 = 杀掉票数排名前 N% 的号；回测各 40 期（抽样封顶），差异在小样本内未必显著",
    disclaimer: DISCLAIMER
  };
}

// ---------- 胆拖投注单：胆 = 评分最高 D 个（剔除杀号），拖 = 次高 T 个，副区取胆码前 pick 个 ----------
import { C, PRICE } from "./calc.js";
export function ticket(kind, draws, opts = {}) {
  const s = specOf(kind);
  // 只有双色球 / 大乐透 / 七乐彩有标准胆拖玩法；快乐8 的胆拖是「选几中几」另一套规则，不硬套
  if (s.type === "digit" || !["ssq", "dlt", "qlc"].includes(kind)) {
    return { kind, name: s.name, note: "该彩种无标准胆拖玩法：数字型用分位推荐组合定位单，快乐8 用 /api/calc 的选几复式", disclaimer: DISCLAIMER };
  }
  const win = Math.max(10, Math.min(opts.win || 30, 60));
  const pool = poolOf(s.main), pick = s.main.pick, size = pool.length;
  const D = Math.max(1, Math.min(opts.dan || 2, pick - 1));
  const T = Math.max(pick - D, Math.min(opts.tuo || pick - D + 3, size - D));
  const st = freqStats(draws.slice(0, win), pool, d => mainOf(d, kind));
  const ranked = scorePool(st, pool, mainOf(draws[0] || {}, kind)).map(x => x.n);
  const kl = killList(kind, draws), th = kl.threshold ?? 99;
  const killed = new Set((kl.main || []).filter(x => x.votes >= th).map(x => x.n));
  const cand = ranked.filter(n => !killed.has(n));
  for (const k of ranked) { if (cand.length >= D + T) break; if (!cand.includes(k)) cand.push(k); } // 杀号过多时按评分兜底
  const dan = cand.slice(0, D).sort();
  const tuo = cand.slice(D, D + T).sort();
  const aux = s.aux ? (danList(kind, draws, win).aux || []).slice(0, s.aux.pick).map(x => x.n).sort() : [];
  const bets = C(T, pick - D);
  return {
    kind, name: s.name,
    dan, tuo, aux, danCount: D, tuoCount: T,
    bets, amount: bets * PRICE,
    excluded: killed.size,
    note: "胆 " + D + " + 拖 " + T + "，每注 " + (pick - D) + " 个主区号" +
      (s.aux ? " + " + s.aux.pick + " 个副区号" : "") + "；共 " + bets + " 注 / " + (bets * PRICE).toFixed(0) + " 元（按每注 2 元估算）",
    disclaimer: DISCLAIMER
  };
}

// ---------- 通用遗漏走势（号码池型）：旧→新逐期给出各号当期遗漏 ----------
export function trendPool(kind, draws, win = 30) {
  const s = specOf(kind);
  if (s.type !== "pool") return [];
  const pool = poolOf(s.main), miss = {};
  for (const k of pool) miss[k] = 0;
  return draws.slice(0, win).reverse().map(d => {
    const nums = new Set(mainOf(d, kind));
    const row = { code: d.code, main: mainOf(d, kind), aux: auxOf(d, kind), miss: {} };
    for (const k of pool) { if (nums.has(k)) miss[k] = 0; else miss[k]++; row.miss[k] = miss[k]; }
    return row;
  });
}

// ---------- 主区形态转移矩阵（号码池型）：和值档位 / 奇偶 / 大小 / 012路 ----------
// 一阶转移 + 拉普拉斯平滑：p = (count+1)/(total+3)，样本稀疏时趋近均匀，杜绝零样本假确定
// 与 v0.8 的蓝球转移矩阵、predict?filter=1 的静态形态过滤互补：这里回答「下期大概率什么形态」
export function shapeTrans(kind, draws, opts = {}) {
  const s = specOf(kind);
  if (s.type !== "pool") {
    return { kind, name: s && s.name, note: "该彩种不支持形态转移", disclaimer: DISCLAIMER };
  }
  const pick = s.main.pick, min = s.main.min, max = s.main.max;
  const minSum = pick * min, range = pick * (max - min);
  const lo = minSum + range / 3, hi = minSum + 2 * range / 3; // 和值三等分档位
  const mid = (min + max) / 2;
  const asc = draws.slice(0, Math.max(60, Math.min(opts.window || 400, 600))).slice().reverse(); // 旧→新，窗口封顶防 CPU
  const shapeOf = d => {
    const nums = mainOf(d, kind).map(Number);
    if (!nums.length) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    const odd = nums.filter(x => x % 2 === 1).length;
    const big = nums.filter(x => x > mid).length;
    const r = [0, 0, 0]; nums.forEach(x => r[x % 3]++);
    return {
      sum: sum < lo ? "低和值" : sum > hi ? "高和值" : "中和值",
      odd: odd * 3 <= pick ? "偏偶" : odd * 3 >= pick * 2 ? "偏奇" : "均衡",
      big: big * 3 <= pick ? "偏小" : big * 3 >= pick * 2 ? "偏大" : "均衡",
      r012: "路" + r.indexOf(Math.max(...r))
    };
  };
  const DIMS = ["sum", "odd", "big", "r012"];
  const cnt = {}; for (const dim of DIMS) cnt[dim] = {};
  const lastShape = {};
  let prev = null;
  for (const d of asc) {
    const cur = shapeOf(d);
    if (!cur) continue;
    if (prev) {
      for (const dim of DIMS) {
        const f = cnt[dim][prev[dim]] || (cnt[dim][prev[dim]] = {});
        f[cur[dim]] = (f[cur[dim]] || 0) + 1;
      }
    }
    for (const dim of DIMS) lastShape[dim] = cur[dim];
    prev = cur;
  }
  const out = { kind, name: s.name, type: s.type, window: asc.length, disclaimer: DISCLAIMER };
  for (const dim of DIMS) {
    const from = cnt[dim][lastShape[dim]] || {};
    const total = Object.values(from).reduce((a, b) => a + b, 0);
    const next = Object.entries(from).map(([to, n]) => ({ shape: to, p: +((n + 1) / (total + 3)).toFixed(3) }))
      .sort((a, b) => b.p - a.p).slice(0, 3);
    out[dim] = { last: lastShape[dim] || null, transitions: total, next, matrix: cnt[dim] };
  }
  out.note = "一阶转移 + 拉普拉斯平滑；「上一期形态 → 下一期最可能的形态」，样本稀疏时仅供参考";
  return out;
}
