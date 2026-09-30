// 逐页 × 8 彩种的线上巡检：抓「页面显示不出来」的那类问题。
//
// 只看 HTTP 200 是不够的 —— 200 也会返回空数组 / 空对象 / 全 undefined，
// 而前端往往据此画出一张空图或一行空标签（这正是 v0.15.5 修掉的那个事故）。
//
// 写这个脚本时我犯了两次错，都记在下面当反面教材：
//  · 按名字猜字段（kill.kill / dan.dan）→ 号码池型是 main[].n、数字型是 perPos[].kill
//  · 按猜的 URL 拼（/api/{k}/backtest）→ 正确地址是统一的 /api/backtest?kind=
// 所以这里一律「先探测形状再判定」，且字段名从真实响应里读，不写死。
const BASE = process.env.BASE || "https://cp.leilaomi.cc.cd";
const KINDS = ["ssq", "dlt", "fc3d", "pl3", "pl5", "qlc", "qxc", "kl8"];

const j = async (path) => {
  const r = await fetch(BASE + path);
  if (!r.ok) return { __err: "HTTP " + r.status };
  try { return await r.json(); } catch { return { __err: "bad json" }; }
};
const n = (v) => v == null ? 0 : Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : 0;
// 号码池型给 main 数组、数字型给 perPos 数组；两者都没有才算空
const listOf = (o) => (Array.isArray(o?.main) && o.main.length) ? o.main
  : (Array.isArray(o?.perPos) && o.perPos.length) ? o.perPos : null;

const problems = [];
const note = (k, msg) => problems.push(`${k}: ${msg}`);
const P = (label, k, v) => problems.push(`${label} [${k}]: ${v}`);

console.log("=== 预测页 /api/{k}/predict ===");
for (const k of KINDS) {
  const r = await j(`/api/${k}/predict?win=30`);
  const picks = r.picks || [];
  // 副区只在该彩种本来就有 aux 时才算数（kl8 无副区，aux:[] 是正确的）
  const hasAux = ["ssq", "dlt", "qlc"].includes(k);
  const noMain = picks.filter(p => !(p.main || p.digits || []).length);
  const noAux = hasAux ? picks.filter(p => p.aux === undefined || !(p.aux || []).length) : [];
  const noName = picks.filter(p => !p.name);
  console.log(`  ${k.padEnd(5)} picks=${String(n(picks)).padEnd(3)} kill=${String(n(r.kill)).padEnd(3)} dan=${String(n(r.dan)).padEnd(3)} aux=${hasAux ? "有" : "无(设计如此)"} caliber=${r.caliber ? "y" : "-"}`);
  if (!picks.length) note(k, "predict 无 picks");
  if (noMain.length) P("predict", k, `${noMain.length} 个策略的主号码为空`);
  if (noAux.length) P("predict", k, `${noAux.length} 个策略的副区为空（本彩种有副区）`);
  if (noName.length) P("predict", k, `${noName.length} 个策略缺 name`);
  if (!r.caliber) P("predict", k, "缺 caliber（口径说明）");
}

console.log("\n=== 杀号 / 胆码（号码池 main[] / 数字型 perPos[]）===");
for (const k of KINDS) {
  const kl = await j(`/api/${k}/kill`);
  const dn = await j(`/api/${k}/dan?win=30`);
  const kA = listOf(kl), dA = listOf(dn);
  // 逐项非空：号码池项要有 n，数字型项要有非空 kill[] / dan[]
  const kBad = kA ? kA.filter(x => x.n == null && !(x.kill || []).length).length : -1;
  const dBad = dA ? dA.filter(x => !(x.n != null || (x.dan || []).length)).length : -1;
  console.log(`  ${k.padEnd(5)} kill=${String(kA ? kA.length : 0).padEnd(3)}(空${kBad}) dan=${String(dA ? dA.length : 0).padEnd(3)}(空${dBad}) gate=${kl.insufficient || dn.insufficient ? "GATED" : "-"}`);
  if (!kl.insufficient && !kA) note(k, "kill 无内容也无样本门槛");
  if (!dn.insufficient && !dA) note(k, "dan 无内容也无样本门槛");
  if (kBad > 0) P("kill", k, `${kBad} 项既无号码也无 kill[]`);
  if (dBad > 0) P("dan", k, `${dBad} 项既无 n 也无 dan[]`);
}

console.log("\n=== 历史页 /api/{k}/history ===");
for (const k of KINDS) {
  const r = await fetch(`${BASE}/api/${k}/history?limit=30`);
  const arr = await r.json();
  const bad = Array.isArray(arr) ? arr.filter(d => !(d.code || d.date)) : [];
  console.log(`  ${k.padEnd(5)} n=${String(Array.isArray(arr) ? arr.length : 0).padEnd(4)} X-Sources=${r.headers.get("X-Sources") || "-"}`);
  if (!Array.isArray(arr) || arr.length === 0) note(k, "history 不是非空数组");
  if (bad.length) P("history", k, `${bad.length} 行缺 code/date`);
}

console.log("\n=== 分析页 /api/{k}/analyze（v0.15.5 契约）===");
for (const k of KINDS) {
  const r = await j(`/api/${k}/analyze?win=30`);
  const digit = Array.isArray(r.perPos);
  if (digit) {
    const posBad = r.perPos.filter(p => !Object.keys(p.freq || {}).length || !Object.keys(p.omission?.cur || {}).length);
    console.log(`  ${k.padEnd(5)} 数字型 perPos=${r.perPos.length} freq键=${n(r.perPos[0]?.freq)} omission键=${n(r.perPos[0]?.omission?.cur)} sources=${(r.sources || []).join("+") || "-"}`);
    if (posBad.length) P("analyze", k, `${posBad.length} 个位置的 freq/omission 为空`);
  } else {
    const keys = n(r.freq);
    console.log(`  ${k.padEnd(5)} 号码池 freq=${String(keys).padEnd(4)} omission=${n(r.omission?.cur)} shape=${n(r.shape)} sources=${(r.sources || []).join("+") || "-"}`);
    if (!keys) note(k, "analyze 无 freq");
    if (keys && n(r.omission?.cur) !== keys) P("analyze", k, `omission 键数 ${n(r.omission?.cur)} ≠ freq 键数 ${keys}`);
    for (const f of ["hot", "cold", "oddRatio", "bigRatio", "primeRatio", "avgSum", "avgAC", "avgConsec", "avgRepeat"])
      if (r[f] == null || (Array.isArray(r[f]) && !r[f].length)) P("analyze", k, `缺字段 ${f}`);
    if (!r.shape || !r.shape.sum) P("analyze", k, "shape 为空（形态转移卡不显示）");
  }
}

console.log("\n=== 分析页 /api/backtest?kind=（正确地址）===");
for (const k of KINDS) {
  const r = await j(`/api/backtest?kind=${k}&periods=40`);
  if (r.__err) { P("backtest", k, r.__err); console.log(`  ${k.padEnd(5)} ${r.__err}`); continue; }
  const keys = Object.keys(r).filter(x => x !== "kind" && x !== "degraded");
  const s = r.strategies || r.results || r.byStrategy;
  const sN = s ? n(s) : 0;
  console.log(`  ${k.padEnd(5)} 字段=${keys.length} 策略=${sN} tested=${r.tested ?? "-"} stride=${r.stride ?? "-"}`);
  if (!keys.length) note(k, "backtest 无字段");
}

console.log("\n=== 分析页 /api/trend?kind= ===");
for (const k of KINDS) {
  const r = await j(`/api/trend?kind=${k}&limit=30`);
  const rows = r.rows || [];
  const digit = ["fc3d", "pl3", "pl5", "qxc"].includes(k);
  if (digit) {
    console.log(`  ${k.padEnd(5)} rows=0（数字型无号码池，设计如此）`);
  } else {
    console.log(`  ${k.padEnd(5)} rows=${String(rows.length).padEnd(4)} missKeys=${rows.length ? n(rows[0].miss) : 0}`);
    if (!rows.length) note(k, "号码池型 trend 无数据");
    if (rows.length && !n(rows[0].miss)) note(k, "trend 有行但 miss 为空");
  }
}

console.log("\n=== 预测页 冷门度 /api/coldness（有副区的传 blue）===");
for (const k of KINDS) {
  const hasAux = ["ssq", "dlt", "qlc"].includes(k);
  const r = await j(`/api/coldness?kind=${k}&nums=01,02,03,04,05,06${hasAux ? "&blue=07" : ""}`);
  const supported = r.supported !== false;
  console.log(`  ${k.padEnd(5)} supported=${supported} coldIndex=${r.coldIndex ?? "-"} label=${r.label || "-"}`);
  if (k === "ssq" && r.coldIndex == null) P("coldness", k, "ssq 是唯一有系数的彩种，却没返回 coldIndex");
  if (!supported && !r.note) P("coldness", k, "不支持但没有说明（会显示成静默空白）");
}

console.log("\n=== 日报 /api/records + /api/review + /api/meta ===");
const rec = await j("/api/records");
for (const k of KINDS) {
  const x = rec.records?.[k];
  console.log(`  records ${k.padEnd(5)} ${x ? `scanned=${x.scanned} breaking=${n(x.breaking)} near=${n(x.near)} top=${n(x.top)}` : "缺该彩种"}`);
  if (!x) note(k, "records 缺该彩种");
  if (x && !n(x.top)) note(k, "records top 为空");
}
const rv = await j("/api/review");
console.log(`  review rows=${n(rv.rows)} kinds=${Object.keys(rv.summary || {}).join(",") || "无"}`);
if (!n(rv.rows)) note("review", "review 无 rows");
const meta = await j("/api/meta");
console.log(`  meta stale=${n(meta.stale)} fields=${Object.keys(meta).join(",")}`);
if (!n(meta.stale)) note("meta", "stale 为空（过期保险丝没有数据源）");

console.log("\n================ 结论 ================");
if (!problems.length) console.log("未发现空响应 / 空字段问题");
else { console.log("发现 " + problems.length + " 处："); problems.forEach(p => console.log("  ✗ " + p)); }