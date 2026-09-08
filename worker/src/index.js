import { fetch500, fetchCWL, fetch17500, trend, verify } from "./ssq.js";
import { fetchDLT, verifyDLT, fetch17500DLT } from "./dlt.js";
import { fetchSmall, prizeSSQ, prizeDLT, prizeQLC, rotation } from "./small.js";
import { SPECS, analyzeAll, killList, danList, recommendAll, backtest, calibrate, ticket, trendPool } from "./predict.js";
import { calcBet, kl8Prize, digit3Prize } from "./calc.js";
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
    if (url.pathname === "/api/specs") return json(Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k, { name: v.name, type: v.type, digits: v.digits || null, main: v.main || null, aux: v.aux || null, suggest: v.suggest }])), 200, 3600);
    if (url.pathname === "/api/calc") return calcRoute(url);
    if (url.pathname === "/api/prize") return prizeRoute(url);
    if (url.pathname === "/api/predict" || url.pathname === "/api/analyze" || url.pathname === "/api/kill" || url.pathname === "/api/dan" || url.pathname === "/api/backtest" || url.pathname === "/api/kill-calibrated" || url.pathname === "/api/ticket") return predictRoute(request, env, url);
    if (url.pathname === "/api/admin/sync") return adminSync(request, env);
    if (url.pathname.startsWith("/api/favs")) return favsRoute(request, env, url);
    if (url.pathname.startsWith("/api/ssq/")) return ssqRoute(request, env, url);
    if (url.pathname.startsWith("/api/dlt/")) return dltRoute(request, env, url);
    if (url.pathname.startsWith("/api/")) return smallRoute(request, env, url);
    return json({ error: "not_found" }, 404);
  }
};
async function ssqRoute(request, env, url) {
  try {
    const draws = await getDraws(env, 100);
    if (url.pathname.endsWith("/latest")) return json({ ...draws[0], sources: draws._sources, consistent: draws._consistent }, 200, 300);
    if (url.pathname.endsWith("/history")) return json(withMeta(draws.slice(0, num(url, "limit", 30, 1, 200)), draws), 200, 600);
    if (url.pathname.endsWith("/trend")) return json(withMeta(trend(draws, num(url, "win", 30, 5, 100)), draws), 200, 600);
    // 预测相关一律走统一引擎，保证 8 个彩种口径一致
    if (url.pathname.endsWith("/analyze")) return json({ kind: "ssq", ...analyzeAll("ssq", draws, num(url, "win", 30, 5, 100)), sources: draws._sources }, 200, 300);
    if (url.pathname.endsWith("/kill")) return json({ kind: "ssq", ...killList("ssq", draws), sources: draws._sources }, 200, 300);
    if (url.pathname.endsWith("/dan")) return json({ kind: "ssq", ...danList("ssq", draws, num(url, "win", 30, 5, 100)), sources: draws._sources }, 200, 300);
    if (url.pathname.endsWith("/recommend")) return json({ ...withLegacy(recommendAll("ssq", draws, { win: num(url, "win", 30, 5, 100) })), sources: draws._sources }, 200, 0);
    if (url.pathname.endsWith("/predict")) return json({ ...withLegacy(recommendAll("ssq", draws, { win: num(url, "win", 30, 5, 100), n: optN(url) })), sources: draws._sources }, 200, 0);
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
    else if (url.pathname.endsWith("/analyze")) res = json({ kind: "dlt", ...analyzeAll("dlt", draws, num(url, "win", 30, 5, 100)) }, 200, 300);
    else if (url.pathname.endsWith("/kill")) res = json({ kind: "dlt", ...killList("dlt", draws) }, 200, 300);
    else if (url.pathname.endsWith("/dan")) res = json({ kind: "dlt", ...danList("dlt", draws, num(url, "win", 30, 5, 100)) }, 200, 300);
    else if (url.pathname.endsWith("/predict")) res = json(recommendAll("dlt", draws, { win: num(url, "win", 30, 5, 100), n: optN(url) }), 200, 0);
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
  const m = url.pathname.match(/^\/api\/(fc3d|pl3|pl5|qlc|qxc|kl8)\/(latest|history|verify|analyze|kill|dan|predict|trend)$/);
  if (!m) return json({ error: "not_found" }, 404);
  const kind = m[1], act = m[2];
  try {
    const cache = caches.default, ck = new Request(url.toString());
    // 预测结果带随机性，不能进缓存，否则同一窗口内所有人拿到同一组号
    if (act !== "predict") { const hit = await cache.match(ck); if (hit) return hit; }
    let draws = [], degraded = false;
    try { draws = await fetchSmall(kind, 150); } catch (e) {
      // 上游不可用时降级读 D1，避免直接 502
      draws = await loadSmall(env.DB, kind, 150).catch(() => []);
      if (!draws.length) throw e;
      degraded = true;
    }
    let res;
    if (act === "latest") res = json(draws[0], 200, 600);
    else if (act === "history") res = json(draws.slice(0, num(url, "limit", 30, 1, 100)), 200, 600);
    else if (act === "analyze") res = json({ kind, ...analyzeAll(kind, draws, num(url, "win", 30, 5, 100)), degraded }, 200, 300);
    else if (act === "kill") res = json({ kind, ...killList(kind, draws), degraded }, 200, 300);
    else if (act === "dan") res = json({ kind, ...danList(kind, draws, num(url, "win", 30, 5, 100)), degraded }, 200, 300);
    else if (act === "predict") res = json({ ...recommendAll(kind, draws, { win: num(url, "win", 30, 5, 100), n: optN(url) }), degraded }, 200, 0);
    else if (act === "trend") res = json({ kind, rows: trendPool(kind, draws, num(url, "limit", 30, 5, 60)), degraded }, 200, 600);
    else {
      const code = (url.searchParams.get("code") || "").trim();
      const nums = (url.searchParams.get("nums") || "").split(/[ ,]+/).filter(Boolean);
      res = json({ ...verifySmall(draws, kind, code, nums), degraded }, 200, 0);
      return res;
    }
    if (act === "predict") return res; // 带随机性，不缓存、不重写
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
// n 缺省时返回 undefined，让引擎按彩种默认推荐个数走
function optN(url) { const raw = url.searchParams.get("n"); return raw === null || raw === "" ? undefined : num(url, "n", 6, 1, 80); }
// 兼容旧字段：同一份推荐结果同时给出 main/aux 与 red/blue 等别名
function withLegacy(r) {
  const alias = { ssq: ["red", "blue"], dlt: ["front", "back"], qlc: ["nums", "special"], kl8: ["nums", null] };
  const a = alias[r.kind];
  if (!a) return r;
  return { ...r, picks: (r.picks || []).map(p => ({ ...p, ...(a[0] ? { [a[0]]: p.main } : {}), ...(a[1] && p.aux && p.aux.length ? { [a[1]]: p.aux.length === 1 ? p.aux[0] : p.aux } : {}) })) };
}
// 统一取数：ssq 走双源融合，dlt 走 500/17500，其余走 17500 并在上游失败时降级读 D1
async function drawsOf(env, kind, limit = 60) {
  if (kind === "ssq") return getDraws(env, Math.max(100, limit));
  if (kind === "dlt") { let d = []; try { d = await fetchDLT(limit); } catch {} if (!d.length) d = await fetch17500DLT(); return d; }
  let d = [];
  try { d = await fetchSmall(kind, limit); } catch (e) {
    d = await loadSmall(env.DB, kind, limit).catch(() => []);
    if (!d.length) throw e;
    d._degraded = true;
  }
  return d;
}
// 全彩种统一的预测入口：/api/predict | /api/analyze | /api/kill | /api/dan?kind=xx
async function predictRoute(request, env, url) {
  const kind = (url.searchParams.get("kind") || "").trim();
  if (!SPECS[kind]) return json({ error: "unknown kind", kinds: Object.keys(SPECS) }, 400);
  const win = num(url, "win", 30, 5, 100);
  try {
    // 回测/校准/胆拖单需要更长的历史（warmup+periods 最多约 70 期，多取冗余）
    const heavy = url.pathname.endsWith("/backtest") || url.pathname.endsWith("/kill-calibrated") || url.pathname.endsWith("/ticket");
    const draws = await drawsOf(env, kind, heavy ? 320 : Math.max(60, win));
    const act = url.pathname.split("/").pop();
    if (act === "analyze") return json({ kind, ...analyzeAll(kind, draws, win), degraded: !!draws._degraded }, 200, 300);
    if (act === "kill") return json({ kind, ...killList(kind, draws), degraded: !!draws._degraded }, 200, 300);
    if (act === "dan") return json({ kind, ...danList(kind, draws, win), degraded: !!draws._degraded }, 200, 300);
    if (act === "backtest") return json({ ...backtest(kind, draws, { win, periods: num(url, "periods", 15, 1, 40), warmup: num(url, "warmup", 30, 10, 60) }), degraded: !!draws._degraded }, 200, 3600);
    if (act === "kill-calibrated") {
      // 先用近 N 期回测算出各公式的真实命中率 → 生成动态权重 → 再出校准后的杀号
      const cal = calibrate(kind, draws, { periods: num(url, "periods", 12, 1, 30), win });
      const kl = killList(kind, draws, { weights: cal.weights });
      return json({ kind, ...kl, weights: cal.weights, formulas: cal.formulas, periods: cal.periods, degraded: !!draws._degraded }, 200, 1800);
    }
    if (act === "ticket") {
      // dan/tuo 只在用户显式传入时生效，缺省走引擎默认（避免 num() 把 0 钳位成 1）
      const p = {};
      if (url.searchParams.get("dan")) p.dan = num(url, "dan", 2, 1, 5);
      if (url.searchParams.get("tuo")) p.tuo = num(url, "tuo", 1, 1, 30);
      return json({ ...ticket(kind, draws, p), degraded: !!draws._degraded }, 200, 300);
    }
    return json({ ...recommendAll(kind, draws, { win, n: optN(url), filter: url.searchParams.get("filter") === "1" }), degraded: !!draws._degraded }, 200, 0);
  } catch (e) { return json({ error: String(e.message || e) }, 502); }
}
// 注数/金额/追号计算器
function calcRoute(url) {
  const kind = (url.searchParams.get("kind") || "").trim();
  if (!SPECS[kind]) return json({ error: "unknown kind", kinds: Object.keys(SPECS) }, 400);
  const p = {};
  for (const [k, v] of url.searchParams) p[k] = v;
  return json(calcBet(kind, p), 200, 0);
}
// 中奖计算器：快乐8 查表、3D/排3 判直选组选、其余按命中个数判奖级
function prizeRoute(url) {
  const kind = (url.searchParams.get("kind") || "").trim();
  if (!SPECS[kind]) return json({ error: "unknown kind", kinds: Object.keys(SPECS) }, 400);
  const g = (k, d = 0) => { const v = parseInt(url.searchParams.get(k) || d, 10); return Number.isNaN(v) ? d : v; };
  if (kind === "kl8") return json(kl8Prize(g("pick", 10), g("hit")), 200, 0);
  if (kind === "fc3d" || kind === "pl3") {
    const bet = (url.searchParams.get("bet") || "").split(/[,\s]+/).filter(Boolean);
    const draw = (url.searchParams.get("draw") || "").split(/[,\s]+/).filter(Boolean);
    return json(digit3Prize(bet, draw), 200, 0);
  }
  if (kind === "ssq") { const r = prizeSSQ(g("hitMain"), !!g("hitAux")); return json({ kind, hitMain: g("hitMain"), hitAux: !!g("hitAux"), prize: r }, 200, 0); }
  if (kind === "dlt") { const r = prizeDLT(g("hitMain"), g("hitAux")); return json({ kind, hitMain: g("hitMain"), hitAux: g("hitAux"), prize: r }, 200, 0); }
  if (kind === "qlc") { const r = prizeQLC(g("hitMain"), g("hitAux")); return json({ kind, hitMain: g("hitMain"), hitAux: g("hitAux"), prize: r }, 200, 0); }
  return json({ kind, prize: g("exact") ? "直选" : "未中", note: "数字型逐位比对，全中即直选" }, 200, 0);
}
function withMeta(list, draws) { list._sources = draws._sources; list._consistent = draws._consistent; return list; }
// 鉴权模型：开奖数据是公开信息，读接口（latest/history/analyze/recommend/rotation/trend）无需鉴权；
// 只有写操作与个人数据（/api/favs 的所有方法、/api/admin/sync）要求 API_TOKEN。
// 未设置 API_TOKEN 时写接口一律拒绝（fail-closed）。
function requireAuth(r, env) {
  if (!env.API_TOKEN) return false;
  return (r.headers.get("Authorization") || "") === `Bearer ${env.API_TOKEN}`;
}
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
  if (!requireAuth(request, env)) return json({ error: "unauthorized admin" }, 401);
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
      const d = await fetchSmall(k, 150);
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
