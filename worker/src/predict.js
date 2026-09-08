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
export function killList(kind, draws) {
  const s = specOf(kind);
  if (s.type === "digit") return killDigits(kind, draws);
  const pool = poolOf(s.main), votes = {}, why = {};
  for (const k of pool) { votes[k] = 0; why[k] = []; }
  const add = (k, v, r) => {
    if (votes[k] === undefined) return;
    votes[k] += v; why[k].push(r);
  };
  const last = draws[0], prev = draws[1];
  if (!last) return { main: [], aux: [] };
  const N = mainOf(last, kind).map(Number).sort((a, b) => a - b);
  const sum = N.reduce((a, b) => a + b, 0), span = N[N.length - 1] - N[0];
  const zones = zonesOf(s.main);

  for (const x of N) add(pad2(x), 1, "上期出号");                                  // 1 上期号
  for (const x of N) { add(pad2(x + 1), 0.5, "邻号"); add(pad2(x - 1), 0.5, "邻号"); } // 2 邻号
  const st = freqStats(draws, pool, d => mainOf(d, kind));
  const tail = sum % 10;
  for (const k of pool) if (Number(k) % 10 === tail) add(k, 1, "和值尾" + tail);   // 3 和值尾
  for (const v of [span - 1, span, span + 1]) add(pad2(v), 1, "跨度" + span);      // 4 跨度
  add(pad2(N[N.length - 1] + 1), 1, "极号+1");                                     // 5 极大+1
  add(pad2(N[0] - 1), 1, "极号-1");                                                // 5 极小-1
  const tailCnt = {};
  for (const x of N) tailCnt[x % 10] = (tailCnt[x % 10] || 0) + 1;
  const hotTail = +Object.entries(tailCnt).sort((a, b) => b[1] - a[1])[0][0];
  for (const k of pool) if (Number(k) % 10 === hotTail) add(k, 0.5, "热尾" + hotTail); // 6 热尾
  const road = [0, 0, 0];
  for (const x of N) road[x % 3]++;
  const coldRoad = road.indexOf(Math.min(...road));
  for (const k of pool) if (Number(k) % 3 === coldRoad) add(k, 0.5, "冷路" + coldRoad);  // 7 冷012路
  const primeCnt = N.filter(x => PRIMES.has(x)).length;
  if (primeCnt >= Math.ceil(N.length * 2 / 3)) { for (const k of pool) if (PRIMES.has(Number(k))) add(k, 0.5, "质数过多"); }
  else if (primeCnt <= Math.floor(N.length / 3)) { for (const k of pool) if (!PRIMES.has(Number(k)) && Number(k) > 1) add(k, 0.5, "合数过多"); } // 8 质合
  const zc = [0, 0, 0];
  for (const x of N) zc[zoneIdx(zones, x)]++;
  const hotZone = zc.indexOf(Math.max(...zc));
  for (const k of pool) if (zoneIdx(zones, Number(k)) === hotZone) add(k, 0.5, "热区" + (hotZone + 1)); // 9 热区
  if (prev) for (const x of mainOf(prev, kind)) add(pad2(Number(x)), 0.3, "上上期号");                 // 10 上上期

  const main = pool.map(k => ({ n: k, votes: +votes[k].toFixed(2), reasons: [...new Set(why[k])] }))
    .filter(x => x.votes > 0).sort((a, b) => b.votes - a.votes || Number(a.n) - Number(b.n));
  const aux = s.aux ? killAux(kind, draws) : [];
  return { main, aux, threshold: killThreshold(main) };
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
export function danList(kind, draws, win = 30) {
  const s = specOf(kind);
  if (s.type === "digit") return danDigits(kind, draws, win);
  const w = draws.slice(0, win), pool = poolOf(s.main);
  const st = freqStats(w, pool, d => mainOf(d, kind));
  const last = draws[0] || { }, lastN = mainOf(last, kind);
  const near = new Set();
  for (const x of lastN) { near.add(pad2(Number(x) + 1)); near.add(pad2(Number(x) - 1)); }
  const maxF = Math.max(1, ...Object.values(st.freq));
  const sc = pool.map(k => {
    const n = Number(k), f = st.freq[k], c = st.cur[k], a = st.avg[k];
    let v = (f / maxF) * 2;                                   // 频率
    if (a > 0 && c >= a * 0.8 && c <= a * 1.4) v += 1.2;      // 遗漏到达均值区（该出）
    else if (a > 0 && c > a * 2) v += 0.4;                    // 超长遗漏微弱加分
    if (near.has(k)) v += 0.6;                                // 上期邻号
    if (lastN.includes(k) && f / maxF > 0.6) v += 0.8;        // 热重号
    return { n: k, score: +v.toFixed(3), freq: f, cur: c, avg: a, max: st.max[k] };
  }).sort((a, b) => b.score - a.score);
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
  return {
    window: win, count: w.length,
    hot: byFreq.slice(0, pick), cold: byFreq.slice(-pick).reverse(),
    freq: st.freq, omission: { cur: st.cur, avg: st.avg, max: st.max },
    auxFreq: auxSt ? auxSt.freq : {}, auxOmission: auxSt ? { cur: auxSt.cur, avg: auxSt.avg, max: auxSt.max } : {},
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
    const main = pickN(arr.filter(x => !isNaN(Number(x))), n).slice(0, n);
    // 结构分按「实际选号个数」评估：快乐8 选 8 个时不能用开奖 20 个号的基准
    const aux = (auxOverride && !auxOverride.some(x => main.includes(x))) ? auxOverride : auxPick(auxIdx, main);
    return { name, main, aux, score: structScore(main, { ...s.main, pick: main.length }), note };
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
      const cand = order.find(k => !out.includes(k) && Number(k) >= z.from && Number(k) <= z.to && (!kind || true));
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
