// 拉取双色球全量历史 → 结构校验 → 与官方 cwl 接口交叉校验 → 写 data/ssq.json
// 用法：node scripts/randomness/fetch-ssq.mjs
// 零依赖（只用 node 内置 fetch/fs）。网络不可用时：打印原始错误并以非零码退出，
// 绝不写出"半成品"数据文件，也不静默成功（analyze.mjs 会因为没有数据而拒绝运行）。
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_FILE, SOURCE_FILE, CWL_API, CWL_INDEX, UA, validateRow } from "./lib.mjs";

const OUT_DIR = join(DATA_FILE, "..");
const RAW_CACHE = join(OUT_DIR, "ssq_asc.txt");   // 保留原始 txt，便于事后复核解析
const log = (...a) => console.log(...a);

// ------------------------------------------------------------- 1. 下载备用源
async function download(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/plain,*/*" }, redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt = await r.text();
      if (txt.trim().split(/\r?\n/).length < 1000) throw new Error(`响应过短（${txt.length} 字节），疑似被限流或改版`);
      return txt;
    } catch (e) {
      last = e;
      const wait = 3000 * (i + 1);   // data.17500.cn 实测易 429 → 退避重试
      log(`  第 ${i + 1} 次失败：${e.message}；${wait / 1000}s 后重试`);
      await new Promise(s => setTimeout(s, wait));
    }
  }
  throw last;
}

// ------------------------------------------------------------- 2. 解析（与历史版本同一套铁律）
function parse(txt) {
  const lines = txt.trim().split(/\r?\n/), rows = [], bad = [];
  for (const ln of lines) {
    const t = ln.trim().split(/\s+/);
    if (t.length < 15) { bad.push(["字段过少", ln.slice(0, 40)]); continue; }
    const code = t[0], date = t[1];
    const red = t.slice(2, 8).map(Number), blue = Number(t[8]);
    const order = t.slice(9, 15).map(Number);
    const tail = t.slice(15).map(x => (x === "" ? NaN : Number(x)));
    const row = { code, date, red, blue, order,
      sales: tail[0] || 0, pool: tail[1] || 0,
      n1: tail[2] || 0, m1: tail[3] || 0, n2: tail[4] || 0, m2: tail[5] || 0,
      n3: tail[6] || 0, n4: tail[8] || 0, n5: tail[10] || 0, n6: tail[12] || 0 };
    const v = validateRow(row);           // 红 6 不重复 01-33 升序 / 蓝 01-16 / 顺序是集合的排列
    if (v) { bad.push([v, code]); continue; }
    rows.push(row);
  }
  rows.sort((a, b) => (a.code < b.code ? -1 : 1));
  return { rows, bad, total: lines.length };
}

// ------------------------------------------------------------- 3. 官方源交叉校验
// cwl 有 WAF：必须先 GET 公示页拿 cookie，再带 UA + Referer(+Cookie) 打接口，否则 result 为空。
async function fetchOfficial(count = 30) {
  let cookie = "";
  try {
    const i = await fetch(CWL_INDEX, { headers: { "User-Agent": UA, "Referer": "https://www.cwl.gov.cn/" }, redirect: "follow" });
    const sc = typeof i.headers.getSetCookie === "function" ? i.headers.getSetCookie() : [i.headers.get("set-cookie")].filter(Boolean);
    const pair = sc.map(s => (s || "").split(";")[0].trim()).filter(Boolean).join("; ");
    if (pair) cookie = pair;
    log(`  官方公示页 HTTP ${i.status}，拿到 cookie：${cookie ? "yes" : "no（继续裸试接口）"}`);
  } catch (e) { log(`  官方公示页不可达：${e.message}（继续裸试接口）`); }
  const r = await fetch(CWL_API, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": CWL_INDEX, ...(cookie ? { Cookie: cookie } : {}) }, redirect: "follow" });
  if (!r.ok) throw new Error(`cwl HTTP ${r.status}`);
  const j = JSON.parse(await r.text());
  if (!Array.isArray(j.result) || !j.result.length) throw new Error("cwl 返回空 result（多半是 WAF/cookie 未生效）");
  return j.result;
}
const parseNum = s => { const n = Number(String(s).replace(/[^\d.]/g, "")); return Number.isNaN(n) ? 0 : n; };

function crossCheck(rows, official) {
  const byCode = new Map(rows.map(r => [r.code, r]));
  // 最新 1-2 期的奖级/销量官方都还在结算中（六等奖注数会补），跳过以免误报
  const sample = official.slice().sort((a, b) => (a.code < b.code ? 1 : -1)).slice(2);
  let agree = 0, numOk = 0, issues = [];
  for (const o of sample) {
    const r = byCode.get(String(o.code).trim());
    if (!r) { issues.push(`${o.code} 备用源缺失`); continue; }
    const off = String(o.red).split(",").map(Number).sort((a, b) => a - b);
    if (off.join() !== r.red.join() || Number(o.blue) !== r.blue) { issues.push(`${o.code} 号码不一致 官方=${off.join()}+${o.blue} 备用=${r.red.join()}+${r.blue}`); continue; }
    numOk++;
    const pg = {}; for (const g of (o.prizegrades || [])) pg["n" + g.type] = parseNum(g.typenum);
    const cmp = { sales: [r.sales, parseNum(o.sales)], pool: [r.pool, parseNum(o.poolmoney)], n1: [r.n1, pg.n1], n2: [r.n2, pg.n2], n3: [r.n3, pg.n3], n4: [r.n4, pg.n4], n5: [r.n5, pg.n5], n6: [r.n6, pg.n6] };
    const diff = Object.entries(cmp).filter(([, [a, b]]) => b > 0 && a !== b);   // 官方为 0/缺 = 未公布，跳过该字段
    if (!diff.length) agree++; else issues.push(`${o.code} ${diff.map(([k, [a, b]]) => `${k}: 备用=${a.toLocaleString()} vs 官方=${b.toLocaleString()}`).join(", ")}`);
  }
  return { n: sample.length, agree, numOk, issues };
}

// ------------------------------------------------------------- 主流程
const started = new Date().toISOString();
const safeJson = p => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
// 与新解析结果和「已提交且上一轮经官方逐字段核对过」的基线逐期比：号码、销量、奖池、一~六等注数
function baselineCompare(rows, base) {
  const B = new Map(base.map(r => [String(r.code), r]));
  let n = 0, numDiff = 0, fieldDiff = 0;
  for (const r of rows) {
    const b = B.get(String(r.code)); if (!b) continue;
    n++;
    const sameNum = String(r.red.join(",")) === String(b.red ? (Array.isArray(b.red) ? b.red.join(",") : b.red) : "")
      && String(r.blue) === String(b.blue);
    if (!sameNum) { numDiff++; continue; }
    for (const f of ["sales", "pool", "n1", "n2", "n3", "n4", "n5", "n6"]) {
      if (Number(r[f] || 0) !== Number(b[f] || 0)) { fieldDiff++; break; }
    }
  }
  const lastBase = String(base[base.length - 1].code);
  const added = rows.filter(r => String(r.code) > lastBase).length;
  return { n, numDiff, fieldDiff, added };
}

try {
  log(`[1/4] 下载 ${SOURCE_FILE}`);
  let txt;
  if (existsSync(RAW_CACHE) && process.env.RANDOMNESS_USE_CACHE) {   // 只在显式允许时用本地缓存
    txt = readFileSync(RAW_CACHE, "utf8");
    log(`  使用本地缓存 ${RAW_CACHE}（RANDOMNESS_USE_CACHE=1）`);
  } else {
    txt = await download(SOURCE_FILE);
    log(`  得到 ${(txt.length / 1024).toFixed(0)} KB`);
  }
  log("[2/4] 解析 + 结构校验");
  const { rows, bad, total } = parse(txt);
  if (rows.length < 3000) throw new Error(`解析结果异常：仅 ${rows.length} 期（应为 3000+）`);
  log(`  成功 ${rows.length} 期 / 总行 ${total} / 丢弃 ${bad.length}${bad.length ? "（" + bad.slice(0, 5).map(b => b.join(":")).join(" | ") + " …）" : ""}`);
  log(`  期号范围 ${rows[0].code}(${rows[0].date}) → ${rows[rows.length - 1].code}(${rows[rows.length - 1].date})`);
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].code, b = rows[i].code;
    if (a.slice(0, 4) === b.slice(0, 4) && Number(b.slice(4)) !== Number(a.slice(4)) + 1) gaps.push(`${a}→${b}`);
  }
  log(`  同年内期号跳号 ${gaps.length} 处${gaps.length ? "：" + gaps.slice(0, 8).join(" ") : ""}`);
  const withSales = rows.filter(r => r.sales > 0).length;
  log(`  销量字段有值 ${withSales} 期；一二三等奖注数有值 ${rows.filter(r => r.n1 > 0).length}/${rows.filter(r => r.n2 > 0).length}/${rows.filter(r => r.n3 > 0).length} 期`);

  log("[3/4] 与官方 cwl.gov.cn 交叉校验（号码 + 销量/奖池/一~六等注数）");
  let verdict = "跳过（官方源不可达）", fatal = false;
  let xcheck = { status: "official-ok", at: new Date().toISOString(), note: "" };
  try {
    const official = await fetchOfficial();
    const c = crossCheck(rows, official);
    verdict = `号码一致 ${c.numOk}/${c.n}；注数/销量逐字段全同 ${c.agree}/${c.n}`;
    if (c.issues.length) { verdict += " | 差异：" + c.issues.slice(0, 3).join(" ; "); fatal = true; }
    if (c.n < 10) { verdict += " | 可比样本过少"; fatal = true; }
    xcheck = { status: "official-ok", at: new Date().toISOString(), n: c.n, numOk: c.numOk, agree: c.agree, note: verdict };
  } catch (e) {
    // 区分两件事：官方源「不可达」（机房 IP 被 WAF 挡，HTTP 403 属此类）与数据「不一致」。
    // 前者降级为与仓库基线（上一轮经官方逐字段核对过、已提交的 data/ssq.json）做回归比对：
    // 重叠历史上任何一个字段变了 = 备源改写了历史 = 仍然硬失败；完全一致才放行，但如实标注
    // 「尾部新增期未经官方核对」。否则月度作业会永远红，而永远红的红灯没人看。
    verdict = `官方源不可达（${e.message}）→ 降级为仓库基线回归比对`;
    const base = existsSync(DATA_FILE) ? safeJson(DATA_FILE) : null;
    if (!base || base.length < 3000) {
      verdict += "：无可用基线（data/ssq.json 缺失或过短），不放行";
      fatal = true;
      xcheck = { status: "unavailable-no-baseline", at: new Date().toISOString(), note: String(e.message) };
    } else {
      const c = baselineCompare(rows, base);
      verdict += `：重叠 ${c.n} 期，号码不一致 ${c.numDiff}，销量/注数不一致 ${c.fieldDiff}，基线之后新增 ${c.added} 期未经官方核对`;
      if (c.numDiff || c.fieldDiff || c.n < 3000) {
        verdict += " → 备源改写了已核对过的历史，硬失败";
        fatal = true;
      }
      xcheck = { status: c.numDiff || c.fieldDiff ? "mismatch-vs-baseline" : "degraded-baseline-regression",
        at: new Date().toISOString(), n: c.n, numDiff: c.numDiff, fieldDiff: c.fieldDiff, added: c.added, note: String(e.message) };
    }
  }
  log("  " + verdict);
  if (fatal) throw new Error("交叉校验未通过：宁可不出结果，也不用未经核对的数据下结论");

  log("[4/4] 写出数据文件");
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(rows));
  writeFileSync(RAW_CACHE, txt);   // 原始 txt 一并留档，便于事后复核解析
  writeFileSync(join(OUT_DIR, "crosscheck.json"), JSON.stringify(xcheck, null, 1));
  log(`  ${DATA_FILE}（${(JSON.stringify(rows).length / 1024).toFixed(0)} KB，${rows.length} 期）`);
  log(`\nFETCH OK ${started}  ${rows[0].code} → ${rows[rows.length - 1].code}`);
  log(xcheck.status === "official-ok" ? "CROSSCHECK: OFFICIAL-OK" : "CROSSCHECK: DEGRADED（" + xcheck.status + "）");
} catch (e) {
  log(`\nFETCH FAILED：${e && e.message ? e.message : e}`);
  log("  原始错误：", e && e.cause ? e.cause : e);
  if (e && e.name === "TypeError" && /fetch failed/i.test(String(e.message))) {
    log("  → 多为网络不可达 / DNS / 上游 429。本步骤不做静默降级：analyze.mjs 会在数据缺失或过期时拒绝运行。");
  }
  log("  → 离线复现历史结论：node scripts/randomness/analyze.mjs（用仓库里已提交的 data/ssq.json，必要时 RANDOMNESS_ALLOW_STALE=1）");
  process.exit(1);
}
