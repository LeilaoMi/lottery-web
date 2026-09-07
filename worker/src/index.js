import { fetch500, fetchCWL, fetch17500, analyze, blueScores, recommend, trend, verify } from "./ssq.js";
import { fetchDLT, analyzeDLT, verifyDLT, fetch17500DLT } from "./dlt.js";
import { fetchSmall, prizeSSQ, prizeDLT, prizeQLC, rotation } from "./small.js";
import { saveSSQ, loadSSQ, logSync, saveDLT, saveSmall, loadSmall } from "./db.js";
import { HTML, SW, MANIFEST, ICON } from "./ui.js";
const LOTS = [{ id: "ssq", name: "双色球", rule: "红6/33+蓝1/16", days: "二四日" }, { id: "dlt", name: "大乐透", rule: "前5/35+后2/12", days: "一三六" }, { id: "fc3d", name: "福彩3D", rule: "3位0-9", days: "每日" }, { id: "pl3", name: "排列3", rule: "3位0-9", days: "每日" }, { id: "pl5", name: "排列5", rule: "5位0-9", days: "每日" }, { id: "qlc", name: "七乐彩", rule: "7/30+特别", days: "一三五" }, { id: "qxc", name: "七星彩", rule: "7位0-9", days: "二五日" }, { id: "kl8", name: "快乐8", rule: "20/80", days: "每日" }];
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors();
    if (url.pathname === "/" || url.pathname === "/index.html") return html();
    if (url.pathname === "/favicon.ico") return new Response("", { status: 204 });
    if (url.pathname === "/sw.js") return new Response(SW, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Service-Worker-Allowed": "/" } });
    if (url.pathname === "/manifest.json") return new Response(MANIFEST, { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } });
    if (url.pathname === "/icon.svg") return new Response(ICON, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=604800" } });
    if (url.pathname === "/health") return json({ status: "ok", version: env.VERSION || "0.5.0", lotteries: LOTS.map(x => x.id) });
    if (url.pathname === "/api/meta") return json({ lotteries: LOTS, sources: ["500", "cwl", "17500", "d1"], disclaimer: "随机游戏，仅供娱乐，不保证中奖" });
    if (url.pathname === "/licenses") return htmlLicenses();
    if (url.pathname === "/api/rotation") {
      const n = num(url, "n", 12, 7, 33), p = num(url, "pick", 6, 5, 7);
      return json(rotation(n, p, num(url, "hit", 4, 3, 6)));
    }
    if (url.pathname === "/api/admin/sync") return adminSync(request, env);
    if (url.pathname.startsWith("/api/favs")) return favsRoute(request, env, url);
    if (url.pathname.startsWith("/api/ssq/")) return ssqRoute(request, env, url);
    if (url.pathname.startsWith("/api/dlt/")) return dltRoute(request, env, url);
    if (url.pathname.startsWith("/api/")) return smallRoute(request, env, url);
    return json({ error: "not_found" }, 404);
  }
};
async function ssqRoute(request, env, url) {
  if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401);
  try {
    const draws = await getDraws(env, 100);
    if (url.pathname.endsWith("/latest")) return json({ ...draws[0], sources: draws._sources, consistent: draws._consistent }, 200, 300);
    if (url.pathname.endsWith("/history")) return json(withMeta(draws.slice(0, num(url, "limit", 30, 1, 200)), draws), 200, 600);
    if (url.pathname.endsWith("/trend")) return json(withMeta(trend(draws, num(url, "win", 30, 5, 100)), draws), 200, 600);
    if (url.pathname.endsWith("/analyze")) return json({ analysis: analyze(draws, num(url, "win", 30, 5, 100)), blue: blueScores(draws), sources: draws._sources }, 200, 300);
    if (url.pathname.endsWith("/recommend")) return json({ ...recommend(draws), sources: draws._sources }, 200, 0);
    if (url.pathname.endsWith("/verify")) {
      const code = url.searchParams.get("code") || "", red = (url.searchParams.get("red") || "").split(/[ ,]+/).filter(Boolean), blue = url.searchParams.get("blue") || "";
      const r = verify(draws, code, red, blue);
      if (r.hit) r.prize = prizeSSQ(r.hitRed, r.hitBlue);
      return json({ ...r, sources: draws._sources });
    }
  } catch (e) { return json({ error: String(e.message || e) }, 502); }
  return json({ error: "not_found" }, 404);
}
async function dltRoute(request, env, url) {
  if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401);
  try {
    const cache = caches.default;
    const ck = new Request(url.toString(), { method: "GET" });
    if (url.pathname.endsWith("/history") || url.pathname.endsWith("/latest")) {
      const hit = await cache.match(ck);
      if (hit) return hit;
    }
    let draws = []; try { draws = await fetchDLT(60); } catch {} if (!draws.length) draws = await fetch17500DLT();
    let res;
    if (url.pathname.endsWith("/latest")) res = json(draws[0], 200, 300);
    else if (url.pathname.endsWith("/history")) res = json(draws.slice(0, num(url, "limit", 30, 1, 100)), 200, 600);
    else if (url.pathname.endsWith("/analyze")) res = json(analyzeDLT(draws, num(url, "win", 30, 5, 100)), 200, 300);
    else if (url.pathname.endsWith("/verify")) {
      const code = url.searchParams.get("code") || "", f = (url.searchParams.get("front") || "").split(/[ ,]+/).filter(Boolean), b = (url.searchParams.get("back") || "").split(/[ ,]+/).filter(Boolean);
      const r = verifyDLT(draws, code, f, b); if (r.hit) r.prize = prizeDLT(r.hitFront, r.hitBack); res = json(r);
    } else return json({ error: "not_found" }, 404);
    if (url.pathname.endsWith("/history") || url.pathname.endsWith("/latest")) { const c = res.clone(); c.headers.set("Cache-Control", "public, max-age=600"); try { await cache.put(ck, c); } catch {} }
    return res;
  } catch (e) { return json({ error: String(e.message || e) }, 502); }
  return json({ error: "not_found" }, 404);
}
async function smallRoute(request, env, url) {
  if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401);
  const m = url.pathname.match(/^\/api\/(fc3d|pl3|pl5|qlc|qxc|kl8)\/(latest|history|verify)$/);
  if (!m) return json({ error: "not_found" }, 404);
  const kind = m[1], act = m[2];
  try {
    const cache = caches.default, ck = new Request(url.toString());
    const hit = await cache.match(ck);
    if (hit) return hit;
    let draws = [], degraded = false;
    try { draws = await fetchSmall(kind, 60); } catch (e) {
      // 上游不可用时降级读 D1，避免直接 502
      draws = await loadSmall(env.DB, kind, 60).catch(() => []);
      if (!draws.length) throw e;
      degraded = true;
    }
    let res;
    if (act === "latest") res = json(draws[0], 200, 600);
    else if (act === "history") res = json(draws.slice(0, num(url, "limit", 30, 1, 100)), 200, 600);
    else {
      const code = (url.searchParams.get("code") || "").trim();
      const nums = (url.searchParams.get("nums") || "").split(/[ ,]+/).filter(Boolean);
      res = json({ ...verifySmall(draws, kind, code, nums), degraded }, 200, 0);
      return res;
    }
    if (degraded) res = json({ ...(await res.json()), degraded: true }, 200, 600);
    try { await cache.put(ck, res.clone()); } catch {}
    return res;
  } catch (e) { return json({ error: String(e.message || e) }, 502); }
}
// 小彩种验奖：数字型按位比对，七乐彩按基本号+特别号，快乐8只统计命中个数
function verifySmall(draws, kind, code, nums) {
  const d = draws.find(x => x.code === code);
  if (!d) return { hit: false, note: "期号不存在（可先用 /history 确认）" };
  const N = nums.map(s => (/^\d{1,2}$/.test(s) ? String(Number(s)).padStart(2, "0") : s));
  if (kind === "qlc") {
    const hm = N.filter(x => (d.main || []).includes(x)).length;
    const hs = d.special && N.includes(d.special) ? 1 : 0;
    return { hit: true, actual: d, hitMain: hm, hitSpecial: !!hs, prize: prizeQLC(hm, hs) };
  }
  if (kind === "kl8") {
    const hn = N.filter(x => (d.nums || []).includes(x)).length;
    return { hit: true, actual: d, hitNums: hn, note: "快乐8奖金随「选几」玩法而异，此处仅统计命中个数" };
  }
  const act = (d.digits || []).map(String);
  let pos = 0;
  for (let i = 0; i < act.length && i < N.length; i++) if (String(Number(act[i])) === String(Number(N[i]))) pos++;
  const exact = pos === act.length && N.length === act.length;
  return { hit: true, actual: d, posHit: pos, total: act.length, exact, prize: exact ? "直选" : "未中" };
}
function num(url, k, d, a, b) { const v = parseInt(url.searchParams.get(k) || d, 10); return Math.min(b, Math.max(a, isNaN(v) ? d : v)); }
function withMeta(list, draws) { list._sources = draws._sources; list._consistent = draws._consistent; return list; }
function checkAuth(r, env) { if (!env.API_TOKEN) return true; return (r.headers.get("Authorization") || "") === `Bearer ${env.API_TOKEN}`; }
async function getDraws(env, limit) {
  if (env.DATA_SOURCE_OFFICIAL || env.DATA_SOURCE_PUBLIC) return getCustom(env);
  const rs = await Promise.all([fetch500(limit).then(d => ({ k: "500", d })).catch(e => ({ k: "500", e })), fetchCWL().then(d => ({ k: "cwl", d })).catch(e => ({ k: "cwl", e }))]);
  const ok = rs.filter(x => x.d && x.d.length);
  if (!ok.length) { try { const t = await fetch17500(); if (t.length) { t._sources = ["17500"]; t._consistent = true; return t; } } catch {} const m = [{ code: "2025091", red: ["01", "08", "12", "19", "26", "33"], blue: "09", date: "", src: "mock" }]; m._sources = []; m._consistent = true; m._mock = true; return m; }
  const base = ok.find(x => x.k === "500")?.d || ok[0].d;
  base._sources = ok.map(x => x.k); base._consistent = ok.length > 1 && ok[0].d[0].code === ok[1].d[0].code ? JSON.stringify([ok[0].d[0].red, ok[0].d[0].blue]) === JSON.stringify([ok[1].d[0].red, ok[1].d[0].blue]) : true; return base;
}
async function getCustom(env) {
  const out = [];
  for (const [k, u] of [["official", env.DATA_SOURCE_OFFICIAL], ["public", env.DATA_SOURCE_PUBLIC]]) {
    if (!u) continue;
    try { const r = await fetch(u); const j = await r.json(); const arr = Array.isArray(j) ? j : j.result || j.data || [j]; for (const it of arr.slice(0, 100)) { const code = String(it.code || ""); const red = String(it.red || "").split(/[ ,]+/).filter(Boolean).map(x => x.padStart(2, "0")); const blue = String(it.blue || "").padStart(2, "0"); if (/^\d{5,7}$/.test(code) && red.length === 6) out.push({ code, red, blue, date: it.date || "", src: k }); } } catch {}
  }
  out._sources = [env.DATA_SOURCE_OFFICIAL ? "official" : null, env.DATA_SOURCE_PUBLIC ? "public" : null].filter(Boolean); out._consistent = true; return out;
}
function json(o, s = 200, cache = 0) { const h = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }; h["Cache-Control"] = cache ? `public, max-age=${cache}` : "no-store"; return new Response(JSON.stringify(o), { status: s, headers: h }); }
// 预检：没有它，跨域调用 POST/DELETE /api/favs 会直接失败
function cors() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Max-Age": "86400" } });
}
async function adminSync(request, env) {
  if (!env.API_TOKEN || (request.headers.get("Authorization") || "") !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized admin" }, 401);
  const out = { ran: new Date().toISOString(), results: {} };
  try {
    const live = await getDraws(env, 100);
    const ins = await saveSSQ(env.DB, live);
    await logSync(env.DB, (live._sources || []).join(","), live.length, ins, live._consistent ? 1 : 0, live._mock ? "mock" : "");
    const cached = await loadSSQ(env.DB, 5);
    out.results.ssq = { fetched: live.length, inserted: ins, consistent: live._consistent, latestLive: live[0]?.code, latestDB: cached[0]?.code };
  } catch (e) { out.results.ssq = { error: String(e.message || e) }; }
  try {
    let d = []; try { d = await fetchDLT(60); } catch {} if (!d.length) d = await fetch17500DLT();
    out.results.dlt = { fetched: d.length, inserted: await saveDLT(env.DB, d), latest: d[0]?.code };
  } catch (e) { out.results.dlt = { error: String(e.message || e) }; }
  for (const k of LOTS.filter(x => x.id !== "ssq" && x.id !== "dlt").map(x => x.id)) {
    try {
      const d = await fetchSmall(k, 60);
      out.results[k] = { fetched: d.length, inserted: await saveSmall(env.DB, k, d), latest: d[0]?.code };
    } catch (e) { out.results[k] = { error: String(e.message || e) }; }
  }
  out.db = !!env.DB;
  return json(out);
}
async function favsRoute(request, env, url) {
  if (!env.DB) return json({ error: "no db" }, 501);
  // 收藏是个人数据：只要配了 API_TOKEN，读操作也必须鉴权
  if (env.API_TOKEN && (request.headers.get("Authorization") || "") !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
  if (request.method === "GET") {
    try { const r = await env.DB.prepare("SELECT id,kind,numbers,note,created_at FROM favs ORDER BY id DESC LIMIT 100").all(); return json(r.results || []); } catch (e) { return json({ error: String(e) }, 500); }
  }
  if (request.method === "POST") {
    try { const b = await request.json(); await env.DB.prepare("INSERT INTO favs(kind,numbers,note) VALUES(?,?,?)").bind(String(b.kind || "ssq"), String(b.numbers || ""), String(b.note || "").slice(0, 200)).run(); return json({ ok: true }); } catch (e) { return json({ error: String(e) }, 500); }
  }
  if (request.method === "DELETE") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    try { await env.DB.prepare("DELETE FROM favs WHERE id=?").bind(id).run(); return json({ ok: true }); } catch (e) { return json({ error: String(e) }, 500); }
  }
  return json({ error: "method" }, 405);
}
function htmlLicenses() {
  const s = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>Licenses</title></head><body><h1>声明</h1><p>自研代码 MIT。逻辑借鉴（自写实现）：sinyu1012 Double-Color-Ball-AI MIT，oahzxd lottoery MIT，BEWINDOWEB lotterygrabber MIT，longgeyyds ssq-fusion MIT，Konata chinese-lottery-predict MIT，zxz0119 lottery-ai-simulator MIT。TheMelody LotteryTrend Apache-2.0（保留声明）。zepen/predict等无License仅借思路未抄码。数据：500/cwl/17500/sporttery归属原站。随机游戏，仅供娱乐，不保证中奖。</p><a href="/">回首页</a></body></html>`;
  return new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function html() {
  return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}
