import { normNums } from "./small.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const D500 = (n) => `https://datachart.500.com/dlt/history/newinc/history.php?limit=${n}`;
export async function fetchDLT(limit = 100) {
  const r = await fetch(D500(limit), { headers: { "User-Agent": UA, "Accept": "text/html" } });
  if (!r.ok) throw new Error("dlt500 http " + r.status);
  const html = await r.text();
  const trs = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  const out = [];
  for (const tr of trs) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
    if (tds.length >= 9 && /^\d{5}$/.test(tds[1] || "")) {
      const front = [2, 3, 4, 5, 6].map(i => parseInt(tds[i], 10)).sort((a, b) => a - b);
      const back = [7, 8].map(i => parseInt(tds[i], 10)).sort((a, b) => a - b);
      const d = { code: tds[1], front, back, date: "", src: "500" };
      if (validDLT(d)) out.push(normDLT(d));
    }
  }
  return out;
}
export function validDLT(d) {
  if (!d || !/^\d{5}$/.test(String(d.code || ""))) return false;
  if (!Array.isArray(d.front) || d.front.length !== 5 || new Set(d.front).size !== 5) return false;
  if (!d.front.every(x => x >= 1 && x <= 35)) return false;
  if (!Array.isArray(d.back) || d.back.length !== 2 || new Set(d.back).size !== 2) return false;
  if (!d.back.every(x => x >= 1 && x <= 12)) return false;
  return true;
}
export function normDLT(d) {
  return { code: String(d.code), front: d.front.map(x => String(x).padStart(2, "0")), back: d.back.map(x => String(x).padStart(2, "0")), date: d.date || "", src: d.src || "" };
}
export function analyzeDLT(draws, win = 30) {
  const s = draws.slice(0, win), ff = {}, bf = {};
  for (const d of s) { for (const x of d.front) ff[x] = (ff[x] || 0) + 1; for (const x of d.back) bf[x] = (bf[x] || 0) + 1; }
  return { window: win, count: s.length, hotFront: Object.entries(ff).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]), hotBack: Object.entries(bf).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]), frontFreq: ff, backFreq: bf };
}
export function verifyDLT(draws, code, front, back) {
  const d = draws.find(x => x.code === String(code || "").trim());
  if (!d) return { hit: false, note: "期号不存在" };
  // 归一化：用户输入的 "5" 必须能匹配库里的 "05"
  const F = normNums(front), B = normNums(back);
  const hf = new Set(F.filter(x => d.front.includes(x))).size;
  const hb = new Set(B.filter(x => d.back.includes(x))).size;
  return { hit: true, actual: d, hitFront: hf, hitBack: hb, input: { front: F, back: B } };
}
export async function fetch17500DLT() {
  const r = await fetch("http://data.17500.cn/dlt_asc.txt", { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("17500dlt http " + r.status);
  const t = await r.text(), out = [];
  for (const ln of t.split(/\r?\n/)) {
    const p = ln.trim().split(/\s+/).filter(Boolean);
    if (p.length >= 9 && /^\d{5}$/.test(p[0])) {
      const front = p.slice(2, 7).map(x => parseInt(x, 10)).sort((a, b) => a - b);
      const back = p.slice(7, 9).map(x => parseInt(x, 10)).sort((a, b) => a - b);
      const d = { code: p[0], front, back, date: p[1] || "", src: "17500" };
      if (validDLT(d)) out.push(normDLT(d));
    }
  }
  return out.reverse();
}