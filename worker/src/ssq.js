import { normNums, pad2 } from "./small.js";
import { fetchT, BULK_MS } from "./net.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CWL_INDEX = "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/";
const CWL_API = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=100&pageNo=1&pageSize=100&systemType=PC";
const T500 = (n) => `https://datachart.500.com/ssq/history/newinc/history.php?limit=${n}`;
const T17500 = "http://data.17500.cn/ssq_asc.txt";

export async function fetch500(limit = 100) {
  const r = await fetchT(T500(limit), { headers: { "User-Agent": UA, "Accept": "text/html" } });
  if (!r.ok) throw new Error("500 http " + r.status);
  const html = await r.text();
  const trs = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  const out = [];
  for (const tr of trs) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
    if (tds.length >= 10 && /^\d{5,7}$/.test(tds[1] || "")) {
      const reds = [2, 3, 4, 5, 6, 7].map(i => parseInt(tds[i], 10)).sort((a, b) => a - b);
      const blue = parseInt(tds[8], 10);
      const d = { code: tds[1], red: reds, blue, date: tds[tds.length - 1] || "", src: "500" };
      if (valid(d)) out.push(norm(d));
    }
  }
  return out;
}

export async function fetchCWL() {
  // Workers无cookie jar，手动两步
  let cookie = "";
  try {
    const i = await fetchT(CWL_INDEX, { headers: { "User-Agent": UA, "Referer": "https://www.cwl.gov.cn/" }, redirect: "follow" });
    const sc = i.headers.get("set-cookie") || "";
    const m = sc.match(/(JSESSIONID|SESSION|_session[^=]*)=[^;]+/i);
    if (m) cookie = m[0];
    await i.text().catch(() => {});
  } catch {}
  const r = await fetchT(CWL_API, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": CWL_INDEX, ...(cookie ? { "Cookie": cookie } : {}) } });
  if (!r.ok) throw new Error("cwl http " + r.status);
  const j = await r.json();
  const items = j.result || [];
  return items.map(it => ({ code: String(it.code || "").trim(), red: String(it.red || "").split(",").map(x => parseInt(x, 10)).sort((a, b) => a - b), blue: parseInt(it.blue, 10), date: String(it.date || "").split("(")[0], src: "cwl" })).filter(valid).map(norm);
}

// 独立出来便于离线回归测试：列格式为「期号 日期 红1..红6 蓝 …」
export function parse17500(text, limit = 200) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  // 列格式：期号 日期 红1..红6 蓝 （其后为排序号与奖金，忽略）
  // 旧实现按「无日期列」解析，红球/蓝球整体错位一列；且从文件头取数拿到的是 2003 年老数据
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const p = lines[i].trim().split(/[\s,;|]+/).filter(Boolean);
    if (p.length < 9 || !/^\d{7}$/.test(p[0])) continue;
    const reds = p.slice(2, 8).map(x => parseInt(x, 10)).sort((a, b) => a - b);
    const blue = parseInt(p[8], 10);
    const d = { code: p[0], red: reds, blue, date: p[1] || "", src: "17500" };
    if (valid(d)) out.push(norm(d));
  }
  return out;
}

export async function fetch17500(limit = 200) {
  const r = await fetchT(T17500, { headers: { "User-Agent": UA } }, BULK_MS);
  if (!r.ok) throw new Error("17500 http " + r.status);
  return parse17500(await r.text(), limit);
}

export function valid(d) {
  if (!d || !/^\d{5,7}$/.test(String(d.code || ""))) return false;
  if (!Array.isArray(d.red) || d.red.length !== 6) return false;
  if (new Set(d.red).size !== 6) return false;
  if (!d.red.every(x => x >= 1 && x <= 33)) return false;
  if (!(d.blue >= 1 && d.blue <= 16)) return false;
  return true;
}
// 期号归一化：500.com 用「2位年+序号」5 位（26103），cwl/17500 用 7 位（2026103）。
// 不统一会导致双源一致性永远为 false，且按期号验奖时命中不到。
export function normCode(code) {
  const c = String(code || "").trim();
  if (/^\d{7}$/.test(c)) return c;
  if (/^\d{5}$/.test(c)) return "20" + c;
  return c;
}
export function norm(d) {
  return { code: normCode(d.code), red: d.red.map(x => String(x).padStart(2, "0")), blue: String(d.blue).padStart(2, "0"), date: d.date || "", src: d.src || "" };
}

const PRIMES = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31]);
const REDS = Array.from({ length: 33 }, (_, i) => pad2(i + 1));

// AC 值：号码两两差值的不同个数 - (个数-1)，衡量号码离散程度
function acValue(n) {
  const diffs = new Set();
  for (let i = 0; i < n.length; i++) for (let j = i + 1; j < n.length; j++) diffs.add(Math.abs(n[i] - n[j]));
  return diffs.size - (n.length - 1);
}

// 每个红球的历史间隔（遗漏）序列统计
function gapStats(draws) {
  const lastSeen = {}, gaps = {}, cur = {};
  for (const k of REDS) { lastSeen[k] = null; gaps[k] = []; cur[k] = 0; }
  // draws 由新到旧，转成由旧到新便于算间隔
  const asc = draws.slice().reverse();
  asc.forEach((d, i) => {
    for (const k of REDS) {
      if (d.red.includes(k)) {
        if (lastSeen[k] !== null) gaps[k].push(i - lastSeen[k] - 1);
        lastSeen[k] = i;
      }
    }
  });
  const desc = draws;
  for (const k of REDS) { let m = 0; for (const d of desc) { if (d.red.includes(k)) break; m++; } cur[k] = m; }
  const avg = {}, max = {};
  for (const k of REDS) {
    const g = gaps[k];
    avg[k] = g.length ? +(g.reduce((a, b) => a + b, 0) / g.length).toFixed(2) : desc.length;
    max[k] = g.length ? Math.max(...g) : desc.length;
  }
  return { cur, avg, max };
}

export function analyze(draws, win = 30) {
  const s = draws.slice(0, win);
  const rf = {}, bf = {}, tail = {}, road = { "0": 0, "1": 0, "2": 0 };
  for (const k of REDS) rf[k] = 0;
  let odd = 0, sum = 0, prime = 0, consec = 0, repeat = 0, acSum = 0;

  s.forEach((d, i) => {
    const n = d.red.map(Number);
    for (const r of d.red) rf[r] = (rf[r] || 0) + 1;
    bf[d.blue] = (bf[d.blue] || 0) + 1;
    odd += n.filter(x => x % 2).length;
    prime += n.filter(x => PRIMES.has(x)).length;
    sum += n.reduce((a, b) => a + b, 0);
    acSum += acValue(n);
    for (const x of n) { road[x % 3]++; const t = x % 10; tail[t] = (tail[t] || 0) + 1; }
    for (let j = 1; j < n.length; j++) if (n[j] - n[j - 1] === 1) consec++;
    if (i + 1 < s.length) { const prev = new Set(s[i + 1].red); repeat += d.red.filter(x => prev.has(x)).length; }
  });

  const cnt = Math.max(1, s.length);
  const byFreq = REDS.slice().sort((a, b) => rf[b] - rf[a] || Number(a) - Number(b));
  const g = gapStats(draws);

  return {
    window: win,
    count: s.length,
    hotRed: byFreq.slice(0, 6),
    coldRed: byFreq.slice(-6).reverse(),
    redFreq: rf,
    blueFreq: bf,
    oddRatio: odd + ":" + (s.length * 6 - odd),
    avgSum: Math.round(sum / cnt),
    avgAC: +(acSum / cnt).toFixed(2),
    primeRatio: prime + ":" + (s.length * 6 - prime),
    road012: road,
    tail,
    avgConsec: +(consec / cnt).toFixed(2),
    avgRepeat: +(repeat / cnt).toFixed(2),
    omission: g
  };
}

export function blueScores(draws) {
  const empty = { scores: {}, ranked: [], top1: "01", pool: [], coldChase: [] };
  if (!draws || !draws.length) return empty;
  const last20 = draws.slice(0, 20), last10 = draws.slice(0, 10), last5 = draws.slice(0, 5);
  const miss = {}, freq = {};
  for (let b = 1; b <= 16; b++) {
    const k = String(b).padStart(2, "0");
    let m = 0;
    for (const d of draws) { if (d.blue === k) break; m++; }
    miss[k] = m; freq[k] = last20.filter(d => d.blue === k).length;
  }
  const maxF = Math.max(1, ...Object.values(freq));
  const mean10 = last10.reduce((a, d) => a + parseInt(d.blue), 0) / Math.max(1, last10.length);
  const lastBlue = parseInt(draws[0]?.blue || "0", 10);
  const lastZone = Math.max(1, Math.ceil(lastBlue / 4));
  const out = {};
  for (let b = 1; b <= 16; b++) {
    const k = String(b).padStart(2, "0");
    const sMiss = miss[k] >= 40 ? 2.5 : miss[k] >= 20 ? 1.8 : miss[k] <= 3 ? 0.8 : 1.0;
    const sHeat = 0.5 + freq[k] / maxF;
    const oddP = last10.filter(d => parseInt(d.blue) % 2).length / Math.max(1, last10.length);
    const wantOdd = (0.5 + (0.5 - oddP) * 0.4) > 0.5 ? 1 : 0;
    const sPar = ((parseInt(k) % 2) === wantOdd) ? 1.2 : 0.8;
    const sReg = Math.min(Math.abs(parseInt(k) - mean10) * 0.1, 0.5) + 0.8;
    // 邻号维度：与上期蓝球相邻的号（±1）历史上更常出现；重复上期则降权
    const dv = Math.abs(parseInt(k) - lastBlue);
    const sNeigh = dv === 1 ? 1.3 : dv === 0 ? 0.9 : 1.0;
    // 区间均衡：1-4/5-8/9-12/13-16 四区，避开上期所在区
    const sZone = Math.ceil(parseInt(k) / 4) === lastZone ? 0.9 : 1.15;
    let s = sMiss * 0.25 + sHeat * 0.20 + sPar * 0.15 + sNeigh * 0.10 + sZone * 0.10 + sReg * 0.10;
    const rep = last5.filter(d => d.blue === k).length;
    if (rep >= 2) s *= 0.7; else if (rep === 0) s *= 1.05;
    out[k] = +s.toFixed(3);
  }
  const ranked = Object.entries(out).sort((a, b) => b[1] - a[1]);
  return { scores: out, ranked, top1: ranked[0][0], pool: ranked.slice(0, 6).map(x => x[0]), coldChase: Object.keys(miss).filter(k => miss[k] >= 20) };
}

export function recommend(draws) {
  const st = analyze(draws, 30);
  const bl = blueScores(draws);
  const lastRed = new Set(draws[0] ? draws[0].red : []);
  const pool = [...st.hotRed, ...Object.entries(st.redFreq).sort((a, b) => b[1] - a[1]).slice(0, 15).map(x => x[0])];
  const uniq = [...new Set(pool)].filter(x => !lastRed.has(x));
  const pick = (n, arr) => [...new Set(arr)].sort(() => Math.random() - 0.5).slice(0, n).sort();
  const pickCover = () => {
    const a = [...new Set([pick(1, range(1, 11))[0], pick(1, range(12, 22))[0], pick(1, range(23, 33))[0], ...uniq].filter(Boolean))];
    const out = [...a.slice(0, 3)];
    for (const x of [...uniq].sort(() => Math.random() - 0.5)) { if (out.length >= 6) break; if (!out.includes(x)) out.push(x); }
    for (let i = 1; out.length < 6 && i <= 33; i++) { const k = String(i).padStart(2, "0"); if (!out.includes(k) && !lastRed.has(k)) out.push(k); }
    return out.sort().slice(0, 6);
  };
  const r = [
    { name: "稳健·热号", red: pick(6, uniq.slice(0, 15)), blue: bl.ranked.find(x => x[0] !== draws[0]?.blue)?.[0] || bl.top1 },
    { name: "进取·遗漏", red: pick(6, uniq.slice().reverse().slice(0, 15)), blue: bl.coldChase[0] || bl.top1 },
    { name: "均衡", red: pick(6, uniq), blue: bl.top1 },
    { name: "区间覆盖", red: pickCover(), blue: bl.pool[1] || bl.top1 },
    { name: "冷热加权", red: pick(6, uniq), blue: bl.pool[2] || bl.top1 },
    { name: "随机基准", red: pick(6, Array.from({ length: 33 }, (_, i) => String(i + 1).padStart(2, "0"))), blue: String(1 + Math.floor(Math.random() * 16)).padStart(2, "0") }
  ];
  return { disclaimer: "随机游戏，统计仅供娱乐，不保证中奖", analysis: st, blue: { top1: bl.top1, pool: bl.pool }, picks: r.map(x => ({ ...x, score: structScore(x.red) })) };
}
function range(a, b) { const o = []; for (let i = a; i <= b; i++) o.push(String(i).padStart(2, "0")); return o; }
export function structScore(red) {
  const n = red.map(x => parseInt(x)), sum = n.reduce((a, b) => a + b, 0);
  let s = 0;
  if (sum >= 70 && sum <= 140) s += 3;
  const odd = n.filter(x => x % 2).length;
  if ([2, 3, 4].includes(odd)) s += 2;
  if ([2, 3, 4].includes(n.filter(x => x > 16).length)) s += 2;
  const z = [n.filter(x => x <= 11).length > 0, n.filter(x => x >= 12 && x <= 22).length > 0, n.filter(x => x >= 23).length > 0].filter(Boolean).length;
  if (z === 3) s += 2;
  const span = Math.max(...n) - Math.min(...n);
  if (span >= 20 && span <= 30) s += 1;
  return s;
}
export function trend(draws, win = 30) {
  const s = draws.slice(0, win).reverse(), miss = {};
  for (let i = 1; i <= 33; i++) miss[String(i).padStart(2, "0")] = 0;
  return s.map(d => {
    const row = { code: d.code, red: d.red, blue: d.blue };
    const cur = {};
    for (const k in miss) { if (d.red.includes(k)) { cur[k] = 0; miss[k] = 0; } else { miss[k]++; cur[k] = miss[k]; } }
    row.miss = { ...cur }; return row;
  });
}
export function verify(draws, code, red, blue) {
  const target = normCode(code);
  const d = draws.find(x => normCode(x.code) === target);
  if (!d) return { hit: false, note: "期号不存在" };
  // 归一化：用户输入的 "1" 必须能匹配库里的 "01"
  const R = normNums(red);
  const B = blue ? (normNums([blue])[0] || "") : "";
  const hr = new Set(R.filter(x => d.red.includes(x))).size;
  const hb = B === d.blue;
  return { hit: true, actual: d, hitRed: hr, hitBlue: hb, input: { red: R, blue: B } };
}