// 多彩种全量历史：下载 → 结构校验 → 与项目生产 D1 公共接口交叉校验 → 写 data/<kind>.json + data/verify.json
// 用法：node scripts/randomness/fetch-multi.mjs [--api-base=<公共接口地址>] [kind ...]   默认跑全部 7 个新彩种
//      地址也可用环境变量 LOTTERY_API_BASE 提供；两者都不给 → 只做结构校验，线上号码交叉校验被显式跳过。
// 零依赖（只用 node 内置 fetch/fs）。任一彩种交叉校验不过 → 该彩种数据【不写出】，并在 verify.json 里记为 UNVERIFIED，
// multi.mjs 会在报告里点名"哪些彩种没验过、为什么"，绝不悄悄丢弃。
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as pjoin } from "node:path";
import { UA } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = pjoin(HERE, "data");
// 号码交叉校验的目标公共接口（可选）。源码里不写死任何人的站点地址：
//   命令行 --api-base="https://lottery-web.<你的子域>.workers.dev"   或   环境变量 LOTTERY_API_BASE
// 两者都没给 → crossCheck 显式跳过并在 verify.json / 报告里标注「未执行」，该彩种不计入 VERIFIED（闸门不放水，绝不静默当作已通过）。
const API_BASE = ((process.argv.find(a => a.startsWith("--api-base=")) || "").split("=")[1] || process.env.LOTTERY_API_BASE || "")
  .trim().replace(/\/+$/, "");
const log = (...a) => console.log(...a);
const pad2 = x => String(x).padStart(2, "0");

// ---------------------------------------------------------------- 彩种规格（列映射是【待验证的假设】，用结构+交叉校验双闸门）
const num = s => Number(s);
const SPEC = {
  dlt: { url: "http://data.17500.cn/dlt_asc.txt", tokens: 45, type: "pool", code: y => /^\d{5}$/.test(y),
    // front=col2-6(升序), back=col7-8(升序); frontOrd=col9-13, backOrd=col14-15 为开奖顺序，
    // 2007~2008 早期行的顺序列与奖级列都是 "-" 占位 → 那批期次无原始顺序（parse 里置 null），号码本身始终有效。
    parse: t => { const front = t.slice(2, 7).map(num), back = t.slice(7, 9).map(num);
      const fo = t.slice(9, 14).map(num), bo = t.slice(14, 16).map(num);
      const frontOrd = fo.every(Number.isFinite) ? fo : null, backOrd = bo.every(Number.isFinite) ? bo : null;
      const N = x => /^\d+$/.test(x) ? num(x) : 0;   // 奖级/销量早期为 "-" → 0
      return { code: t[0], date: t[1], front, back, frontOrd, backOrd,
        sales: N(t[16]), pool: N(t[17]), n1: N(t[18]), m1: N(t[19]), n2: N(t[20]), m2: N(t[21]) }; },
    validate: r => {
      if (new Set(r.front).size !== 5 || r.front.some(x => !(x >= 1 && x <= 35))) return "前区越界/重复";
      if (join(r.front) !== join([...r.front].sort((a, b) => a - b))) return "前区非升序";
      if (new Set(r.back).size !== 2 || r.back.some(x => !(x >= 1 && x <= 12))) return "后区越界/重复";
      if (join(r.back) !== join([...r.back].sort((a, b) => a - b))) return "后区非升序";
      if (r.frontOrd && (join([...r.frontOrd].sort((a, b) => a - b)) !== join(r.front))) return "前区顺序与集合不符";
      if (r.backOrd && (join([...r.backOrd].sort((a, b) => a - b)) !== join(r.back))) return "后区顺序与集合不符";
      return null; },
    api: { path: "dlt/history?limit=100", compare: (a, o) =>
      eqSet(a.front, o.front) && eqSet(a.back, o.back) } },

  qlc: { url: "http://data.17500.cn/7lc_asc.txt", tokens: 26, type: "pool", code: y => /^\d{7}$/.test(y),
    // 奖级配对起点：col10=sales, col11=pool, (n,m) 从 col12 起 7 对（四/五/六/七等固定奖金 200/50/10/5 恒定 → 已核对）
    parse: t => { const main = t.slice(2, 9).map(num), special = num(t[9]);
      return { code: t[0], date: t[1], main, special, sales: num(t[10]) || 0, pool: num(t[11]) || 0,
        n1: num(t[12]) || 0, m1: num(t[13]) || 0, n2: num(t[14]) || 0, m2: num(t[15]) || 0 }; },
    validate: r => {
      if (new Set(r.main).size !== 7 || r.main.some(x => !(x >= 1 && x <= 30))) return "基本号越界/重复";
      if (join(r.main) !== join([...r.main].sort((a, b) => a - b))) return "基本号非升序";
      if (!(r.special >= 1 && r.special <= 30)) return "特别号越界";
      if (r.main.includes(r.special)) return "特别号与基本号重复";
      return null; },
    api: { path: "qlc/history?limit=100", compare: (a, o) =>
      eqSet(a.main, o.main) && pad2(a.special) === pad2(o.special) } },

  kl8: { url: "http://data.17500.cn/kl8_asc.txt", tokens: 102, minTokens: 101, type: "pool", code: y => /^\d{7}$/.test(y),
    // 奖级/选号玩法列结构复杂且 col22-23 含千分位逗号；随机性只用 20 个开奖号，prize 列标 UNRESOLVED、不参与经济性检验
    parse: t => { const main = t.slice(2, 22).map(num);
      return { code: t[0], date: t[1], main, sales: num((t[22] || "").replace(/,/g, "")) || 0, pool: num((t[23] || "").replace(/,/g, "")) || 0,
        prizeCols: "UNRESOLVED" }; },
    validate: r => {
      if (new Set(r.main).size !== 20 || r.main.some(x => !(x >= 1 && x <= 80))) return "开奖号越界/重复";
      if (join(r.main) !== join([...r.main].sort((a, b) => a - b))) return "开奖号非升序";
      return null; },
    api: { path: "kl8/history?limit=100", compare: (a, o) => eqSet(a.main, o.nums) } },

  fc3d: { url: "http://data.17500.cn/3d_asc.txt", tokens: 17, type: "digit", code: y => /^\d{7}$/.test(y),
    // col2-4=开奖号(独立于 col5-7 的试机号)；API fc3d 的 digits 也取 2-4，实测逐位一致
    parse: t => ({ code: t[0], date: t[1], digits: t.slice(2, 5).map(num), sales: num(t[10]) || 0 }),
    validate: r => r.digits.length === 3 && r.digits.every(x => x >= 0 && x <= 9) ? null : "开奖号非 0-9 三位",
    api: { path: "fc3d/history?limit=100", compare: (a, o) => join(a.digits.map(String)) === join(o.digits.map(String)) } },

  pl3: { url: "http://data.17500.cn/pl3_asc.txt", tokens: 12, type: "digit", code: y => /^\d{7}$/.test(y),
    parse: t => ({ code: t[0], date: t[1], digits: t.slice(2, 5).map(num), sales: num(t[5]) || 0 }),
    validate: r => r.digits.length === 3 && r.digits.every(x => x >= 0 && x <= 9) ? null : "开奖号非 0-9 三位",
    api: { path: "pl3/history?limit=100", compare: (a, o) => join(a.digits.map(String)) === join(o.digits.map(String)) } },

  pl5: { url: "http://data.17500.cn/pl5_asc.txt", tokens: 10, type: "digit", code: y => /^\d{7}$/.test(y),
    parse: t => ({ code: t[0], date: t[1], digits: t.slice(2, 7).map(num), sales: num(t[7]) || 0 }),
    validate: r => r.digits.length === 5 && r.digits.every(x => x >= 0 && x <= 9) ? null : "开奖号非 0-9 五位",
    api: { path: "pl5/history?limit=100", compare: (a, o) => join(a.digits.map(String)) === join(o.digits.map(String)) } },

  qxc: { url: "http://data.17500.cn/7xc_asc.txt", tokens: 23, type: "digit", code: y => /^\d{5}$/.test(y),
    // col2-7=前6位(0-9)，col8=第7位特别号(0-14)。API qxc 把第7位也限制成 0-9，special>9 的行被 API 丢弃 →
    // 交叉校验时前 6 位全比，第 7 位只在 API 有该行时比（这是 API 的限制，不是备源的问题）
    parse: t => ({ code: t[0], date: t[1], digits: t.slice(2, 9).map(num), sales: num(t[9]) || 0 }),
    validate: r => { const d = r.digits;
      if (d.length !== 7) return "位数非 7"; if (d.slice(0, 6).some(x => x < 0 || x > 9)) return "前6位越界";
      if (d[6] < 0 || d[6] > 14) return "第7位越界(应 0-14)"; return null; },
    api: { path: "qxc/history?limit=100", compare: (a, o) => {
      const mine6 = join(a.digits.slice(0, 6).map(String)), their6 = join(o.digits.slice(0, 6).map(String));
      if (mine6 !== their6) return false;
      if (a.digits[6] <= 9 && String(a.digits[6]) !== String(o.digits[6])) return false;   // API 有该行(≤9)才比第7位
      return true; } } },
};
export const MULTI_KINDS = ["dlt", "qlc", "kl8", "fc3d", "pl3", "pl5", "qxc"];
const join = a => a.join();
const uniqSorted = a => join(a) !== join([...a].sort((x, y) => x - y));
const eqSet = (arr, brr) => join([...arr].map(pad2).sort()) === join([...brr].map(x => pad2(x)).sort());

async function download(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/plain,*/*" }, redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`); const txt = await r.text();
      if (txt.trim().split(/\r?\n/).length < 500) throw new Error(`响应过短(${txt.length}B)，疑限流/改版`); return txt; }
    catch (e) { last = e; const w = 3000 * (i + 1); log(`  第${i + 1}次失败：${e.message}；${w / 1000}s 后重试`); await new Promise(s => setTimeout(s, w)); }
  } throw last;
}
async function apiGet(path) {
  const r = await fetch(`${API_BASE}/api/${path}`, { headers: { "User-Agent": UA, "Accept": "application/json" }, redirect: "follow" });
  if (!r.ok) throw new Error(`API HTTP ${r.status}`);
  return JSON.parse(await r.text());
}

function structural(kind, sp, txt) {
  const lines = txt.trim().split(/\r?\n/), rows = [], notes = [];
  let tokBad = 0, dateBad = 0, valBad = 0, codeBad = 0;
  for (const ln of lines) {
    const t = ln.trim().split(/\s+/); if (!t[0]) continue;
    const minTok = sp.minTokens || sp.tokens;
    if (t.length < minTok) { tokBad++; continue; }
    let r; try { r = sp.parse(t); } catch { tokBad++; continue; }
    if (!sp.code(r.code)) { codeBad++; if (codeBad <= 3) notes.push(`${r.code}: 期号格式`); continue; }
    const v = sp.validate(r); if (v) { valBad++; if (valBad <= 5) notes.push(`${r.code}: ${v}`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) dateBad++;
    rows.push(r);
  }
  rows.sort((a, b) => (a.code < b.code ? -1 : 1));
  // 年内期号跳号：期号 = 年前缀 + 年内序号。5 位期号（qxc/dlt）年前缀 2 位，7 位期号年前缀 4 位
  const seq = c => c.length === 5 ? [c.slice(0, 2), +c.slice(2)] : [c.slice(0, 4), +c.slice(4)];
  let jumps = 0;
  for (let i = 1; i < rows.length; i++) { const [ya, sa] = seq(rows[i - 1].code), [yb, sb] = seq(rows[i].code); if (ya === yb && sb !== sa + 1) jumps++; }
  return { rows, tokBad, dateBad, valBad, codeBad, jumps, notes, total: lines.length };
}

async function crossCheck(sp, rows) {
  if (!API_BASE) return { ok: false, skipped: true, err: null, n: 0, match: 0, mis: [], independence: "未配置 --api-base / LOTTERY_API_BASE → 本闸门未执行" };
  let off;
  try { off = await apiGet(sp.api.path); } catch (e) { return { ok: false, err: e.message, independence: sp.id === "dlt" ? "500/未测" : "17500/未测" }; }
  const byCode = new Map(rows.map(r => [r.code, r]));
  let match = 0, cmp = 0; const mis = [];
  for (const o of (Array.isArray(off) ? off : [])) {
    const r = byCode.get(String(o.code).trim()); if (!r) continue;
    cmp++; let eq = false; try { eq = sp.api.compare(r, o); } catch { eq = false; }
    if (eq) match++; else if (mis.length < 4) mis.push(`${o.code} 备源=${JSON.stringify(r.digits || r.front || r.main)} API=${JSON.stringify(o.digits || o.front || o.nums || o.main)}`);
  }
  return { ok: cmp > 0 && match === cmp, n: cmp, match, mis, independence: sp.id === "dlt" ? "500(独立源+独立解析)" : "17500(同源,独立解析校验列映射)" };
}

export async function fetchOne(kind, { useCache = true } = {}) {
  const sp = { ...SPEC[kind], id: kind };
  const rawPath = pjoin(DATA_DIR, sp.url.split("/").pop());   // 原始档名 = url 末段（7xc/3d/7lc 与彩种 id 不同名）
  log(`[${kind}] 下载 ${sp.url}`);
  let txt;
  if (useCache && existsSync(rawPath)) { txt = readFileSync(rawPath, "utf8"); log(`  复用本地原始档（已下载）`); }
  else { txt = await download(sp.url); writeFileSync(rawPath, txt); }
  const st = structural(kind, sp, txt);
  log(`  结构：解析 ${st.rows.length}/${st.total} 行；token 异常 ${st.tokBad}、期号格式错 ${st.codeBad}、值域/结构错误 ${st.valBad}、日期格式异常 ${st.dateBad}、年内跳号 ${st.jumps}`);
  const cc = await crossCheck(sp, st.rows);
  if (cc.skipped) log(`  交叉校验：跳过（未配置 --api-base / LOTTERY_API_BASE）→ 本彩种不计入 VERIFIED`);
  else if (cc.err) log(`  交叉校验：API 不可达 —— ${cc.err}`);
  else log(`  交叉校验 vs D1 API：匹配 ${cc.match}/${cc.n}（${cc.independence}）${cc.ok ? "OK" : " 未全匹配"}`);
  const verified = st.rows.length >= 500 && st.valBad === 0 && st.dateBad === 0 && st.codeBad === 0 && cc.ok;
  return { kind, spec: sp, rows: st.rows, structural: st, crossCheck: cc, verified,
    range: st.rows.length ? [st.rows[0].code, st.rows[st.rows.length - 1].code] : null };
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!API_BASE) log("⚠ 未提供线上公共接口地址（--api-base=... 或 LOTTERY_API_BASE=...）：本轮只做结构校验，"
    + "号码交叉校验闸门不会执行 → 所有彩种都会记为 UNVERIFIED、数据不写出。要出统计结论请指向一个（自建或官方的）公共接口。");
  const kinds = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const run = kinds.length ? kinds : MULTI_KINDS;
  const verify = {}; let allWrite = true;
  for (const kind of run) {
    try {
      const res = await fetchOne(kind);
      verify[kind] = { verified: res.verified, rows: res.rows.length, range: res.range,
        structural: { tokBad: res.structural.tokBad, codeBad: res.structural.codeBad, valBad: res.structural.valBad, dateBad: res.structural.dateBad, jumps: res.structural.jumps, notes: res.structural.notes.slice(0, 5) },
        crossCheck: res.crossCheck };
      if (res.verified) { writeFileSync(pjoin(DATA_DIR, `${kind}.json`), JSON.stringify(res.rows)); log(`  写出 data/${kind}.json（${res.rows.length} 期）`); }
      else { allWrite = false; log(`  !! ${kind} 未通过双闸门，数据【不写出】，将在报告中标注未验证`); }
    } catch (e) { verify[kind] = { verified: false, error: String(e.message || e) }; allWrite = false; log(`  !! ${kind} 失败：${e.message}`); }
  }
  const prevPath = pjoin(DATA_DIR, "verify.json");
  let merged = {}; try { if (existsSync(prevPath)) merged = JSON.parse(readFileSync(prevPath, "utf8")); } catch {}
  writeFileSync(prevPath, JSON.stringify({ ...merged, ...verify, _ts: new Date().toISOString() }, null, 1));
  log(`\n验证结果写入 data/verify.json（${run.join(",")}）`);
  if (!allWrite) { log("部分彩种未验证；multi.mjs 会如实报告，不会静默丢弃。"); }
}
if (process.argv[1] && process.argv[1].includes("fetch-multi")) main().catch(e => { log("FATAL", e); process.exit(1); });
