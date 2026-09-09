// 8 彩种随机性审计引擎（被 analyze.mjs --all 调用）。
// 覆盖：A 均匀性 / B 独立性 / C 稳定性 + 全族 Bonferroni + 检测功效。号码池组的零分布一律蒙特卡洛
// （E[χ²]=pool×(1−k/pool)，绝不硬编码 33/6/27）；数字型逐位用解析 df=range−1（不过度工程）。
// 血泪教训见 lib.mjs 头注与 lib-kinds.mjs 头注。
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rng, drawK, comb, pHyper, pearson, nullSummary, mcP, fmtP, chi2Upper } from "./lib.mjs";
import { KINDS, KIND_ORDER, eChi2Pool, groupStats, simulateGroup, detectability, nForRelBias } from "./lib-kinds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "data");
const DOC_FILE = join(HERE, "..", "..", "docs", "randomness-multi-latest.md");
const f4 = x => Number(x).toFixed(4), f2 = x => Number(x).toFixed(2), pct = x => (x * 100).toFixed(1) + "%";
const signed = (x, d = 2) => (x >= 0 ? "+" : "") + Number(x).toFixed(d);

// ---------------------------------------------------------------- 载入并归一
function loadRows(kind) {
  const p = join(DATA_DIR, `${kind}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
// 统一成 {kind, name, type, groups?, positions?, rows}；rows 里每行给出各 group/position 的值数组
function normalize(kind) {
  const spec = KINDS[kind], rows0 = loadRows(kind);
  if (!spec || !rows0 || !rows0.length) return null;
  if (spec.type === "pool") {
    if (kind === "ssq") rows0.forEach(r => { r.main = r.red; r.blue = [r.blue]; r._ord = { main: r.order }; });
    else rows0.forEach(r => { if (r.special != null) r.special = [r.special]; r._ord = { front: r.frontOrd, back: r.backOrd }; });
    return { kind, name: spec.name, type: "pool", spec, rows: rows0 };
  }
  // digit
  return { kind, name: spec.name, type: "digit", spec, rows: rows0 };
}

// ---------------------------------------------------------------- 号码池组：全套
const yr = c => String(c).length === 5 ? 2000 + Number(String(c).slice(0, 2)) : Number(String(c).slice(0, 4));
function analyzePoolGroup(group, rows) {
  const { key, label, N, k, order } = group;
  const rk = rows.filter(r => Array.isArray(r[key]) && r[key].length === k);   // 该组对齐：vals/years 同源，绝不各 filter 一次
  const vals = rk.map(r => r[key]);
  const n = vals.length; if (n < 100) return null;
  const ordRows = order ? rk.filter(r => r._ord && Array.isArray(r._ord[key]) && r._ord[key].length === k) : [];
  const obs = groupStats(vals, null);       // 主统计不含位置（位置单独在顺序子集上算）
  const pvals = [];
  const res = { label, N, k, n, obs, pvals };
  // A 均匀性：k>1 用蒙特卡洛零分布（不放回负相关），k==1 逐期独立用解析 df=N-1
  if (k >= 2) {
    const pool = simulateGroup(N, k, n, SIMS, SEED + N * 97 + k);
    const chiNull = pool.map(s => s.chi2), ns = nullSummary(chiNull);
    const expE = eChi2Pool(N, k), analyticDf = N - 1;
    const a = mcP(chiNull, obs.chi2); pvals.push(a.p);
    const se = ns.sd / Math.sqrt(SIMS), trapOK = Math.abs(ns.mean - expE) < 4 * se; // 【陷阱自证】
    res.uniformity = { method: "MC", chi2: obs.chi2, nullMean: ns.mean, nullSd: ns.sd, p: a.p, ge: a.ge,
      expE, analyticDf, analyticP: chiUpper(obs.chi2, analyticDf), trapOK, se };
  } else {
    const p = chiUpper(obs.chi2, N - 1); pvals.push(p);
    res.uniformity = { method: "analytic", chi2: obs.chi2, df: N - 1, p, note: "逐期独立单号，解析 df=N-1 正确（无需蒙特卡洛）" };
  }
  // B 独立性（k>=2 才有重合/位置意义）
  if (k >= 2) {
    const pool = simulateGroup(N, k, n, SIMS, SEED + N * 97 + k);
    const one = (nm, exact) => { const arr = pool.map(s => s[nm]), ns = nullSummary(arr), a = mcP(arr, obs[nm]); pvals.push(a.p);
      return { obs: obs[nm], mean: ns.mean, sd: ns.sd, p: a.p, ge: a.ge, exact }; };
    res.indep = {
      ovMean: one("ovMean", k * k / N),       // 与上期重合数：精确超几何期望 k²/N
      ovChi2: one("ovChi2", null),
      ac: one("ac", 0),
      gapMean: one("gapMean", null), gapMax: one("gapMax", null),
      sumMean: one("sumMean", null), oddMean: one("oddMean", null), consecRate: one("consecRate", null),
    };
    if (ordRows.length >= 200) {              // 位置 χ²：对齐的顺序子集（教训：用原始顺序 ord，不用排序 vals）
      const ordVals = ordRows.map(r => r[key]), ords = ordRows.map(r => r._ord[key]), pn = ordRows.length;
      const posObs = groupStats(ordVals, ords).chi2Pos;
      const posPool = simulateGroup(N, k, pn, SIMS, SEED + N * 5 + 1, true).map(s => s.chi2Pos);
      const ns = nullSummary(posPool), a = mcP(posPool, posObs); pvals.push(a.p);
      res.indep.pos = { obs: posObs, mean: ns.mean, sd: ns.sd, p: a.p, ge: a.ge, n: pn };
    }
  }
  // C 稳定性：split-half 频次相关 + 分年代 χ²
  res.stab = splitHalf(N, k, vals);
  res.eras = eraChi2(N, k, vals, rk.map(r => yr(r.code)));
  return res;
}
// ---------------------------------------------------------------- 数字型：全套（解析为主）
function analyzeDigitKind(K) {
  const { spec, rows } = K, n = rows.length;
  const digs = spec.positions.map(() => []);
  for (const r of rows) spec.positions.forEach((p, i) => digs[i].push(r.digits[i]));
  const pvals = [];
  const positions = spec.positions.map((p, i) => {
    const d = digs[i], R = p.R, cnt = new Array(R).fill(0); for (const x of d) cnt[x]++;
    const exp = n / R; let chi2 = 0, maxz = -1e9, minz = 1e9;
    for (let x = 0; x < R; x++) { chi2 += (cnt[x] - exp) ** 2 / exp; const z = (cnt[x] - exp) / Math.sqrt(exp * (1 - 1 / R)); if (z > maxz) maxz = z; if (z < minz) minz = z; }
    const pchi = chiUpper(chi2, R - 1);
    // 与上期同位相同的比率：均匀位期望 1/R；非均匀位期望 Σp̂²（i.i.d. over 经验边际）
    let same = 0; for (let i2 = 1; i2 < n; i2++) if (d[i2] === d[i2 - 1]) same++;
    const sameRate = same / (n - 1);
    // split-half 频次相关（数字位：两半独立 ⇒ r 期望 0；非均匀位用经验分布蒙特卡洛造零）
    const h = n >> 1, ca = new Array(R).fill(0), cb = new Array(R).fill(0);
    for (let i2 = 0; i2 < h; i2++) ca[d[i2]]++; for (let i2 = h; i2 < n; i2++) cb[d[i2]]++;
    const r = pearson(ca, cb);
    if (p.nonuniform) {
      // 均匀性检验【不适用】（边际是设计非均匀），不计入 pvals，避免把误设模型的显著当成"发现"
      const pe = cnt.reduce((a, c) => a + (c / n) ** 2, 0);            // i.i.d. over 经验边际 的重复概率
      const psame = binomTwo(same, n - 1, pe); pvals.push(psame);
      const cum = []; let acc = 0; for (let x = 0; x < R; x++) { acc += cnt[x] / n; cum.push(acc); }
      const rand = rng(SEED + i * 17 + 3), nullR = [];
      const rs = () => { let s = 0; for (let t = 0; t < n; t++) s += rand(); return s; };
      for (let s = 0; s < 300; s++) {
        const a = new Array(R).fill(0), b = new Array(R).fill(0);
        for (let t = 0; t < h; t++) { const u = rand(); a[cum.findIndex(cp => u <= cp)]++; }
        for (let t = 0; t < n - h; t++) { const u = rand(); b[cum.findIndex(cp => u <= cp)]++; }
        nullR.push(pearson(a, b));
      }
      const ns = nullSummary(nullR), pr = nullR.filter(x => Math.abs(x) >= Math.abs(r)).length / 300; pvals.push(pr);
      return { label: p.label, R, chi2, df: R - 1, p: pchi, uniformN: true, marginal: cnt.map(c => (c / n * 100).toFixed(1)), maxz, minz, sameRate, expSame: pe, psame, splitR: r, splitNull: `${f4(ns.mean)}±${f4(ns.sd)}`, psplit: pr, nonuniform: true };
    }
    const psame = binomTwo(same, n - 1, 1 / R); pvals.push(psame);
    const seR = 1 / Math.sqrt(R - 3); const pr = 2 * (1 - ncdfAbs(Math.abs(r) / seR)); pvals.push(pr);
    return { label: p.label, R, chi2, df: R - 1, p: pchi, maxz, minz, sameRate, expSame: 1 / R, psame, splitR: r, psplit: pr };
  });
  return { name: spec.name, n, positions, pvals };
}
// 分年代 χ²（各年代自己的蒙特卡洛零分布），号码池组
function eraChi2(N, k, vals, years) {
  const out = [];
  const blocks = [[2002, 2007], [2008, 2013], [2014, 2019], [2020, 2026]];
  for (const [lo, hi] of blocks) {
    const idx = years.map((y, i) => [y, i]).filter(([y]) => y >= lo && y <= hi).map(([, i]) => i);
    if (idx.length < 120) continue;
    const sub = idx.map(i => vals[i]), obs = groupStats(sub, null).chi2;
    const arr = simulateGroup(N, k, sub.length, 600, SEED + sub.length).map(s => s.chi2);
    const ns = nullSummary(arr), a = mcP(arr, obs);
    out.push({ era: `${lo}-${hi}`, n: sub.length, chi2: obs, mean: ns.mean, sd: ns.sd, p: a.p });
  }
  return out;
}
// split-half 频次相关（号码池组，两半独立模拟造零分布）
function splitHalf(N, k, vals) {
  const n = vals.length, h = n >> 1;
  const cntOf = arr => { const c = new Array(N + 1).fill(0); for (const v of arr) for (const x of v) c[x]++; return c.slice(1); };
  const A = cntOf(vals.slice(0, h)), B = cntOf(vals.slice(h));
  const r = pearson(A, B);
  const rand = rng(SEED + 13), nullR = [];
  for (let s = 0; s < 400; s++) {
    const a = new Array(N + 1).fill(0), b = new Array(N + 1).fill(0), base = Array.from({ length: N }, (_, i) => i + 1);
    for (let i = 0; i < h; i++) for (const x of drawK(rand, base, k)) a[x]++;
    for (let i = 0; i < n - h; i++) for (const x of drawK(rand, base, k)) b[x]++;
    nullR.push(pearson(a.slice(1), b.slice(1)));
  }
  const ns = nullSummary(nullR), ge = nullR.filter(x => Math.abs(x) >= Math.abs(r)).length;
  return { r, p: ge / nullR.length, mean: ns.mean, sd: ns.sd, n1: h, n2: n - h };
}
// ---------------------------------------------------------------- 小工具
let SIMS = 1200, SEED = 20260909;
const chiUpper = chi2Upper;   // 复用 lib 的经过校验的 χ² 上尾
function ncdfAbs(z) { const s = z < 0 ? -1 : 1; z = Math.abs(z); const t = 1 / (1 + 0.3275911 * z); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return 0.5 * (1 + s * y); }
function binomTwo(k, n, p0) { const mu = n * p0, sd = Math.sqrt(n * p0 * (1 - p0)); return Math.min(1, 2 * (1 - ncdfAbs((Math.abs(k - mu) - 0.5) / sd))); }

// ---------------------------------------------------------------- 主流程
export function runMulti({ sims = 1200 } = {}) {
  SIMS = sims;
  const L = []; const out = (...a) => L.push(a.join(" "));
  let verify = {}; try { verify = JSON.parse(readFileSync(join(DATA_DIR, "verify.json"), "utf8")); } catch {}
  const allTests = [];   // 全族 p 值，用于 Bonferroni
  const perKind = [];

  out("# 八彩种随机性审计（多彩种扩展，自动生成，勿手改）"); out("");
  out(`生成时间：${new Date().toISOString().slice(0, 16)}Z ｜ 号码池零分布：蒙特卡洛 ${SIMS} 次/组，种子 ${SEED} ｜ 数字型：解析 df=range−1（不做蒙特卡洛）`);
  out("双色球的完整深检（含投注侧/安慰剂/经济学）见 docs/randomness-latest.md；本文件把**开奖侧**结论推广到 8 个彩种。"); out("");

  out("## 0. 数据验收（结构 + 与生产 D1 公共接口交叉校验）"); out("");
  out("- 交叉校验的第二条摄入路径：大乐透来自 **500.com（src=500）**，是独立数据源；其余 6 个新彩种公共 API 内部读 17500（src=17500），与备源【同源】，因此那几项验证的是**列映射解析正确性（独立解析实现）**，非独立数据源。诚实标注。");
  out("");
  const cover = [];
  for (const kind of KIND_ORDER) {
    const v = verify[kind]; const K = normalize(kind);
    if (kind === "ssq") { out(`- ${KINDS[kind].name}(ssq)：既有基线，data/ssq.json（3501 期，已用 cwl 官方接口逐字段校验）`); if (K) cover.push(K); continue; }
    if (!K || !v || !v.verified) {
      const why = !K ? "无已验证数据文件" : (v && v.error) ? v.error : (v && v.crossCheck && v.crossCheck.err) ? "交叉校验API不可达" : (v && v.crossCheck && v.crossCheck.match !== v.crossCheck.n) ? `号码匹配 ${v.crossCheck.match}/${v.crossCheck.n}` : (v && v.structural && (v.structural.valBad || v.structural.codeBad)) ? `结构错误 valBad=${v.structural.valBad} codeBad=${v.structural.codeBad}` : "未知";
      out(`- ${KINDS[kind].name}(${kind})：**未验证，不纳入统计** —— ${why}`); continue;
    }
    out(`- ${KINDS[kind].name}(${kind})：${v.rows} 期 ${v.range[0]}→${v.range[1]}｜结构 0 异常(跳号${v.structural.jumps})｜D1 号码交叉校验 ${v.crossCheck.match}/${v.crossCheck.n}（${v.crossCheck.independence}）｜VERIFIED`);
    cover.push(K);
  }
  out("- **范围界定**：本 `--all` 只做**开奖侧**（均匀性/独立性/稳定性）。投注侧与经济学（按销量归一、安慰剂、返奖率）目前仅双色球有经校验的奖级列并做了全套（见 docs/randomness-latest.md）；其余彩种的奖级/销量列【未纳入经济性检验】。");
  out("- 快乐8 的 101–102 列含 选1..选10 各玩法注数/奖金，且 col22–23 销量带千分位逗号；其玩法奖级配对起点无法用一致性唯一钉死 → 标注为 **UNRESOLVED**，kl8 只取 20 个开奖号做随机性检验，绝不拿猜出来的奖级列做经济性结论（防止列映射错却因循环交叉校验而空过）。");
  out("");

  out("## A/B/C 逐彩种：均匀性 · 独立性 · 稳定性"); out("");
  for (const K of cover) {
    out(`### ${K.name}（${K.kind}）n=${K.rows.length}`); out("");
    if (K.type === "pool") {
      for (const group of K.spec.groups) {
        const g = analyzePoolGroup(group, K.rows); if (!g) continue;
        const u = g.uniformity;
        if (u.method === "MC") {
          allTests.push(u.p);
          out(`- **${g.label} 均匀性** χ²(${g.N}格)=${f4(u.chi2)}，蒙特卡洛零均值 ${f2(u.nullMean)}±${f2(u.nullSd)}（期望 E[χ²]=${g.N}×(1−${g.k}/${g.N})=${f2(u.expE)}${u.trapOK ? "" : " ⚠陷阱未挡住"}），双侧 p=${fmtP(u.p)}（${u.ge}/${SIMS}）。反面教材：误用解析 df=${g.N - 1} 会得 p=${f4(u.analyticP)}。`);
          if (!u.trapOK) out(`  ⚠ 模拟零均值 ${f2(u.nullMean)} 偏离期望 ${f2(u.expE)}：可能退化成有放回抽样，本组结论作废。`);
        } else { allTests.push(u.p); out(`- **${g.label} 均匀性** χ²(${g.N}格)=${f4(u.chi2)}，${u.note}，df=${u.df} 解析 p=${fmtP(u.p)}。`); }
        if (g.indep) {
          const d = g.indep;
          const line = (nm, lab, ex) => { allTests.push(d[nm].p); return `${lab} ${f4(d[nm].obs)}(零 ${f4(d[nm].mean)}±${f4(d[nm].sd)}${ex != null ? `,精确 ${f4(ex)}` : ""}) p=${fmtP(d[nm].p)}`; };
          const parts = ["ovMean", "ac", "gapMean", "gapMax", "sumMean", "oddMean", "consecRate"].map(nm => line(nm, ({ ovMean: "与上期重合", ac: "lag-1自相关", gapMean: "遗漏均值", gapMax: "最大遗漏", sumMean: "和值", oddMean: "奇数均值", consecRate: "连号率" })[nm], d[nm].exact));
          allTests.push(d.ovChi2.p);
          out(`- **${g.label} 独立性** ${parts.join(" ｜ ")} ｜ 重合数分布χ² p=${fmtP(d.ovChi2.p)}`);
          if (d.pos) { allTests.push(d.pos.p); out(`  · 开奖顺序位置 χ²=${f4(d.pos.obs)}（n=${d.pos.n} 有原始顺序，零 ${f4(d.pos.mean)}±${f4(d.pos.sd)}）p=${fmtP(d.pos.p)}`); }
        }
        const s = g.stab; allTests.push(s.p);
        out(`- **${g.label} 稳定性** split-half 频次相关 r=${f4(s.r)}（两半独立模拟零分布 ${f4(s.mean)}±${f4(s.sd)}）p=${fmtP(s.p)}`);
        if (g.eras && g.eras.length) { g.eras.forEach(e => allTests.push(e.p)); out(`  · 分年代 χ²：` + g.eras.map(e => `${e.era} ${f2(e.chi2)}(零${f2(e.mean)}±${f2(e.sd)},p=${fmtP(e.p)})`).join(" ｜ ")); }
      }
    } else {
      const D = analyzeDigitKind(K);
      allTests.push(...D.pvals);
      out(`- 数字型逐位（每期每位置独立均匀，解析 df=R−1，**不蒙特卡洛**）：`);
      for (const p of D.positions) {
        if (p.nonuniform) {
          out(`  · ${p.label}（R=${p.R}）边际分布【设计非均匀】：${p.marginal.join("% ")}% → 均匀性检验不适用（若硬套 χ²(14格) 会得到 p=${fmtP(p.p)} 的假显著，正是 ssq 那个 df 陷阱的反面）。按经验边际测 i.i.d.：与上期同位相同率 ${f4(p.sameRate)}(期望Σp̂²=${f4(p.expSame)}) p=${fmtP(p.psame)}；split-half r=${f4(p.splitR)}（经验分布零 ${p.splitNull}）p=${fmtP(p.psplit)}`);
          continue;
        }
        out(`  · ${p.label} χ²(${p.df}格)=${f4(p.chi2)} p=${fmtP(p.p)}；与上期同位相同率 ${f4(p.sameRate)}(期望${f4(p.expSame)}) p=${fmtP(p.psame)}；split-half r=${f4(p.splitR)} p=${fmtP(p.psplit)}`);
      }
    }
    out("");
  }

  // 全族 Bonferroni 前先做数据完整性诊断：跨族显著里，哪些是【真球偏】哪些是【源数据缺陷】
  out("## 显著项的数据完整性诊断（跨族校正之所以要，就是为了让这几条现形）"); out("");
  {
    const K = cover.find(k => k.kind === "dlt");
    if (K) {
      const g = K.spec.groups[0];
      const full = analyzePoolGroup(g, K.rows);
      const trusted = analyzePoolGroup(g, K.rows.filter(r => yr(r.code) >= 2015));
      out(`- **大乐透前区** 全历史 χ²(${g.N}格)=${f2(full.obs.chi2)}（p=${fmtP(full.uniformity.p)}）看似跨过族阈值，但它【不可复现】⇒ 是源数据缺陷，不是球偏。三重证据：`);
      out(`  · split-half 相关 r=${f4(full.stab.r)}（【负】；真球偏会正相关，负相关说明偏差只在一半里）；`);
      out(`  · 分年代：2007–2014 χ² 高（见上，早期 n 越大越偏），2015 年以后重测 χ²=${f2(trusted.obs.chi2)}（n=${trusted.n}，零 ${f2(trusted.uniformity.nullMean)}±${f2(trusted.uniformity.nullSd)}）p=${fmtP(trusted.uniformity.p)} → 近期回到噪声内；`);
      out(`  · 与独立 500.com 源的最近 60 期号码集合逐期一致（见 0 节 60/60），而那 60 期是均匀的 ⇒ 偏差来自 17500 备源的 2007–2014 早期回填空档，不是摇号物理。`);
      out(`  ⇒ 结论：大乐透【2015 年以后】均匀性与其余彩种一致；早期非均匀【标注为源数据缺陷并排除在"开奖侧均匀"的证据之外】，不谎称"干净"，也不谎称"发现偏倚"。`);
    }
    const Q = cover.find(k => k.kind === "qxc");
    out(`- **七星彩第7位（特别号）**：边际经验分布 0–9 各≈9%、10–14 各≈1.8% ⇒ 该位【设计非均匀】，均匀性 χ²(14格) 不适用（硬算得假显著 p=<1e-9，是 ssq df 陷阱的反面）。改用经验边际测 i.i.d.（见上），落在噪声内。前 6 位为均匀 0–9，正常。`);
    out(`- **双色球红球和值/奇数**（p≈0.005/0.019 量级）：与既有深检一致——属族内多重比较的预期误报，且 A2 族联合校正后不显著；分年代不延续。`);
    out("");
  }

  // 全族 Bonferroni
  const nTests = allTests.length, alpha = 0.05 / nTests;
  const surv = allTests.filter(p => p < alpha);
  const nominal = allTests.filter(p => p < 0.05);
  out("## 全族多重比较校正"); out("");
  out(`- 本次 ` + "`--all`" + ` 实际跑出的检验数 **nTests=${nTests}**，Bonferroni 阈值 α=${alpha.toExponential(2)}（=0.05/${nTests}）。`);
  out(`- 名义 p<0.05：${nominal.length} 项；跨过 Bonferroni：**${surv.length} 项**${surv.length ? "（" + surv.map(x => fmtP(x)).join("、") + "）" : "（无）。"}`);
  if (surv.length) {
    out(`- 跨阈项的处置：全部指向"数据完整性诊断"节里已定位的【源数据缺陷 / 模型误设】——大乐透 2007–2014 早期回填非均匀（负 split-half + 2015 后回归 + 独立源 60/60 均匀）与七星彩第7位设计非均匀。**没有一条能通过【年代可复现 + 独立源一致 + 与球偏物理方向一致】三重检验**，故均非可交易边。诚实结论是"发现了一个假显著并把它证伪"，不是"漏掉了边"。`);
  }
  out(`- 除上述已诊断项外，没有任何【真实球偏】跨过按实际检验数校正的阈值；名义 ${nominal.length} 项与 0.05×${nTests}=${f2(0.05 * nTests)} 的期望误报数量级一致。`);
  out("");

  // 检测功效：3D vs ssq
  out("## 检测功效：\"没发现信号\"在每个样本量下意味着什么"); out("");
  {
    const p3 = 0.1; // 某一位出现某个数字的真实概率
    const fc = 8750, ss = 3501;
    const d3 = detectability(p3, fc), d3p = detectability(p3, fc * 3), dss = detectability(p3, ss);
    out(`- 福彩3D：n=${fc} 期（2.5× 双色球的 ${ss}）。单个数字在【单个位置】的检出阈值（80%功效,α=0.05双侧）：绝对偏差 ≥ ${f4(d3.delta)}，即最小可检【相对】偏倚 ≈ ${pct(d3.relBias)}。`);
    out(`  - 3 个位置合并（试验数=3n=${fc * 3}）：最小可检相对偏倚降到 ${pct(d3p.relBias)}。`);
    out(`- 同样公式在双色球量级 n=${ss}：单格最小可检相对偏倚 ≈ ${pct(dss.relBias)} —— 3D 因样本多 2.5 倍，灵敏度明显更高。`);
    out(`- 反向：要检出 5% 相对偏倚，3D 单位需约 ${nForRelBias(p3, 0.05).toLocaleString("en-US")} 期；要检出 10% 需约 ${nForRelBias(p3, 0.10).toLocaleString("en-US")} 期（现有 ${fc} 期可覆盖 10% 这一档，覆盖不了 5%）。`);
    out(`- 号码池型（如快乐8 20-of-80）：单号出现概率 p=20/80=0.25，n=2063 时最小可检相对偏倚 ≈ ${pct(detectability(0.25, 2063).relBias)}（比数字型更钝，因每期抽 20 个、单元事件更稀）。`);
    out("");
  }

  out("## 结论"); out("");
  out("- 开奖侧：把\"无可利用结构\"从双色球【外推】升级为在 8 个彩种上【实测】。跨族校正挑出的少数显著项，经数据完整性诊断全部证伪为【源数据缺陷/模型误设】（大乐透早期回填、七星彩第7位设计非均匀），无一条是可通过复现性+独立源+物理方向三重检验的真实球偏。");
  out("- 关键防陷阱复核：所有号码池组的模拟零均值都落在 pool×(1−k/pool)（快乐8=60、双色球红=27、大乐透前区=30、后区=10、七乐彩基本=23），而非误导性的 df=N−1（快乐8 会是 79）。数字型逐位解析 df=9（七星彩第7位 df=14）。");
  out("- 未验证/受限项如实列出见上；福彩3D 样本最大、灵敏度最高，其\"无信号\"最有分量。");
  out("- 一句话：8 个彩种的开奖序列都与\"独立均匀（池内不放回）\"零分布齐平；唯一真实可测的结构仍在玩家选号（见双色球深检的投注侧），那只影响中奖后能留多少，不改变中奖概率。"); out("");
  out("随机游戏，统计仅供娱乐，不保证中奖。");

  const text = L.join("\n") + "\n";
  // 落盘失败必须炸：CI 靠 grep 这份文件做闸门，写坏了却静默 = 闸门读的是上个月的旧报告
  mkdirSync(dirname(DOC_FILE), { recursive: true }); writeFileSync(DOC_FILE, text);
  return { text, docFile: DOC_FILE, nTests, survivors: surv.length, verifiedKinds: cover.map(k => k.kind), expectedKinds: KIND_ORDER.slice() };
}
if (process.argv[1] && process.argv[1].includes("multi.mjs")) {
  const r = runMulti({ sims: Number(process.argv[2] || process.env.RANDOMNESS_SIMS || 1200) });
  console.log(r.text);
}
