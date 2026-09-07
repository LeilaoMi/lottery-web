import { fetch500, fetchCWL, fetch17500, analyze, blueScores, recommend, trend, verify } from "./ssq.js";
import { fetchDLT, analyzeDLT, verifyDLT, fetch17500DLT } from "./dlt.js";
import { fetchSmall, prizeSSQ, prizeDLT, rotation } from "./small.js";
import { saveSSQ, loadSSQ, logSync } from "./db.js";
const LOTS = [{ id: "ssq", name: "双色球", rule: "红6/33+蓝1/16", days: "二四日" }, { id: "dlt", name: "大乐透", rule: "前5/35+后2/12", days: "一三六" }, { id: "fc3d", name: "福彩3D", rule: "3位0-9", days: "每日" }, { id: "pl3", name: "排列3", rule: "3位0-9", days: "每日" }, { id: "pl5", name: "排列5", rule: "5位0-9", days: "每日" }, { id: "qlc", name: "七乐彩", rule: "7/30+特别", days: "一三五" }, { id: "qxc", name: "七星彩", rule: "7位0-9", days: "二五日" }, { id: "kl8", name: "快乐8", rule: "20/80", days: "每日" }];
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") return html();
    if (url.pathname === "/favicon.ico") return new Response("", { status: 204 });
    if (url.pathname === "/health") return json({ status: "ok", version: env.VERSION || "0.4.0", lotteries: LOTS.map(x => x.id) });
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
  const m = url.pathname.match(/^\/api\/(fc3d|pl3|pl5|qlc|qxc|kl8)\/(latest|history)$/);
  if (!m) return json({ error: "not_found" }, 404);
  try {
    const cache = caches.default, ck = new Request(url.toString());
    const hit = await cache.match(ck);
    if (hit) return hit;
    const draws = await fetchSmall(m[1], 60);
    const res = m[2] === "latest" ? json(draws[0], 200, 600) : json(draws.slice(0, num(url, "limit", 30, 1, 100)), 200, 600);
    try { await cache.put(ck, res.clone()); } catch {}
    return res;
  } catch (e) { return json({ error: String(e.message || e) }, 502); }
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
  return json(out);
}
async function favsRoute(request, env, url) {
  if (!env.DB) return json({ error: "no db" }, 501);
  if (request.method === "GET") {
    try { const r = await env.DB.prepare("SELECT id,kind,numbers,note,created_at FROM favs ORDER BY id DESC LIMIT 100").all(); return json(r.results || []); } catch (e) { return json({ error: String(e) }, 500); }
  }
  if (!env.API_TOKEN || (request.headers.get("Authorization") || "") !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
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
  const s = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>自用彩票全版</title><script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"><\/script><style>body{font-family:system-ui;margin:0;background:#f6f7fb}header{position:sticky;top:0;background:#fff;padding:10px;display:flex;gap:6px;flex-wrap:wrap}select,button,input{padding:8px 10px;border:1px solid #ddd;border-radius:8px;background:#fff}button.on{background:#111;color:#fff}.wrap{max-width:980px;margin:auto;padding:12px}.card{background:#fff;border-radius:12px;padding:12px;margin:8px 0}.ball{display:inline-block;min-width:28px;height:28px;line-height:28px;text-align:center;border-radius:50%;background:#e11;color:#fff;margin:2px}.ball.b{background:#06c}.muted{color:#666;font-size:12px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #eee;padding:3px;text-align:center}.hit{background:#ffe58f}</style></head><body><header><b>自用全版</b><select id="lot"><option value="ssq">双色球</option><option value="dlt">大乐透</option><option value="fc3d">福彩3D</option><option value="pl3">排列3</option><option value="pl5">排列5</option><option value="qlc">七乐彩</option><option value="qxc">七星彩</option><option value="kl8">快乐8</option></select><button class="on" data-t="p">预测</button><button data-t="a">分析</button><button data-t="h">历史</button><button data-t="v">验奖+矩阵</button></header><div class="wrap"><div id="p" class="card">加载中…</div><div id="a" class="card" style="display:none"><div id="chart" style="height:260px"></div><div id="stats" class="muted"></div></div><div id="h" class="card" style="display:none"></div><div id="v" class="card" style="display:none"><input id="vc" placeholder="期号"><input id="vr" placeholder="号码逗号分隔" style="width:50%"><button id="go">验奖</button> <input id="mn" placeholder="矩阵n如12" style="width:80px"><input id="mp" placeholder="选6" style="width:60px"><button id="go2">矩阵</button><div id="vo"></div></div><p class="muted">全8种+奖等+矩阵。随机娱乐。<a href="/health">health</a> <a href="/api/meta">meta</a></p></div><script>const $=s=>document.querySelector(s);let L='ssq';document.querySelectorAll('header button').forEach(b=>b.onclick=()=>{document.querySelectorAll('header button').forEach(x=>x.classList.remove('on'));b.classList.add('on');['p','a','h','v'].forEach(id=>document.getElementById(id).style.display=id===b.dataset.t?'':'none')});document.getElementById('lot').onchange=e=>{L=e.target.value;load()};document.getElementById('go').onclick=async()=>{let u='/api/'+L+'/verify?code='+document.getElementById('vc').value;const v=document.getElementById('vr').value;if(L==='ssq'){const a=v.split(/[ ,]+/);u+='&red='+a.slice(0,6).join(',')+'&blue='+(a[6]||'')}else if(L==='dlt'){const a=v.split(/[ ,]+/);u+='&front='+a.slice(0,5).join(',')+'&back='+a.slice(5,7).join(',')}document.getElementById('vo').textContent=JSON.stringify(await (await fetch(u)).json())};document.getElementById('go2').onclick=async()=>{document.getElementById('vo').textContent=JSON.stringify(await (await fetch('/api/rotation?n='+(document.getElementById('mn').value||12)+'&pick='+(document.getElementById('mp').value||6))).json())};async function load(){const j=async p=>(await fetch(p)).json();const latest=await j('/api/'+L+'/latest');const his=await j('/api/'+L+'/history?limit=20');document.getElementById('h').innerHTML=his.slice(0,20).map(d=>'<div>'+d.code+' '+JSON.stringify(d).slice(0,120)+'</div>').join('');if(L==='ssq'){const rec=await j('/api/ssq/recommend');const an=await j('/api/ssq/analyze?win=30');document.getElementById('p').innerHTML='<h3>'+latest.code+' '+latest.red.map(x=>'<span class=ball>'+x+'</span>').join('')+'<span class="ball b">'+latest.blue+'</span></h3>'+rec.picks.map(p=>'<div>'+p.name+'('+p.score+') '+p.red.join(' ')+' +'+p.blue+'</div>').join('');const c=echarts.init(document.getElementById('chart'));const f=an.analysis.redFreq;const ks=Object.keys(f).sort();c.setOption({xAxis:{type:'category',data:ks},yAxis:{type:'value'},series:[{type:'bar',data:ks.map(k=>f[k])}]});document.getElementById('stats').textContent='热:'+an.analysis.hotRed+' 蓝:'+an.blue.top1}else if(L==='dlt'){const an=await j('/api/dlt/analyze?win=30');document.getElementById('p').innerHTML='<h3>'+latest.code+' '+latest.front.join(' ')+' + '+latest.back.join(' ')+'</h3>';document.getElementById('stats').textContent='热前:'+an.hotFront}else{document.getElementById('p').innerHTML='<h3>'+latest.code+'</h3><pre>'+JSON.stringify(latest,null,1)+'</pre>'}}load()<\/script></body></html>`;
  return new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
