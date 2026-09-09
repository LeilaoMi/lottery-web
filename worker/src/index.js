import { fetch500, fetchCWL, fetch17500, trend, verify } from "./ssq.js";
import { fetchDLT, verifyDLT, fetch17500DLT } from "./dlt.js";
import { fetchSmall, prizeSSQ, prizeDLT, prizeQLC, rotation } from "./small.js";
import { verifyBatch } from "./verify-batch.js";
import { SPECS, analyzeAll, killList, danList, recommendAll, backtest, calibrate, ticket, trendPool, shapeTrans, thresholdTune, binomP, poolOf, mainOf, auxOf } from "./predict.js";
import { calcBet, kl8Prize, digit3Prize } from "./calc.js";
import { coldness } from "./coldness.js";
import { fetchT } from "./net.js";
import { saveSSQ, loadSSQ, logSync, saveDLT, loadDLT, saveSmall, loadSmall } from "./db.js";
import { HTML, SW, MANIFEST, ICON } from "./ui.js";
const LOTS = [{ id: "ssq", name: "双色球", rule: "红6/33+蓝1/16", days: "二四日" }, { id: "dlt", name: "大乐透", rule: "前5/35+后2/12", days: "一三六" }, { id: "fc3d", name: "福彩3D", rule: "3位0-9", days: "每日" }, { id: "pl3", name: "排列3", rule: "3位0-9", days: "每日" }, { id: "pl5", name: "排列5", rule: "5位0-9", days: "每日" }, { id: "qlc", name: "七乐彩", rule: "7/30+特别", days: "一三五" }, { id: "qxc", name: "七星彩", rule: "7位0-9", days: "二五日" }, { id: "kl8", name: "快乐8", rule: "20/80", days: "每日" }];
// kill-calibrated 的 isolate 级内存缓存：caches.default 在 workers.dev 域名上是 no-op，
// 内存缓存保证同一 isolate 内的后续请求不重复算校准；自定义域上另由 caches.default 兜底
const CAL_MEM = new Map();
const CAL_TTL = 21600_000;
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors();
    if (url.pathname === "/" || url.pathname === "/index.html") return html();
    if (url.pathname === "/favicon.ico") return new Response("", { status: 204 });
    if (url.pathname === "/sw.js") return new Response(SW, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Service-Worker-Allowed": "/" } });
    if (url.pathname === "/manifest.json") return new Response(MANIFEST, { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } });
    if (url.pathname === "/icon.svg") return new Response(ICON, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=604800" } });
    if (url.pathname === "/health") return json({ status: "ok", version: env.VERSION || "0.13.0", lotteries: LOTS.map(x => x.id) });
    if (url.pathname === "/api/meta") return metaRoute(env);
    if (url.pathname === "/api/records") return recordsRoute(env);
    if (url.pathname === "/licenses") return htmlLicenses();
    if (url.pathname === "/api/rotation") {
      const n = num(url, "n", 12, 7, 33), p = num(url, "pick", 6, 5, 7);
      return json(rotation(n, p, num(url, "hit", 4, 3, 6)));
    }
    if (url.pathname === "/api/specs") return json(Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k, { name: v.name, type: v.type, digits: v.digits || null, main: v.main || null, aux: v.aux || null, suggest: v.suggest }])), 200, 3600);
    if (url.pathname === "/api/calc") return calcRoute(url);
    if (url.pathname === "/api/coldness") {
      // 纯函数、不取数、与期号无关 → 可长缓存；参数非法时 coldness() 返回 { error } 转 400
      const kind = (url.searchParams.get("kind") || "ssq").trim();
      const nums = (url.searchParams.get("nums") || "").split(/[ ,]+/).filter(Boolean);
      const blue = (url.searchParams.get("blue") || "").trim();
      const r = coldness(kind, nums, blue ? [blue] : []);
      return r.error ? json(r, 400, 0) : json(r, 200, 3600);
    }
    if (url.pathname === "/api/prize") return prizeRoute(url);
    if (url.pathname === "/api/verify-batch") return verifyBatchRoute(request, env, url);
    if (url.pathname === "/api/predict" || url.pathname === "/api/analyze" || url.pathname === "/api/kill" || url.pathname === "/api/dan" || url.pathname === "/api/backtest" || url.pathname === "/api/kill-calibrated" || url.pathname === "/api/kill-tune" || url.pathname === "/api/ticket" || url.pathname === "/api/trend") return predictRoute(request, env, url);
    if (url.pathname === "/api/admin/sync") return adminSync(request, env, ctx);
    if (url.pathname === "/api/admin/review-job") return reviewJob(request, env);
    if (url.pathname === "/api/review") return reviewRoute(request, env, url);
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
    if (url.pathname.endsWith("/analyze")) return json({ kind: "ssq", ...analyzeAll("ssq", draws, num(url, "win", 30, 5, 100)), shape: shapeTrans("ssq", draws, { window: 400 }), sources: draws._sources }, 200, 300);
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
    else if (url.pathname.endsWith("/analyze")) res = json({ kind: "dlt", ...analyzeAll("dlt", draws, num(url, "win", 30, 5, 100)), shape: shapeTrans("dlt", draws, { window: 400 }) }, 200, 300);
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
    else if (act === "analyze") res = json({ kind, ...analyzeAll(kind, draws, num(url, "win", 30, 5, 100)), ...(SPECS[kind].type === "pool" ? { shape: shapeTrans(kind, draws, { window: 400 }) } : {}), degraded }, 200, 300);
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
// 浮点参数（如 holdout=0.3）
function optF(url, k, d, mn, mx) { const v = parseFloat(url.searchParams.get(k)); return Number.isFinite(v) ? Math.min(mx, Math.max(mn, v)) : d; }
// 按 code 去重（保留先出现的=最新一期）：save* 用 INSERT OR REPLACE 依赖唯一约束，
// 若建表时没加 UNIQUE 会积累重复期号，回测样本被虚增、同一天被算两遍。
// 数组上的自定义属性（_sources/_consistent/_degraded/_mock）原样透传
function dedupeByCode(arr) {
  const seen = new Set(), out = [];
  for (const d of (arr || [])) { const c = String(d && d.code); if (seen.has(c)) continue; seen.add(c); out.push(d); }
  for (const k of Object.keys(arr || {})) if (k.startsWith("_")) out[k] = arr[k];
  return out;
}
// 下一期期号：纯数字 +1（跨年边界会失真，但对账只按「该期是否已开奖」兜底，不影响正确性）
function nextIssue(code) { return /^\d+$/.test(String(code || "")) ? String(Number(code) + 1) : String(code || "") + "+1"; }
// 兼容旧字段：同一份推荐结果同时给出 main/aux 与 red/blue 等别名
function withLegacy(r) {
  const alias = { ssq: ["red", "blue"], dlt: ["front", "back"], qlc: ["nums", "special"], kl8: ["nums", null] };
  const a = alias[r.kind];
  if (!a) return r;
  return { ...r, picks: (r.picks || []).map(p => ({ ...p, ...(a[0] ? { [a[0]]: p.main } : {}), ...(a[1] && p.aux && p.aux.length ? { [a[1]]: p.aux.length === 1 ? p.aux[0] : p.aux } : {}) })) };
}
// 统一取数：ssq 走双源融合，dlt 走 500/17500，其余走 17500 并在上游失败时降级读 D1
async function drawsOf(env, kind, limit = 60) {
  if (kind === "ssq") return dedupeByCode(await getDraws(env, Math.max(100, limit)));
  if (kind === "dlt") { let d = []; try { d = await fetchDLT(limit); } catch {} if (!d.length) d = await fetch17500DLT(); return dedupeByCode(d); }
  let d = [];
  try { d = await fetchSmall(kind, limit); } catch (e) {
    d = dedupeByCode(await loadSmall(env.DB, kind, limit).catch(() => []));
    if (!d.length) throw e;
    d._degraded = true;
  }
  return dedupeByCode(d);
}
// 深度取数：回测/校准/胆拖单需要 600+ 期长历史，优先走 17500 全量文件（双色球/大乐透/小彩种都覆盖）
// 全量文件拉取 1-4s（墙钟）但 CPU 也就几 ms；同一 isolate 内 30 分钟内的重复 heavy 请求直接吃内存缓存，
// 免得连续点「外推检验/阈值寻优」每次都重拉。缓存带 kind + 最新期号：新开奖落地后 key 变化自动失效。
const DEEP_MEM = new Map();
const DEEP_TTL = 1800_000;
async function drawsDeep(env, kind) {
  let probe = "";
  try { probe = kind === "ssq" ? (await fetch500(1))[0]?.code : kind === "dlt" ? (await fetchDLT(1))[0]?.code : (await fetchSmall(kind, 1))[0]?.code || ""; } catch {}
  const ck = kind + ":" + probe;
  const mem = DEEP_MEM.get(kind);
  if (mem && mem.key === ck && Date.now() - mem.at < DEEP_TTL) { mem.hits = (mem.hits || 0) + 1; return mem.draws; }
  const d = await drawsDeepFetch(env, kind);
  if (d.length) { if (DEEP_MEM.size > 16) DEEP_MEM.clear(); DEEP_MEM.set(kind, { at: Date.now(), key: ck, draws: d }); }
  return d;
}
async function drawsDeepFetch(env, kind) {
  if (kind === "ssq") {
    let d = [];
    try { d = await fetch17500(650); } catch {}
    if (d.length) return dedupeByCode(d);
    return dedupeByCode(await getDraws(env, 200));
  }
  if (kind === "dlt") {
    let d = [];
    try { d = (await fetch17500DLT()).slice(0, 650); } catch {}
    if (d.length) return dedupeByCode(d);
    try { return dedupeByCode(await fetchDLT(200)); } catch { return []; }
  }
  let d = [];
  try { d = await fetchSmall(kind, 650); } catch (e) {
    d = dedupeByCode(await loadSmall(env.DB, kind, 650).catch(() => []));
    if (!d.length) throw e;
    d._degraded = true;
  }
  return dedupeByCode(d);
}
// 全彩种统一的预测入口：/api/predict | /api/analyze | /api/kill | /api/dan?kind=xx
async function predictRoute(request, env, url) {
  const kind = (url.searchParams.get("kind") || "").trim();
  if (!SPECS[kind]) return json({ error: "unknown kind", kinds: Object.keys(SPECS) }, 400);
  const win = num(url, "win", 30, 5, 100);
  // kill-calibrated / kill-tune：内存/边缘缓存在任何取数之前检查（上游拉数 ~2.5s 不该白白发生）
  const cacheable = url.pathname.endsWith("/kill-calibrated") || url.pathname.endsWith("/kill-tune");
  if (cacheable) {
    const ck0 = url.toString();
    const mem0 = CAL_MEM.get(ck0);
    if (mem0 && Date.now() - mem0.at < CAL_TTL) {
      const h = new Headers(mem0.headers); h.set("x-cache", "MEM");
      return new Response(mem0.body, { status: 200, headers: h });
    }
    try {
      const hit0 = await caches.default.match(new Request(ck0, { method: "GET" }));
      if (hit0) { const r = hit0.clone(); r.headers.set("x-cache", "EDGE"); return r; }
    } catch {}
  }
  try {
    // 回测/校准/胆拖单需要长历史（600 期跨度 + warmup），走 17500 全量源
    const heavy = cacheable || url.pathname.endsWith("/backtest") || url.pathname.endsWith("/ticket");
    const draws = heavy ? await drawsDeep(env, kind) : await drawsOf(env, kind, Math.max(60, win));
    const act = url.pathname.split("/").pop();
    if (act === "analyze") {
      const an = { kind, ...analyzeAll(kind, draws, win) };
      if (SPECS[kind].type === "pool") an.shape = shapeTrans(kind, draws, { window: 400 }); // 形态转移，CPU O(400) 可忽略
      return json({ ...an, degraded: !!draws._degraded }, 200, 300);
    }
    if (act === "kill") return json({ kind, ...killList(kind, draws), degraded: !!draws._degraded }, 200, 300);
    if (act === "dan") return json({ kind, ...danList(kind, draws, win), degraded: !!draws._degraded }, 200, 300);
    if (act === "trend") return json({ kind, rows: trendPool(kind, draws, num(url, "limit", 30, 5, 60)), degraded: !!draws._degraded }, 200, 600);
    if (act === "backtest") return json({ ...backtest(kind, draws, { win, periods: num(url, "periods", 20, 1, 600), warmup: num(url, "warmup", 30, 10, 60) }), degraded: !!draws._degraded }, 200, 3600);
    if (act === "kill-calibrated") {
      // 缓存已在取数前检查过（内存 → 边缘），这里只现算并写回三级缓存
      // holdout=0.3（可选）：权重只用旧段拟合、新段外推检验——显式传参才算，默认路径 CPU 不变
      const cal = calibrate(kind, draws, { periods: num(url, "periods", 12, 1, 60), win, holdout: optF(url, "holdout", 0, 0, 0.5) });
      const kl = killList(kind, draws, { weights: cal.weights });
      const res = json({ kind, ...kl, weights: cal.weights, formulas: cal.formulas, periods: cal.periods, ...(cal.holdout ? { holdout: cal.holdout } : {}), degraded: !!draws._degraded }, 200, 21600);
      await stashCache(url.toString(), res, 21600);
      return res;
    }
    if (act === "kill-tune") {
      // 杀号阈值寻优：10 次 backtest（5 分位 × 旧/新段），是全站最重端点 → 默认 periods 20 抽样、结果缓存 6h
      const r = thresholdTune(kind, draws, { periods: num(url, "periods", 20, 10, 60) });
      const res = json({ ...r, degraded: !!draws._degraded }, 200, 21600);
      await stashCache(url.toString(), res, 21600);
      return res;
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
// kill-calibrated / kill-tune 共用的缓存写回：isolate 内存（最快）→ caches.default（同 colo 兜底）→ 响应头标记
async function stashCache(ck, res, ttl) {
  try {
    if (CAL_MEM.size > 64) CAL_MEM.clear();
    CAL_MEM.set(ck, { at: Date.now(), body: await res.clone().text(), headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=" + ttl } });
    try { await caches.default.put(new Request(ck, { method: "GET" }), res.clone()); } catch {}
    res.headers.set("x-cache", "MISS");
  } catch {}
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
// 批量验奖：一次贴一沓号码 × 一到多期开奖（POST，body 里的结果不该被缓存）
async function verifyBatchRoute(request, env, url) {
  if (request.method !== "POST") return json({ error: "本端点用 POST + JSON body", usage: 'POST /api/verify-batch {"kind":"ssq","code":"2026104","tickets":["01 05 12 22 28 30 + 04"],"mult":1}' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: "需要 JSON body" }, 400); }
  const kind = String((body && body.kind) || "ssq").trim();
  if (!SPECS[kind]) return json({ error: "unknown kind", kinds: Object.keys(SPECS) }, 400);
  const codes = (Array.isArray(body.codes) ? body.codes : [body.code]).map(x => String(x || "").trim()).filter(Boolean);
  if (!codes.length) return json({ error: "需要 code 或 codes（数组，最多 10 期）" }, 400);
  // tickets 先校验再取数：取数要打外部源（墙钟 1-4s），空请求不该白跑一次；
  // 且必须是数组 —— 传成字符串时下游 tickets.map 会抛 TypeError，变成没有说明的 500
  const tickets = body.tickets;
  if (!Array.isArray(tickets) || !tickets.length) return json({ error: '需要 tickets（字符串数组，每行一注）', usage: 'POST /api/verify-batch {"kind":"ssq","code":"2026104","tickets":["01 05 12 22 28 30 + 04"]}' }, 400);
  let draws = [];
  try { draws = await drawsOf(env, kind, Math.max(60, codes.length + 10)); } catch (e) { return json({ error: "取数失败：" + String(e.message || e) }, 502); }
  const r = verifyBatch(kind, draws, tickets, codes, (body && body.mult) || 1);
  return json(r, r.error ? 400 : 200, 0);
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
  base._sources = ok.map(x => x.k); base._consistent = ok.length > 1 && ok[0].d[0].code === ok[1].d[0].code ? JSON.stringify([ok[0].d[0].red, ok[0].d[0].blue]) === JSON.stringify([ok[1].d[0].red, ok[1].d[0].blue]) : true;
  // 多源交叉校验（最近 30 期逐期比对）：单源数据错误 = 全部预测报废，落库前必须拦住
  if (ok.length > 1) {
    const [a, b] = ok.map(x => x.d);
    base._cross = crossCheck(a, b, 30);
  }
  return base;
}
// 号码对归一化：ssq{red,blue} / dlt{front,back} / 小彩种{main,special|nums|digits}，两源同字段类型才可比
function drawPair(d) { return JSON.stringify([d.red || d.front || d.main || d.digits, d.blue || d.back || d.special || d.nums]); }
// 两路数据源最近 n 期逐期比对（按期号对齐，号型字段自动归一）
function crossCheck(a, b, n = 30) {
  const bMap = new Map(b.slice(0, n + 10).map(d => [String(d.code), d]));
  let checked = 0; const mismatch = [];
  for (const d of a.slice(0, n)) {
    const o = bMap.get(String(d.code));
    if (!o) continue;
    checked++;
    if (drawPair(d) !== drawPair(o)) mismatch.push(String(d.code));
  }
  return { checked, mismatch };
}
async function getCustom(env) {
  const out = [];
  for (const [k, u] of [["official", env.DATA_SOURCE_OFFICIAL], ["public", env.DATA_SOURCE_PUBLIC]]) {
    if (!u) continue;
    try { const r = await fetchT(u); const j = await r.json(); const arr = Array.isArray(j) ? j : j.result || j.data || [j]; for (const it of arr.slice(0, 100)) { const code = String(it.code || ""); const red = String(it.red || "").split(/[ ,]+/).filter(Boolean).map(x => x.padStart(2, "0")); const blue = String(it.blue || "").padStart(2, "0"); if (/^\d{5,7}$/.test(code) && red.length === 6) out.push({ code, red, blue, date: it.date || "", src: k }); } } catch {}
  }
  out._sources = [env.DATA_SOURCE_OFFICIAL ? "official" : null, env.DATA_SOURCE_PUBLIC ? "public" : null].filter(Boolean); out._consistent = true; return out;
}
function json(o, s = 200, cache = 0) { const h = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }; h["Cache-Control"] = cache ? `public, max-age=${cache}` : "no-store"; return new Response(JSON.stringify(o), { status: s, headers: h }); }
// 预检：没有它，跨域调用 POST/DELETE /api/favs 会直接失败
function cors() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Max-Age": "86400" } });
}
async function adminSync(request, env, ctx) {
  if (!requireAuth(request, env)) return json({ error: "unauthorized admin" }, 401);
  const out = { ran: new Date().toISOString(), results: {} };
  try {
    const live = await getDraws(env, 100);
    // 交叉校验不一致的期号拒绝落库：无法分辨哪个源对，宁缺毋滥——D1 旧值仍是好的
    const bad = new Set((live._cross && live._cross.mismatch) || []);
    const toSave = bad.size ? live.filter(d => !bad.has(String(d.code))) : live;
    const ins = await saveSSQ(env.DB, toSave);
    await logSync(env.DB, (live._sources || []).join(","), live.length, ins, live._consistent ? 1 : 0, live._mock ? "mock" : (bad.size ? "crosscheck_dropped_" + bad.size : ""));
    const cached = await loadSSQ(env.DB, 5);
    out.results.ssq = { fetched: live.length, inserted: ins, consistent: live._consistent, latestLive: live[0]?.code, latestDB: cached[0]?.code, ...(live._cross ? { crosscheck: { checked: live._cross.checked, mismatch: live._cross.mismatch, dropped: bad.size } } : {}) };
  } catch (e) { out.results.ssq = { error: String(e.message || e) }; }
  try {
    let d = [], alt = [];
    try { d = await fetchDLT(60); } catch {}
    try { alt = await fetch17500DLT(); } catch {}
    if (!d.length) d = alt;
    // dlt 交叉校验（与 ssq 同标准）：500 与 17500 最近 30 期逐期比对，不一致的期号拒绝落库
    let cross = null;
    if (d.length && alt.length && d !== alt) {
      cross = crossCheck(d, alt, 30);
      const bad = new Set(cross.mismatch);
      if (bad.size) d = d.filter(x => !bad.has(String(x.code)));
    }
    // 补日期：500 解析器给的是 date:""（dlt.js:15），空日期写进 D1 会让 /api/meta 的 stale[]
    // 直接漏掉大乐透（新鲜度保险丝对它失明），也让分年 eras / 开奖日统计失去依据。
    // 备源 17500 带日期且刚刚为交叉校验取过，按期号回填即可，不额外花一次请求。
    let dated = 0;
    if (alt.length) {
      const dateBy = new Map(alt.map(x => [String(x.code), String(x.date || "")]));
      for (const x of d) if (!x.date) { const v = dateBy.get(String(x.code)); if (v) { x.date = v; dated++; } }
    }
    out.results.dlt = { fetched: d.length, inserted: await saveDLT(env.DB, d), latest: d[0]?.code, datedFrom: dated, ...(cross ? { crosscheck: { checked: cross.checked, mismatch: cross.mismatch, dropped: cross.mismatch.length } } : {}) };
  } catch (e) { out.results.dlt = { error: String(e.message || e) }; }
  for (const k of LOTS.filter(x => x.id !== "ssq" && x.id !== "dlt").map(x => x.id)) {
    try {
      const d = await fetchSmall(k, 150);
      out.results[k] = { fetched: d.length, inserted: await saveSmall(env.DB, k, d), latest: d[0]?.code };
    } catch (e) { out.results[k] = { error: String(e.message || e) }; }
  }
  out.db = !!env.DB;
  // 同步完成后预热 8 个彩种的校准杀号缓存：自 fetch 各自进入独立请求（CPU 预算独立），
  // kill-calibrated 路由自身会 cache.put，这里只负责触发
  if (ctx && typeof ctx.waitUntil === "function") {
    const origin = new URL(request.url).origin;
    out.warm = LOTS.map(x => x.id);
    for (const k of LOTS.map(x => x.id)) {
      ctx.waitUntil(fetch(origin + "/api/kill-calibrated?kind=" + k).then(() => true).catch(() => false));
    }
    // 预测复盘（快照 + 对账）放独立请求跑：8 彩种 analyze+killList 的 CPU 不占本请求预算
    out.review = "deferred";
    ctx.waitUntil(fetch(origin + "/api/admin/review-job", { method: "POST", headers: { Authorization: `Bearer ${env.API_TOKEN}` } }).then(() => true).catch(() => false));
  }
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
// ---------- 预测复盘闭环：D1 存每日推荐快照 → 开奖后自动对账 → /api/review 滚动命中率 ----------
async function loadDraws(env, k, n) {
  if (k === "ssq") return dedupeByCode(await loadSSQ(env.DB, n));
  if (k === "dlt") return dedupeByCode(await loadDLT(env.DB, n));
  return dedupeByCode(await loadSmall(env.DB, k, n));
}
const PREDLOG_DDL = "CREATE TABLE IF NOT EXISTS predlog (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, code TEXT NOT NULL, payload TEXT NOT NULL, hit TEXT, checked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(kind, code))";
// review-job：adminSync 通过 waitUntil 自 fetch 触发（独立请求独立 CPU 预算）
async function reviewJob(request, env) {
  if (!requireAuth(request, env)) return json({ error: "unauthorized admin" }, 401);
  if (!env.DB) return json({ error: "no db" }, 501);
  const out = {};
  try { await env.DB.prepare(PREDLOG_DDL).run(); } catch (e) { return json({ error: "predlog init: " + String(e) }, 500); }
  for (const k of LOTS.map(x => x.id)) {
    try {
      // 窗口必须 ≥ analyzeAll 的 win=30：v0.10 只取 8 期导致快照 picks 全空（v0.11 修复）
      const draws = await loadDraws(env, k, 60); // 刚同步完，DB 是事实源
      if (!draws.length) { out[k] = { skip: "no draws" }; continue; }
      const byCode = new Map(draws.map(d => [String(d.code), d]));
      const isDigit = !!(SPECS[k] && SPECS[k].type === "digit");
      // ① 对账：checked=0 且该期已开奖的快照 → 算命中并落库
      let checkedN = 0;
      const pend = await env.DB.prepare("SELECT id, code, payload FROM predlog WHERE kind=? AND checked=0 ORDER BY id DESC LIMIT 30").bind(k).all();
      for (const row of (pend.results || [])) {
        const d = byCode.get(String(row.code));
        if (!d) continue;
        try {
          const p = JSON.parse(row.payload);
          const actMain = mainOf(d, k).map(String), actAux = auxOf(d, k).map(String);
          const aSet = new Set(actMain), bSet = new Set(actAux);
          // 数字型：逐位比对——第 i 位只对第 i 位，绝不能退化成「该数字是否出现在开奖号里」，
          // 否则 3D 的 123 会被判成与 321 全中，复盘命中率直接虚高数倍。
          const posHit = dg => dg.reduce((c, v, i) => c + (String(v) === actMain[i] ? 1 : 0), 0);
          const hit = isDigit ? {
            picks: (p.picks || []).map(x => { const dg = (x.digits || x.main || []).map(String); return { name: x.name, digits: dg, hit: posHit(dg) }; }),
            dan: (p.dan || []).map(a => a.map(String)).flat(),
            // 位置下标必须取外层数组的下标：内层 filter((v,i)=>...) 的 i 是「候选内的序号」，
            // 直接拿来索引 actMain 会让每个位置都只与第 1 位比较，danHit 恒为 0（已写回归测试锁定）
            danHit: (p.dan || []).reduce((s, a, pos) => s + a.map(String).filter(v => v === actMain[pos]).length, 0),
            kill: (p.kill || []).map(a => a.map(String)).flat(),
            killWrong: (p.kill || []).flatMap((a, i) => a.map(String).filter(v => v === actMain[i]).map(v => (i + 1) + ":" + v)),
            actual: actMain.join(" ")
          } : {
            picks: (p.picks || []).map(x => ({ name: x.name, main: x.main, hit: (x.main || []).filter(n => aSet.has(n)).length, auxHit: (x.aux || []).filter(n => bSet.has(n)).length })),
            dan: (p.dan || []).map(String), danHit: (p.dan || []).filter(n => aSet.has(n)).length,
            kill: (p.kill || []).map(String), killWrong: (p.kill || []).filter(n => aSet.has(n)),
            actual: actMain.join(" ") + (actAux.length ? " + " + actAux.join(" ") : "")
          };
          // 落库时数字型的 dan/kill 摊平成「候选总数」，命中数已按位算好：
          // 每位置 10 个数字等概 ⇒ Σ候选/Σ命中 的随机基线仍恰为 0.1，与 reviewRoute 的统一口径一致。
          await env.DB.prepare("UPDATE predlog SET hit=?, checked=1 WHERE id=?").bind(JSON.stringify(hit), row.id).run();
          checkedN++;
        } catch {}
      }
      // ② 快照下一期推荐：必须走 recommendAll——analyzeAll 返回的是统计块（无 picks/dan 字段），
      //    v0.10~v0.11.0 误用 analyzeAll 导致快照 picks/dan 恒空（封版审计发现，字段来源修复）；
      //    v0.12.0 再修：v0.11 只修好号码池型，数字型 picks 仍取 .main 而实际字段是 digits，照旧丢号。
      const rec = recommendAll(k, draws, { win: 30 });
      const kl = rec.kill || {};
      const th = kl.threshold ?? 99;
      const payload = isDigit ? {
        picks: (rec.picks || []).slice(0, 3).map(x => ({ name: x.name, digits: (x.digits || []).map(String), number: x.number || null })),
        dan: ((rec.dan && rec.dan.perPos) || []).map(pp => (pp.dan || []).slice(0, 2).map(x => String(x.n))),
        kill: (kl.perPos || []).map(pp => (pp.kill || []).slice(0, 3).map(x => String(x.n))),
        basedOn: draws[0].code
      } : {
        picks: (rec.picks || []).slice(0, 3).map(x => ({ name: x.name, main: x.main, aux: x.aux || [] })),
        dan: ((rec.dan && rec.dan.main) || []).slice(0, 4).map(x => x.n || x),
        kill: (kl.main || []).filter(x => x.votes >= th).map(x => x.n),
        basedOn: draws[0].code
      };
      await env.DB.prepare("INSERT INTO predlog(kind,code,payload) VALUES(?,?,?) ON CONFLICT(kind,code) DO NOTHING").bind(k, nextIssue(draws[0].code), JSON.stringify(payload)).run();
      out[k] = { snapshot: nextIssue(draws[0].code), reconciled: checkedN };
    } catch (e) { out[k] = { error: String(e) }; }
  }
  return json({ ok: true, results: out });
}
// reviewRoute：复盘查询（公开读；汇总各彩种滚动命中率 + 明细）
async function reviewRoute(request, env, url) {
  if (!env.DB) return json({ error: "no db" }, 501);
  const kind = (url.searchParams.get("kind") || "").trim();
  try { await env.DB.prepare(PREDLOG_DDL).run(); } catch {}
  try {
    const rows = kind
      ? await env.DB.prepare("SELECT id,kind,code,payload,hit,checked,created_at FROM predlog WHERE kind=? ORDER BY id DESC LIMIT 100").bind(kind).all()
      : await env.DB.prepare("SELECT id,kind,code,payload,hit,checked,created_at FROM predlog ORDER BY id DESC LIMIT 200").all();
    const list = (rows.results || []).map(r => { try { r.payload = JSON.parse(r.payload); r.hit = r.hit ? JSON.parse(r.hit) : null; } catch {} return r; });
    const agg = {};
    for (const r of list) {
      if (!r.checked || !r.hit) continue;
      const a = agg[r.kind] || (agg[r.kind] = { checked: 0, picksTotal: 0, picksHit: 0, danTotal: 0, danHit: 0, killTotal: 0, killWrong: 0 });
      a.checked++;
      // 数字型对账存的是 digits（逐位），号码池型存 main；两者都要计入总数分母，
      // 否则数字型 picksTotal=0 → pickHitRate 恒 null，复盘页对 4 个数字彩种永远是空白
      for (const p of (r.hit.picks || [])) { const u = p.main || p.digits || []; a.picksTotal += u.length; a.picksHit += p.hit || 0; }
      a.danTotal += (r.hit.dan || []).length; a.danHit += r.hit.danHit || 0;
      a.killTotal += (r.hit.kill || []).length; a.killWrong += (r.hit.killWrong || []).length;
    }
    const summary = {};
    for (const [k, a] of Object.entries(agg)) {
      const s = SPECS[k] || {};
      // 基线口径：号码池型 = 单号被开概率 pick/poolSize；数字型每位置 0-9 等概 = 0.1
      const base = s.type === "digit" ? 0.1 : (s.main ? s.main.pick / (s.main.max - s.main.min + 1) : null);
      // 复盘显著性：命中/杀错都对照「随机单号基线」做二项检验。p<0.05 = 显著偏离随机（杀号看方向：错杀率低于基线才有价值）
      // reliable：样本不够时明确标 false——「没检出信号」和「没能力检出信号」是两件事，不能都渲染成绿的
      const reliable = a.checked >= 30 && a.picksTotal >= 200;
      summary[k] = {
        checked: a.checked,
        reliable,
        note: reliable ? null : "样本不足（对账期数 <30 或单号数 <200），当前无法判断有无偏离",
        pickHitRate: a.picksTotal ? +(a.picksHit / a.picksTotal).toFixed(3) : null,
        pickBaseline: base != null ? +base.toFixed(4) : null,
        pickP: base != null ? binomP(a.picksHit, a.picksTotal, base) : null,
        danHitRate: a.danTotal ? +(a.danHit / a.danTotal).toFixed(3) : null,
        danP: base != null ? binomP(a.danHit, a.danTotal, base) : null,
        killWrongRate: a.killTotal ? +(a.killWrong / a.killTotal).toFixed(3) : null,
        killP: base != null ? binomP(a.killWrong, a.killTotal, base) : null
      };
    }
    const unreconciled = list.filter(r => !r.checked).length;
    return json({ summary, rows: list.slice(0, 50), meta: { total: list.length, unreconciled, hint: Object.keys(summary).length ? null : "复盘尚未产生任何已对账样本：summary 为空表示「没能力判断」，不表示「已验证无效果」" } });
  } catch (e) { return json({ error: String(e) }, 500); }
}
// ---------- meta：彩种元数据 + 数据新鲜度（staleness 保险丝） ----------
// 把 D1 里最新一期距今天数暴露出去：同步任务停摆（Actions 失效 / 上游改版）时前端亮黄条，
// 用户就不会拿着过期数据当最新预测用。10 分钟内存缓存，避免每次进页都打 8 次 D1。
const META_MEM = { at: 0, body: null };
async function metaRoute(env) {
  if (META_MEM.body && Date.now() - META_MEM.at < 600_000) return json(META_MEM.body, 200, 300);
  let stale = null;
  if (env.DB) {
    try {
      const rs = await Promise.all(LOTS.map(async l => {
        try {
          const d = (await loadDraws(env, l.id, 1))[0];
          if (!d || !d.date) return null;
          const t = Date.parse(String(d.date).slice(0, 10) + "T12:00:00+08:00");
          if (!Number.isFinite(t)) return null;
          return { kind: l.id, name: l.name, latest: d.code, date: String(d.date).slice(0, 10), days: Math.floor((Date.now() - t) / 86400e3) };
        } catch { return null; }
      }));
      stale = rs.filter(Boolean).sort((a, b) => b.days - a.days);
    } catch {}
  }
  // 复盘闭环自身的停摆探测：数据新鲜 ≠ 对账在跑。reviewJob 曾静默死掉数天而前端毫无察觉，
  // 因为它只被 adminSync 的 waitUntil 自 fetch 触发。这里把 predlog 的真实状态暴露出去。
  let predlog = null;
  if (env.DB) {
    try {
      const q = await env.DB.prepare("SELECT kind, MAX(code) AS latestSnapshot, MAX(CASE WHEN checked=1 THEN code END) AS latestChecked, SUM(CASE WHEN checked=0 THEN 1 ELSE 0 END) AS unreconciled, MAX(created_at) AS lastCreated FROM predlog GROUP BY kind").all();
      const nameOf = Object.fromEntries(LOTS.map(l => [l.id, l.name]));
      predlog = (q.results || []).map(r => {
        const t = Date.parse(String(r.lastCreated || "").replace(" ", "T") + "Z");
        return { kind: r.kind, name: nameOf[r.kind] || r.kind, latestSnapshot: r.latestSnapshot || null, latestChecked: r.latestChecked || null, unreconciled: r.unreconciled || 0, days: Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400e3) : null };
      }).sort((a, b) => (b.days ?? 9e9) - (a.days ?? 9e9));
    } catch { predlog = null; } // 表不存在（未部署本版本）→ 保持 null，前端不得把「未部署」渲染成「故障」
  }
  const out = { lotteries: LOTS, sources: ["500", "cwl", "17500", "d1"], stale, predlog, disclaimer: "随机游戏，仅供娱乐，不保证中奖" };
  META_MEM.at = Date.now(); META_MEM.body = out;
  return json(out, 200, 300);
}
// ---------- records：破纪录遗漏预警 ----------
// 各号当前遗漏 vs 样本内历史最大遗漏：当前遗漏 ≥ 历史纪录 = 破纪录（这号码从没断更这么久）；
// ≥80% 且纪录 ≥10 期 = 逼近纪录。纯提醒，不构成预测依据——冷号该不来还是不来。
const REC_MEM = new Map();
const REC_TTL = 1800_000;
async function recordsRoute(env) {
  if (!env.DB) return json({ error: "no db" }, 501);
  const mem = REC_MEM.get("all");
  if (mem && Date.now() - mem.at < REC_TTL) return json(mem.body, 200, 300);
  const out = {};
  await Promise.all(LOTS.map(async l => {
    const kind = l.id;
    try {
      const draws = await loadDraws(env, kind, 400);
      const s = SPECS[kind];
      if (!draws.length || !s) { out[kind] = { scanned: draws.length, breaking: [], near: [] }; return; }
      const N = draws.length;
      let items = [];
      if (s.type === "pool") {
        const pool = poolOf(s.main), last = {}, best = {};
        for (const n of pool) { last[n] = -1; best[n] = 0; }
        for (let i = N - 1; i >= 0; i--) {
          const set = new Set(mainOf(draws[i], kind));
          for (const n of pool) {
            if (!set.has(n)) continue;
            const gap = last[n] >= 0 ? last[n] - i : i + 1;
            if (gap > best[n]) best[n] = gap;
            last[n] = i;
          }
        }
        items = pool.map(n => ({ label: n, cur: last[n] >= 0 ? last[n] : N, best: best[n] }));
      } else {
        const D = s.digits || 3;
        const last = Array.from({ length: D }, () => Array(10).fill(-1));
        const best = Array.from({ length: D }, () => Array(10).fill(0));
        for (let i = N - 1; i >= 0; i--) {
          const dg = (draws[i].digits || []).map(x => Number(x));
          for (let p = 0; p < D && p < dg.length; p++) {
            const v = dg[p]; if (!(v >= 0 && v <= 9)) continue;
            const gap = last[p][v] >= 0 ? last[p][v] - i : i + 1;
            if (gap > best[p][v]) best[p][v] = gap;
            last[p][v] = i;
          }
        }
        for (let p = 0; p < D; p++) for (let k = 0; k < 10; k++) items.push({ label: "第" + (p + 1) + "位=" + k, cur: last[p][k] >= 0 ? last[p][k] : N, best: best[p][k] });
      }
      const breaking = items.filter(x => x.best > 0 && x.cur >= x.best);
      const bset = new Set(breaking.map(x => x.label));
      const near = items.filter(x => !bset.has(x.label) && x.best >= 10 && x.cur >= x.best * 0.8);
      const top = [...items].sort((a, b) => b.cur - a.cur).slice(0, 5);
      out[kind] = { scanned: N, breaking, near, top };
    } catch (e) { out[kind] = { error: String(e) }; }
  }));
  const body = { generatedAt: new Date().toISOString(), records: out, note: "遗漏 = 连续未开期数；「破纪录」= 当前遗漏 ≥ 样本内历史最大遗漏。随机游戏，遗漏预警仅供娱乐。" };
  REC_MEM.set("all", { at: Date.now(), body });
  return json(body, 200, 300);
}
function htmlLicenses() {
  const s = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>Licenses</title></head><body><h1>声明</h1><p>自研代码 MIT。逻辑借鉴（自写实现）：sinyu1012 Double-Color-Ball-AI MIT，oahzxd lottoery MIT，BEWINDOWEB lotterygrabber MIT，longgeyyds ssq-fusion MIT，Konata chinese-lottery-predict MIT，zxz0119 lottery-ai-simulator MIT。TheMelody LotteryTrend Apache-2.0（保留声明）。zepen/predict等无License仅借思路未抄码。数据：500/cwl/17500/sporttery归属原站。随机游戏，仅供娱乐，不保证中奖。</p><a href="/">回首页</a></body></html>`;
  return new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function html() {
  return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}
