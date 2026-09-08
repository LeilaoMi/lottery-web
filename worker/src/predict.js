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

export function specOf(kind) {
  const s = SPECS[kind];
  if (!s) throw new Error("unknown kind " + kind);
  return s;
}
export function poolOf(zone) { const o = []; for (let i = zone.min; i <= zone.max; i++) o.push(pad2(i)); return o; }

// 取一期的号码：统一成「字符串数组」，屏蔽各彩种字段差异
export function mainOf(d, kind) {
  const s = specOf(kind);
  if (s.type === "digit") return (d[s.fMain] || []).map(x => String(x));
  const v = d[s.fMain];
  return (Array.isArray(v) ? v : v ? [v] : []).map(x => pad2(Number(String(x).trim())));
}
export function auxOf(d, kind) {
  const s = specOf(kind);
  if (!s.fAux) return [];
  const v = d[s.fAux];
  return (Array.isArray(v) ? v : v ? [v] : []).map(x => pad2(Number(String(x).trim())));
}

function uniqSorted(a) { return [...new Set(a)].sort(); }
// 先去重再抽样：否则候选池里带重复项时「先切 n 个再去重」会不足 n 个
function pickN(arr, n) { return [...new Set(arr)].sort(() => Math.random() - 0.5).slice(0, n).sort(); }

export function acValue(nums) {
  const n = nums.map(Number), set = new Set();
  for (let i = 0; i < n.length; i++) for (let j = i + 1; j < n.length; j++) set.add(Math.abs(n[i] - n[j]));
  return set.size - (n.length - 1);
}

// 频率 + 遗漏（遗漏：当前未出现期数 / 历史平均间隔 / 历史最大间隔）
function freqStats(draws, pool, getNums) {
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
  const cur = {}, avg = {}, max = {};
  for (const k of pool) {
    let m = 0;
    for (const d of draws) { if (getNums(d).includes(k)) break; m++; }
    cur[k] = m;
    const g = gaps[k];
    avg[k] = g.length ? +(g.reduce((a, b) => a + b, 0) / g.length).toFixed(2) : draws.length;
    max[k] = g.length ? Math.max(...g) : draws.length;
  }
  return { freq, cur, avg, max };
}

function zonesOf(zone) {
  const { min, max } = zone, span = max - min + 1, w = Math.ceil(span / 3);
  return [0, 1, 2].map(i => ({ i, from: min + i * w, to: Math.min(max, min + (i + 1) * w - 1) }));
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
  const pool = poolOf(s.main), votes = {}, raw = {}, why = {};
  for (const k of pool) { votes[k] = 0; raw[k] = {}; why[k] = []; }
  const w = opts.weights || {};
  const add = (k, v, key, label) => {
    if (votes[k] === undefined) return;
    raw[k][key] = (raw[k][key] || 0) + v;          // 原始票：分公式统计用，不受权重影响
    const wv = w[key] !== undefined ? w[key] : 1;
    votes[k] += v * wv;
    if (v * wv > 0) why[k].push(label);            // 权重为 0 的公式不算实际贡献，不进 reasons
  };
  const last = draws[0], prev = draws[1];
  if (!last) return { main: [], aux: [] };
  const N = mainOf(last, kind).map(Number).sort((a, b) => a - b);
  const sum = N.reduce((a, b) => a + b, 0), span = N[N.length - 1] - N[0];
  const zones = zonesOf(s.main);

  for (const x of N) add(pad2(x), 1, "last", "上期出号");                              // 1 上期号
  for (const x of N) { add(pad2(x + 1), 0.5, "neighbor", "邻号"); add(pad2(x - 1), 0.5, "neighbor", "邻号"); } // 2 邻号
  const st = freqStats(draws, pool, d => mainOf(d, kind));
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

  const main = pool.map(k => ({ n: k, votes: +votes[k].toFixed(2), reasons: [...new Set(why[k])] }))
    .filter(x => x.votes > 0).sort((a, b) => b.votes - a.votes || Number(a.n) - Number(b.n));
  const aux = s.aux ? killAux(kind, draws) : [];
  const out = { main, aux, threshold: killThreshold(main) };
  if (opts.perFormula) {
    out.byFormula = {};
    for (const key of Object.keys(FORMULAS)) {
      out.byFormula[key] = pool.filter(k => raw[k][key] > 0)
        .sort((a, b) => raw[b][key] - raw[a][key] || Number(a) - Number(b));
    }
  }
  return out;
}
function killThreshold(list) {
  if (!list.length) return 99;
  const v = list.map(x => x.votes).sort((a, b) => b - a);
  return +(v[Math.min(v.length - 1, Math.floor(v.length * 0.3))] || 0).toFixed(2);
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
    const digits = Array.from({ length: 10 }, (_, i) => String(i));
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
    const digits = Array.from({ length: 10 }, (_, i) => String(i));
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
    const digits = Array.from({ length: 10 }, (_, i) => String(i));
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
    mk("稳健·热号", byFreqDesc.slice(0, Math.max(n + 4, 10)), "近" + win + "期高频号为主", 0),
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
      const om = an.perPos[p].omission, digits = Array.from({ length: 10 }, (_, i) => String(i));
      return digits.slice().sort((a, b) => Math.abs(om.cur[a] - om.avg[a]) - Math.abs(om.cur[b] - om.avg[b]))[0];
    }, "遗漏最接近历史均值"),
    mk("随机基准", () => String(Math.floor(Math.random() * 10)), "纯随机对照")
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
//  - 热号/冷号/胆码复用 scorePool 的同一打分；杀号直接复用 killList，保证「线上给什么、回测验什么」
//  - 输出均带随机基线：单号命中率 = pick/poolSize；命中低于基线才有信息量（尤其杀号）
export function backtest(kind, draws, opts = {}) {
  const s = specOf(kind);
  const N = Array.isArray(draws) ? draws.length : 0;
  const warmup = Math.max(10, Math.min(opts.warmup || 30, Math.max(1, N - 1)));
  const win = Math.max(10, Math.min(opts.win || 30, 60));
  const maxP = Math.max(0, Math.min(40, N - warmup));
  const periods = Math.max(0, Math.min(opts.periods || 15, maxP));
  const note = "纯统计对照，不构成任何预测保证；某项长期优于基线也不代表未来有效";
  if (N < warmup + 1 || periods <= 0) return { kind, name: s.name, type: s.type, periods: 0, note: "样本不足，无法回测", disclaimer: DISCLAIMER };
  if (s.type === "digit") return backtestDigit(kind, draws, { warmup, win, periods, note });

  const pool = poolOf(s.main), size = pool.length, pick = s.main.pick;
  const guessN = Math.min(s.suggest, size), danK = 8, base = pick / size;
  const hot = { hit: 0 }, cold = { hit: 0 }, dan = { hit: 0 };
  const kill = { killed: 0, hit: 0 };
  const killAgg = {};
  const aux = s.aux ? { pick: s.aux.pick, size: s.aux.max - s.aux.min + 1, hot: { hit: 0 }, kill: { killed: 0, hit: 0 } } : null;
  let tested = 0;
  // draws 由新到旧：测试最近的 periods 期，即 i = periods-1 .. 0，历史为 draws[i+1..]
  for (let i = Math.min(periods, N) - 1; i >= 0; i--) {
    const hist = draws.slice(i + 1);
    if (hist.length < warmup) continue;
    const actual = new Set(mainOf(draws[i], kind));
    const st = freqStats(hist.slice(0, win), pool, d => mainOf(d, kind));
    const lastN = mainOf(hist[0] || {}, kind);
    const hotTop = pool.slice().sort((a, b) => st.freq[b] - st.freq[a] || Number(a) - Number(b)).slice(0, guessN);
    const coldTop = pool.slice().sort((a, b) => st.cur[b] - st.cur[a] || Number(a) - Number(b)).slice(0, guessN);
    const danTop = scorePool(st, pool, lastN).slice(0, danK).map(x => x.n);
    hot.hit += hotTop.filter(k => actual.has(k)).length;
    cold.hit += coldTop.filter(k => actual.has(k)).length;
    dan.hit += danTop.filter(k => actual.has(k)).length;
    const kl = killList(kind, hist, { perFormula: true }), th = kl.threshold ?? 99;
    const killed = (kl.main || []).filter(x => x.votes >= th).map(x => x.n);
    kill.killed += killed.length;
    kill.hit += killed.filter(k => actual.has(k)).length;
    if (kl.byFormula) {
      for (const [key, arr] of Object.entries(kl.byFormula)) {
        const a = killAgg[key] || (killAgg[key] = { killed: 0, hit: 0 });
        a.killed += arr.length;
        a.hit += arr.filter(k => actual.has(k)).length;
      }
    }
    if (aux) {
      const aPool = poolOf(s.aux);
      const aSt = freqStats(hist.slice(0, win), aPool, d => auxOf(d, kind));
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
    kind, name: s.name, type: s.type, periods: tested, warmup, win,
    guessN, pick, poolSize: size, baseline: +base.toFixed(4),
    strategies: {
      hot: { avgHit: +(hot.hit / tested).toFixed(3), hitRate: rate(hot.hit, tested * guessN), baseline: +base.toFixed(4), note: "预测 " + guessN + " 个，单号基线 " + base.toFixed(4) },
      cold: { avgHit: +(cold.hit / tested).toFixed(3), hitRate: rate(cold.hit, tested * guessN), baseline: +base.toFixed(4) },
      dan: { k: danK, avgHit: +(dan.hit / tested).toFixed(3), hitRate: rate(dan.hit, tested * danK), baseline: +(danK * base).toFixed(4) }
    },
    kill: {
      killedTotal: kill.killed, killedHit: kill.hit,
      hitRate: rate(kill.hit, kill.killed), baseline: +base.toFixed(4),
      verdict: kill.killed === 0 ? "无杀号样本" : (kill.hit / kill.killed < base ? "有效（低于随机基线）" : "无信息（不低于随机基线）"),
      formulas: Object.entries(FORMULAS).map(([key, label]) => {
        const a = killAgg[key] || { killed: 0, hit: 0 };
        const r = a.killed > 0 ? +(a.hit / a.killed).toFixed(4) : null;
        return { key, label, killed: a.killed, hit: a.hit, rate: r, baseline: +base.toFixed(4),
          verdict: a.killed === 0 ? "无样本" : (r < base ? "有效" : "无信息") };
      })
    },
    note, disclaimer: DISCLAIMER
  };
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
  const s = specOf(kind), N = draws.length, DIG = Array.from({ length: 10 }, (_, i) => String(i));
  const perPos = Array.from({ length: s.digits }, (_, p) => ({ pos: p + 1, hotHits: 0, coldHits: 0, killTotal: 0, killHit: 0, tested: 0 }));
  for (let i = Math.min(cfg.periods, N) - 1; i >= 0; i--) {
    const hist = draws.slice(i + 1);
    if (hist.length < cfg.warmup) continue;
    const actual = mainOf(draws[i], kind);
    for (let p = 0; p < s.digits; p++) {
      const st = freqStats(hist.slice(0, cfg.win), DIG, d => { const a = mainOf(d, kind); return a[p] !== undefined ? [String(a[p])] : []; });
      const row = perPos[p];
      const hot1 = DIG.slice().sort((a, b) => st.freq[b] - st.freq[a] || Number(a) - Number(b))[0];
      const cold1 = DIG.slice().sort((a, b) => st.cur[b] - st.cur[a] || Number(a) - Number(b))[0];
      row.hotHits += hot1 === String(actual[p]) ? 1 : 0;
      row.coldHits += cold1 === String(actual[p]) ? 1 : 0;
      const kl = killList(kind, hist);
      const k1 = (kl.perPos[p].kill || [])[0];
      if (k1 && k1.votes > 0) { row.killTotal++; row.killHit += k1.n === String(actual[p]) ? 1 : 0; }
      row.tested++;
    }
  }
  return {
    kind, name: s.name, type: s.type, periods: cfg.periods, warmup: cfg.warmup, win: cfg.win,
    baseline: 0.1,
    perPos: perPos.map(r => ({
      pos: r.pos,
      hotRate: +(r.hotHits / Math.max(1, r.tested)).toFixed(3),
      coldRate: +(r.coldHits / Math.max(1, r.tested)).toFixed(3),
      killRate: r.killTotal ? +(r.killHit / r.killTotal).toFixed(3) : null,
      tested: r.tested
    })),
    note: "各位独立 0-9，单位随机基线 10%；killRate 为首位杀号命中开奖的比例，越低越好", disclaimer: DISCLAIMER
  };
}

// ---------- 校准：按分公式回测命中率生成动态权重 ----------
// rate 越高于基线，权重越低（无效公式自动降权）；权重区间 [0.2, 2]
export function calibrate(kind, draws, opts = {}) {
  const bt = backtest(kind, draws, { periods: opts.periods || 12, warmup: opts.warmup || 30, win: opts.win || 30 });
  const weights = {};
  if (bt.kill && bt.kill.formulas) {
    for (const f of bt.kill.formulas) {
      weights[f.key] = (f.killed === 0 || f.rate == null)
        ? 1
        : Math.max(0.2, Math.min(2, +(2 - f.rate / f.baseline).toFixed(3)));
    }
  }
  return { weights, periods: bt.periods, formulas: (bt.kill && bt.kill.formulas) || [] };
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
