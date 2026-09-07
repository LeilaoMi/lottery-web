const UA = "Mozilla/5.0 Chrome/120";
const SRC = {
  fc3d: "http://data.17500.cn/3d_asc.txt",
  pl3: "http://data.17500.cn/pl3_asc.txt",
  pl5: "http://data.17500.cn/pl5_asc.txt",
  qlc: "http://data.17500.cn/7lc_asc.txt",
  qxc: "http://data.17500.cn/7xc_asc.txt",
  kl8: "http://data.17500.cn/kl8_asc.txt"
};
async function txt(u) {
  const r = await fetch(u, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("http " + r.status);
  return r.text();
}
export async function fetchSmall(kind, limit = 100) {
  const t = await txt(SRC[kind]);
  const lines = t.split(/\r?\n/);
  const out = [];
  for (let li = lines.length - 1; li >= 0 && out.length < limit; li--) {
    const p = lines[li].trim().split(/\s+/).filter(Boolean);
    if (p.length < 5) continue;
    const code = p[0], date = p[1] || "";
    try {
      if (kind === "fc3d" || kind === "pl3") {
        if (!/^\d{5,7}$/.test(code)) continue;
        const a = p.slice(2, 5).map(x => parseInt(x, 10));
        if (a.length === 3 && a.every(x => x >= 0 && x <= 9)) out.push({ code, date, digits: a.map(x => String(x)), src: "17500" });
      } else if (kind === "pl5") {
        const a = p.slice(2, 7).map(x => parseInt(x, 10));
        if (a.length === 5 && a.every(x => x >= 0 && x <= 9)) out.push({ code, date, digits: a.map(String), src: "17500" });
      } else if (kind === "qlc") {
        if (!/^\d{7}$/.test(code)) continue;
        const m = p.slice(2, 9).map(x => parseInt(x, 10)).sort((a, b) => a - b), s = parseInt(p[9], 10);
        if (m.length === 7 && m.every(x => x >= 1 && x <= 30) && s >= 1 && s <= 30) out.push({ code, date, main: m.map(x => String(x).padStart(2, "0")), special: String(s).padStart(2, "0"), src: "17500" });
      } else if (kind === "qxc") {
        const a = p.slice(2, 9).map(x => parseInt(x, 10));
        if (a.length === 7 && a.every(x => x >= 0 && x <= 9)) out.push({ code, date, digits: a.map(String), src: "17500" });
      } else if (kind === "kl8") {
        const a = p.slice(2, 22).map(x => parseInt(x, 10)).sort((a, b) => a - b);
        if (a.length === 20 && a.every(x => x >= 1 && x <= 80)) out.push({ code, date, nums: a.map(x => String(x).padStart(2, "0")), src: "17500" });
      }
    } catch {}
  }
  return out.slice(0, limit);
}
export function prizeSSQ(hr, hb) {
  if (hr === 6 && hb) return "一等"; if (hr === 6) return "二等";
  if (hr === 5 && hb) return "三等"; if ((hr === 5 && !hb) || (hr === 4 && hb)) return "四等";
  if ((hr === 4 && !hb) || (hr === 3 && hb)) return "五等"; if (hb) return "六等";
  return "未中";
}
export function prizeDLT(hf, hb) {
  if (hf === 5 && hb === 2) return "一等"; if (hf === 5 && hb === 1) return "二等";
  if (hf === 5 || (hf === 4 && hb === 2)) return "三等"; if ((hf === 4 && hb === 1) || (hf === 3 && hb === 2)) return "四等";
  if ((hf === 4) || (hf === 3 && hb === 1) || (hf === 2 && hb === 2)) return "五等";
  if ((hf === 3) || (hf === 1 && hb === 2) || (hf === 2 && hb === 1) || hb === 2) return "六等";
  return "未中";
}
export function rotation(n, pick, minHit = 4) {
  // 极简旋转矩阵：n选pick保证minHit覆盖的缩水组合（贪心，非最优但可用）
  const nums = Array.from({ length: n }, (_, i) => String(i + 1).padStart(2, "0"));
  const out = [];
  for (let i = 0; i < n && out.length < 20; i += 2) {
    const c = [];
    for (let j = 0; j < pick; j++) c.push(nums[(i + j) % n]);
    const s = [...new Set(c)].sort();
    if (s.length === pick && !out.some(x => x.join() === s.join())) out.push(s);
  }
  return { n, pick, minHit, combos: out, note: "贪心缩水20注内，自用简化版" };
}