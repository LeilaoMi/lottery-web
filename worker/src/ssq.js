const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CWL_INDEX = "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/";
const CWL_API = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=100&pageNo=1&pageSize=100&systemType=PC";
const T500 = (n) => `https://datachart.500.com/ssq/history/newinc/history.php?limit=${n}`;
const T17500 = "http://data.17500.cn/ssq_asc.txt";

export async function fetch500(limit = 100) {
  const r = await fetch(T500(limit), { headers: { "User-Agent": UA, "Accept": "text/html" } });
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
    const i = await fetch(CWL_INDEX, { headers: { "User-Agent": UA, "Referer": "https://www.cwl.gov.cn/" }, redirect: "follow" });
    const sc = i.headers.get("set-cookie") || "";
    const m = sc.match(/(JSESSIONID|SESSION|_session[^=]*)=[^;]+/i);
    if (m) cookie = m[0];
    await i.text().catch(() => {});
  } catch {}
  const r = await fetch(CWL_API, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": CWL_INDEX, ...(cookie ? { "Cookie": cookie } : {}) } });
  if (!r.ok) throw new Error("cwl http " + r.status);
  const j = await r.json();
  const items = j.result || [];
  return items.map(it => ({ code: String(it.code || "").trim(), red: String(it.red || "").split(",").map(x => parseInt(x, 10)).sort((a, b) => a - b), blue: parseInt(it.blue, 10), date: String(it.date || "").split("(")[0], src: "cwl" })).filter(valid).map(norm);
}

export async function fetch17500() {
  const r = await fetch(T17500, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("17500 http " + r.status);
  const t = await r.text();
  const out = [];
  for (const ln of t.split(/\r?\n/).slice(0, 200)) {
    const p = ln.trim().split(/[\s,;|]+/).filter(Boolean);
    if (p.length >= 8 && /^\d{5,7}$/.test(p[0])) {
      const reds = p.slice(1, 7).map(x => parseInt(x, 10)).sort((a, b) => a - b);
      const blue = parseInt(p[7], 10);
      const d = { code: p[0], red: reds, blue, date: "", src: "17500" };
      if (valid(d)) out.push(norm(d));
    }
  }
  return out;
}

export function valid(d) {
  if (!d || !/^\d{5,7}$/.test(String(d.code || ""))) return false;
  if (!Array.isArray(d.red) || d.red.length !== 6) return false;
  if (new Set(d.red).size !== 6) return false;
  if (!d.red.every(x => x >= 1 && x <= 33)) return false;
  if (!(d.blue >= 1 && d.blue <= 16)) return false;
  return true;
}
export function norm(d) {
  return { code: String(d.code), red: d.red.map(x => String(x).padStart(2, "0")), blue: String(d.blue).padStart(2, "0"), date: d.date || "", src: d.src || "" };
}

export function analyze(draws, win = 30) {
  const s = draws.slice(0, win);
  const rf = {}, bf = {};
  let odd = 0, sum = 0;
  for (const d of s) {
    for (const r of d.red) { rf[r] = (rf[r] || 0) + 1; if (parseInt(r) % 2) odd++; sum += parseInt(r); }
    bf[d.blue] = (bf[d.blue] || 0) + 1;
  }
  const hotR = Object.entries(rf).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
  const coldR = Object.keys(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [String(i + 1).padStart(2, "0"), 0]))).filter(k => !rf[k]).slice(0, 6);
  return { window: win, count: s.length, hotRed: hotR, coldRed: coldR, redFreq: rf, blueFreq: bf, oddRatio: odd + ":" + (s.length * 6 - odd), avgSum: Math.round(sum / Math.max(1, s.length)) };
}

export function blueScores(draws) {
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
  const out = {};
  for (let b = 1; b <= 16; b++) {
    const k = String(b).padStart(2, "0");
    const sMiss = miss[k] >= 40 ? 2.5 : miss[k] >= 20 ? 1.8 : miss[k] <= 3 ? 0.8 : 1.0;
    const sHeat = 0.5 + freq[k] / maxF;
    const oddP = last10.filter(d => parseInt(d.blue) % 2).length / Math.max(1, last10.length);
    const wantOdd = (0.5 + (0.5 - oddP) * 0.4) > 0.5 ? 1 : 0;
    const sPar = ((parseInt(k) % 2) === wantOdd) ? 1.2 : 0.8;
    const sReg = Math.min(Math.abs(parseInt(k) - mean10) * 0.1, 0.5) + 0.8;
    let s = sMiss * 0.25 + sHeat * 0.20 + sPar * 0.15 + 1.0 * 0.10 + 1.0 * 0.10 + sReg * 0.10;
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
  const d = draws.find(x => x.code === String(code));
  if (!d) return { hit: false, note: "期号不存在" };
  const hr = red.filter(x => d.red.includes(x)).length, hb = (blue === d.blue);
  return { hit: true, actual: d, hitRed: hr, hitBlue: hb };
}