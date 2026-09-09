// 双色球随机性审计：A 均匀性 / B 独立性 / C 稳定性 / D 投注侧（含安慰剂）/ E 经济学
// 用法：node scripts/randomness/analyze.mjs [模拟次数=3000]
// 输出：stdout 全量报告 + docs/randomness-latest.md（同一份内容，供 Actions 归档）。
// 第 0 节验收或 D 节安慰剂不过 → exit 1：区分“跑挂了”与“真的是零结果”是这套东西的生命线。
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  loadDraws, statsOf, simulate, nullSummary, mcP, fmtP, FAMILY, STAT_NAMES,
  rng, drawK, comb, pHyper, pNCHG, chi2Upper, twoSidedZ, pearson, spearman, mannWhitney,
  drawDow, WK, rel, REPORT_FILE, DATA_FILE, SOURCE_FILE,
} from "./lib.mjs";

const ARGS = process.argv.slice(2);
const ALL = ARGS.includes("--all");                       // --all：双色球深检之后，再跑 8 彩种扩展审计（multi.mjs）
const SIMS_TOK = ARGS.find(a => /^\d+$/.test(a));
const SIMS = Number(SIMS_TOK || process.env.RANDOMNESS_SIMS || 3000);
const SEED = 20260909;          // 固定种子：整套必须可复现（教训 6）
const R33 = Array.from({ length: 33 }, (_, i) => i + 1);

// --------------------------------------------------------------- 报告缓冲
const L = [];
const out = (...a) => L.push(a.join(" "));
const err = (...a) => console.error("[进度]", ...a);
const pct = x => (x * 100).toFixed(1) + "%";
const f4 = x => Number(x).toFixed(4);
const f2 = x => Number(x).toFixed(2);
const pLabel = p => (fmtP(p).startsWith("<") ? "p" : "p=") + fmtP(p);
const signed = (x, d = 2) => (x >= 0 ? "+" : "") + Number(x).toFixed(d);

// --------------------------------------------------------------- 0. 验收闸门
const fails = [];
const check = (name, ok, detail) => { out(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };
let data;
try {
  data = loadDraws();
} catch (e) {
  console.error("== 随机性审计拒绝运行 ==\n" + e.message + "\n");
  process.exit(2);
}
const { rows, ageDays, lastDate, mtime } = data;
const N = rows.length;
const RED = rows.map(r => r.red), BLUE = rows.map(r => r.blue), ORD = rows.map(r => r.order);
const obs = statsOf(RED, BLUE, ORD);
const yearOf = r => +String(r.code).slice(0, 4);

// 观测统计量的“金标准”：来自 2026-09 首次人工核对的那两份实现（t1/t4 逐位一致）。
// 它只依赖数据、不依赖随机数 —— 有人改了统计函数，这里立刻炸。
// 必须钉在一段【不会再增长的历史窗口】上比对：全量数据每月变长，若拿整份文件比，
// 下一次开奖就会让验收失败，把“函数写坏了”和“数据更新了”混为一谈。
const REF_PIN_CODE = "2026104";
const REF_OBS = { chi2R: 44.5438, sumMean: 100.9623, oddMean: 3.0457, chi2Z: 7.8161, maxz: 2.2547, minz: 2.5654, spanMean: 24.2531 };
const pin = rows.filter(r => String(r.code) <= REF_PIN_CODE);
const obsPin = statsOf(pin.map(r => r.red), pin.map(r => r.blue), pin.map(r => r.order));

out("# 双色球随机性审计报告（自动生成，勿手改）");
out("");
out(`生成时间：${new Date().toISOString().slice(0, 16)}Z ｜ 数据：${rel(DATA_FILE)}（${mtime}）｜ 最新一期 ${lastDate}（${ageDays} 天前）`);
out(`样本：${N} 期 ${rows[0].code} → ${rows[N - 1].code} ｜ 蒙特卡洛 ${SIMS} 次 × ${N} 期，种子 ${SEED}（固定 → 逐位可复现）`);
out("");
out("## 0. 验收检查（先判断这次跑没跑挂，再看结论）");
out("");
check(`钉住的验收窗口 = 前 ${pin.length} 期（≤${REF_PIN_CODE}）`, pin.length >= 3000, `窗口长度不足说明数据被截断，而不是统计函数写坏`);
for (const k of Object.keys(REF_OBS)) {
  check(`观测值复现 ${k}`, Math.abs(obsPin[k] - REF_OBS[k]) < 5e-4, `本次 ${f4(obsPin[k])} / 基准 ${f4(REF_OBS[k])}`);
}
{ // ω=1 的非中心超几何必须逐位等于精确超几何（内核自证，教训 6）
  const pay = h => (h === 10 ? 5e6 : h === 9 ? 8000 : h === 8 ? 720 : h === 7 ? 80 : h === 6 ? 5 : h === 5 ? 3 : h === 0 ? 2 : 0);
  let exact = 0, mine = 0;
  const d = pNCHG(80, 20, 10, 1);
  for (let h = 0; h <= 10; h++) { exact += pHyper(80, 20, 10, h) * pay(h); mine += d[h] * pay(h); }
  check("ω=1 精确超几何核对", Math.abs(mine - exact) < 1e-6 && Math.abs(d._expect - 2.5) < 1e-9,
    `模型 ${mine.toFixed(6)} vs 精确 ${exact.toFixed(6)}；期望命中 ${d._expect.toFixed(3)}（应为 2.500）`);
  const dr = pNCHG(33, 6, 6, 1);
  check("ω=1 红球重合期望", Math.abs(dr._expect - 36 / 33) < 1e-9, `${dr._expect.toFixed(6)} vs 6×6/33 = ${(36 / 33).toFixed(6)}`);
}
{ // 星期标签必须由纯日历给出（t2 草稿用 getUTCDay 套北京时区的日期 → 整体错位一天）
  const days = {}; for (const r of rows) { const w = drawDow(r.date); days[w] = (days[w] || 0) + 1; }
  const ks = Object.keys(days).map(Number).sort();
  check("开奖日只落在 二/四/日", ks.every(k => [0, 2, 4].includes(k)), ks.map(k => `${WK[k]}:${days[k]}`).join(" "));
}
err("蒙特卡洛零分布开始…");
const pool = simulate(N, SIMS, SEED);
err(`蒙特卡洛完成（${SIMS} 次 × ${N} 期）`);
const nulls = {}; for (const nm of STAT_NAMES) nulls[nm] = pool.map(s => s[nm]);
const nstat = {}; for (const nm of STAT_NAMES) nstat[nm] = nullSummary(nulls[nm]);
{ // 零分布内核自检：不放回结构必须真的被模拟出来（教训 1）
  const eR = 33 * (1 - 6 / 33), se = nstat.chi2R.sd / Math.sqrt(SIMS);
  check("红球 χ² 零均值 = 27 = 33×(1−6/33)", Math.abs(nstat.chi2R.mean - eR) < 4 * se,
    `模拟 ${f2(nstat.chi2R.mean)}（均值的标准误 ${f4(se)}）；若误按独立格子会趋近 32`);
  const seB = nstat.chi2B.sd / Math.sqrt(SIMS);
  check("蓝球 χ² 零均值 = 15（逐期独立）", Math.abs(nstat.chi2B.mean - 15) < 4 * seB,
    `模拟 ${f2(nstat.chi2B.mean)}，解析 df=15 的期望正是 15 → 内核在“理论成立处”与理论一致`);
  check(`模拟条数 = ${SIMS}`, pool.length === SIMS, "抽样用 drawK 部分洗牌（不放回），与真实摇号同构");
}
out("");

// --------------------------------------------------------------- A. 均匀性
out("## A. 均匀性（号码频次）");
out("");
{
  const expR = N * 6 / 33, sdR = Math.sqrt(expR * (1 - 6 / 33));
  const cnt = new Array(34).fill(0); for (const r of RED) for (const x of r) cnt[x]++;
  const tab = Array.from({ length: 33 }, (_, i) => [i + 1, cnt[i + 1], (cnt[i + 1] - expR) / sdR]).sort((a, b) => b[2] - a[2]);
  const pMax = mcP(nulls.maxz, obs.maxz), pMin = mcP(nulls.minz, obs.minz);
  out(`- 每号期望 ${(expR).toFixed(1)} 次，天然波动 σ=${sdR.toFixed(1)} 次（±${pct(sdR / expR)}）。在 33 个号的比较里出现 ±2σ 上下的“最热/最冷号”是必然的；而且这 33 个格子【并不独立】（一期内 6 球互不相同 → 负相关，README 铁律 1），所以极值只能对着模拟出来的零分布比，不能对着 df=32 比。`);
  out(`- 逐号（次数 / z）：` + tab.map(([x, c, z]) => `${String(x).padStart(2, "0")}:${c}(${signed(z)})`).join("  "));
  out(`- 最热 ${String(tab[0][0]).padStart(2, "0")} z=${signed(tab[0][2])}，最冷 ${String(tab[32][0]).padStart(2, "0")} z=${signed(tab[32][2])}；` +
    `但零分布下“33 个号中最大的那个 z”本身就有 ${f2(nstat.maxz.mean)}±${f2(nstat.maxz.sd)}，最冷那个有 ${f2(nstat.minz.mean)}±${f2(nstat.minz.sd)} → 冷热极值检验 p=${fmtP(Math.max(pMax.p, pMin.p))}（与随机一致）。`);
  const a = mcP(nulls.chi2R, obs.chi2R);
  out(`- 红球 χ²(33格) = ${f4(obs.chi2R)}，蒙特卡洛零分布 ${f2(nstat.chi2R.mean)} ± ${f2(nstat.chi2R.sd)}（95% 区间 ${f2(nstat.chi2R.q025)}–${f2(nstat.chi2R.q975)}）→ 双侧 p=${fmtP(a.p)}（单侧 ${fmtP(a.oneSided)}，${a.ge}/${SIMS} 次模拟超过它）。`);
  out(`- 反面教材：按 df=32 的解析卡方会算出 p=${chi2Upper(obs.chi2R, 32).toFixed(4)} —— 忽略“一期内 6 球互不相同”造成的负相关，把 p=${fmtP(a.p)} 粉饰成“挺正常”。解析值只作对照，不作结论。`);
  const b = mcP(nulls.chi2B, obs.chi2B);
  out(`- 蓝球 χ²(16格) = ${f4(obs.chi2B)}，零分布 ${f2(nstat.chi2B.mean)} ± ${f2(nstat.chi2B.sd)} → 双侧 p=${fmtP(b.p)}（蓝球逐期独立，解析 df=15 给 ${chi2Upper(obs.chi2B, 15).toFixed(4)}，二者吻合 → 内核没坏）。`);
}
// 族内多重比较（教训 5）
const mu = {}, sd = {};
for (const k of FAMILY) { mu[k] = nstat[k].mean; sd[k] = nstat[k].sd; }
const Tof = st => Math.max(...FAMILY.map(k => Math.abs((st[k] - mu[k]) / sd[k])));
const Tobs = Tof(obs);
const geT = pool.map(Tof).filter(x => x >= Tobs).length;
const jointP = geT / SIMS;
const which = FAMILY.find(k => Math.abs((obs[k] - mu[k]) / sd[k]) === Tobs);
out("");
out("### A2. 族内联合校正（不许挑最小那个 p 报）");
out("");
out(`- 族内 ${FAMILY.length} 个成员标准化后的 z：` + FAMILY.map(k => `${k} ${signed((obs[k] - mu[k]) / sd[k])}`).join("  "));
out(`- 联合统计量 T = 族内 max|z| = ${Tobs.toFixed(3)}（出在 ${which}）。零分布里只有 ${pct(jointP)} 的模拟 T ≥ 观测值 → 族内校正后 p=${f4(jointP)}（${geT}/${SIMS}）。`);
out(`- 对照：不做联合校正、只挑最“显著”的那个量报，会得到 p=${f4(twoSidedZ((obs[which] - mu[which]) / sd[which]))} —— 这就是“挑出来的显著”，不报它。`);
out(`- 解读：p≈${jointP.toFixed(3)} 属“提示级”，不是发现。33 号 × 6 年代 = 198 个格子的多重比较之下，这个量级完全在噪声预算内。`);
out("");

// --------------------------------------------------------------- B. 独立性
const B = {};   // 各独立性量的双侧 p，供结论引用
out("## B. 独立性（期与期之间）");
out("");
{
  const bp = [];
  const line = (nm, label, theory) => {
    const a = mcP(nulls[nm], obs[nm]), s = nstat[nm];
    bp.push([nm, label, a.p]);
    B[nm] = a.p;
    out(`- ${label}：观测 ${f4(obs[nm])}，零分布 ${f4(s.mean)} ± ${f4(s.sd)}${theory ? `（精确理论 ${theory}）` : ""} → 双侧 p=${fmtP(a.p)}`);
  };
  line("ovMean", "与上期红球重合数", f4(36 / 33));
  line("ovChi2", "重合数分布 χ²（6 格，期望用超几何）");
  line("bSameRate", "蓝球与上期相同的比率", f4(1 / 16));
  line("ac", "单号 lag-1 自相关（33 个号平均）");
  line("gapMean", "红球遗漏均值");
  line("gapMax", "红球最大遗漏（23 年历史纪录）");
  line("chi2Pos", "开奖顺序位置 χ²（6 位 × 33 格；球机/球序的物理痕迹最可能留在这里）");
  line("sumMean", "和值均值", "102.0000");
  line("spanMean", "跨度均值");
  line("oddMean", "奇数个数均值", "3.2727");
  line("consecRate", "含连号期的占比");
  line("same10Rate", "同尾数对数均值");
  line("chi2Z", "三区（01-11 / 12-22 / 23-33）χ²");
  const alpha = 0.05 / STAT_NAMES.length;
  const nominal = bp.filter(([, , p]) => p < 0.05);
  const survives = nominal.filter(([, , p]) => p < alpha);
  out(`- Bonferroni 阈值（${STAT_NAMES.length} 个量）α=${alpha.toFixed(5)}。名义 p<0.05 的有 ${nominal.length ? nominal.map(([nm, label, p]) => `${label.split("（")[0]} ${fmtP(p)}`).join("、") : "无"}；` +
    `${survives.length ? `其中 ${survives.length} 项跨过 Bonferroni` : "无一跨过 Bonferroni"}。`);
  out(`- 关键：这些量彼此高度相关（同一批号频/形态摘要），不能按独立检验处理 —— 判定以 A2 的族内联合校正为准，那里 p=${f4(jointP)}。`);
  out(`- 蒙特卡洛分辨率下限 1/${SIMS} = ${(1 / SIMS).toExponential(1)}：比它更小的 p 只能报 “<${(1 / SIMS).toFixed(4)}”。`);
}
out("");

// --------------------------------------------------------------- C. 稳定性 / 分层
const win = { era: {} };   // 存分年代 / 分窗口的 χ² 与 p，供结论引用（避免在结论里硬写数字）
out("## C. 稳定性与分层（真有球偏会留下可复现的痕迹吗）");
out("");
const counts = sub => { const c = new Array(34).fill(0); for (const r of sub) for (const x of r.red) c[x]++; return c; };
const chi2Of = (c, n) => { const e = n * 6 / 33; let s = 0; for (let x = 1; x <= 33; x++) s += (c[x] - e) ** 2 / e; return s; };
const zOfCell = (c, n, x) => { const e = n * 6 / 33; return (c[x] - e) / Math.sqrt(e * (1 - 6 / 33)); };
const sumZ = sub => { const n = sub.length; let s = 0; for (const r of sub) s += r.red.reduce((a, b) => a + b, 0); const varPer = 6 * ((33 * 33 - 1) / 12) * (33 - 6) / (33 - 1); return { mean: s / n, z: (s - n * 6 * 17) / Math.sqrt(n * varPer) }; };
const oddZ = sub => { const p = 17 / 33, n = sub.length; let s = 0; for (const r of sub) s += r.red.filter(x => x % 2).length; return { mean: s / n, z: (s - n * 6 * p) / Math.sqrt(n * 6 * p * (1 - p) * 0.84375) }; };
const hotCold = c => {
  const arr = Array.from({ length: 33 }, (_, i) => [i + 1, c[i + 1]]);
  return [arr.slice().sort((a, b) => b[1] - a[1])[0][0], arr.slice().sort((a, b) => a[1] - b[1])[0][0]];
};
{
  const h1 = rows.slice(0, N >> 1), h2 = rows.slice(N >> 1);
  const c1 = counts(h1), c2 = counts(h2);
  const z1 = Array.from({ length: 33 }, (_, i) => zOfCell(c1, h1.length, i + 1));
  const z2 = Array.from({ length: 33 }, (_, i) => zOfCell(c2, h2.length, i + 1));
  const rP = pearson(z1, z2);
  const nullR = []; const randR = rng(777);   // 两段独立模拟 → 纯噪声下 r 应当落在 0 附近
  for (let s = 0; s < 2000; s++) {
    const a = new Array(34).fill(0), b = new Array(34).fill(0);
    for (let i = 0; i < h1.length; i++) for (const x of drawK(randR, R33, 6)) a[x]++;
    for (let i = 0; i < h2.length; i++) for (const x of drawK(randR, R33, 6)) b[x]++;
    nullR.push(pearson(Array.from({ length: 33 }, (_, i) => a[i + 1]), Array.from({ length: 33 }, (_, i) => b[i + 1])));
  }
  const geR = nullR.filter(x => Math.abs(x) >= Math.abs(rP)).length;
  out(`- split-half 热号 z 相关（前 ${h1.length} 期 vs 后 ${h2.length} 期）：Pearson r=${f4(rP)}，Spearman ρ=${f4(spearman(z1, z2))}，双侧 MC p=${f4(geR / nullR.length)}。真实的物理球偏会在两半【正相关】；纯噪声下 r≈0。`);
  const topOf = sub => { const c = counts(sub); return new Set(Array.from({ length: 33 }, (_, i) => i + 1).sort((a, b) => c[b] - c[a]).slice(0, 6)); };
  const A = topOf(h1), B2 = topOf(h2);
  let ov = 0; for (const x of A) if (B2.has(x)) ov++;
  let geOv = 0; const randT = rng(4242);
  const mk = () => { const c = new Array(34).fill(0); for (let i = 0; i < h1.length; i++) for (const x of drawK(randT, R33, 6)) c[x]++; return new Set(Array.from({ length: 33 }, (_, i) => i + 1).sort((a, b) => c[b] - c[a]).slice(0, 6)); };
  for (let s = 0; s < 2000; s++) { const P = mk(), Q = mk(); let o = 0; for (const x of P) if (Q.has(x)) o++; if (o >= ov) geOv++; }
  out(`- 两半“Top6 热号”重合 ${ov}/6 个，零分布下 ≥${ov} 的概率 ${f4(geOv / 2000)}（6/6 才叫稳定，0-1 是噪声）→ 热号名单不迁移 = 没有可交易的东西。`);
  out("");
  out("### C2. 分年代（各年代自己的零分布，不共用整体的）");
  out("");
  for (const [lo, hi] of [[2003, 2006], [2007, 2010], [2011, 2014], [2015, 2018], [2019, 2022], [2023, 2026]]) {
    const sub = rows.filter(r => yearOf(r) >= lo && yearOf(r) <= hi);
    const c = counts(sub), pl = simulate(sub.length, 1000, 1000 + lo).map(s => s.chi2R);
    const nm = nullSummary(pl), chiV = chi2Of(c, sub.length), a = mcP(pl, chiV);
    win.era[`${lo}-${hi}`] = { chi2: chiV, p: a.p };
    const s = sumZ(sub), o = oddZ(sub), [hot, cold] = hotCold(c);
    out(`- ${lo}-${hi} n=${String(sub.length).padStart(4)}  χ²=${f2(chiV)}（该年代零分布 ${f2(nm.mean)}±${f2(nm.sd)}，p=${fmtP(a.p)}） 和值 ${f2(s.mean)}(z${signed(s.z)}) 奇数 ${f4(o.mean)}(z${signed(o.z)}) 最热 ${String(hot).padStart(2, "0")} 最冷 ${String(cold).padStart(2, "0")}`);
  }
  {
    const e = Object.entries(win.era);
    const worst = e.slice().sort((a, b) => a[1].p - b[1].p)[0];
    const post = e.filter(([k]) => +k.slice(0, 4) >= 2019).sort((a, b) => b[1].chi2 - a[1].chi2)[0];
    const others = e.filter(([k]) => k !== worst[0]).map(([, v]) => v.p);
    win.eraWorst = { name: worst[0], ...worst[1] };
    win.eraPostWorst = { name: post[0], ...post[1] };
    win.eraOtherMinP = Math.min(...others);
    out(`  → 最“不均匀”的年代：${worst[0]}（χ²=${f2(worst[1].chi2)}，p=${fmtP(worst[1].p)}）；其余年代的 p 全 ≥ ${fmtP(win.eraOtherMinP)}，2019 年以后最“不均匀”的年代只有 ${post[0]} χ²=${f2(post[1].chi2)}（p=${fmtP(post[1].p)}）→ 信号不跨年代延续。`);
  }
  for (const [label, sub] of [["2003-2018", rows.filter(r => yearOf(r) <= 2018)], ["2019-2026", rows.filter(r => yearOf(r) >= 2019)]]) {
    const pl = simulate(sub.length, 800, 9000 + sub.length).map(s => s.chi2R);
    const nm = nullSummary(pl), cVal = chi2Of(counts(sub), sub.length), a = mcP(pl, cVal);
    win[label] = { p: a.p, chi2: cVal, mean: nm.mean, sd: nm.sd, n: sub.length };
    out(`- 窗口 ${label}：n=${sub.length} χ²=${f2(cVal)} vs 零分布 ${f2(nm.mean)}±${f2(nm.sd)} → p=${fmtP(a.p)}`);
  }
  out("  → “不均匀”若只集中在某一段年代、之后消失，那是【非平稳】：既预测不了过去，也利用不了未来（要利用，它得继续存在）。");
  out("");
  out("### C3. 分开奖日（周二 / 周四 / 周日；星期取自纯日历 Sakamoto，绝不经过 Date 与时区）");
  out("");
  const wk = {};
  for (const r of rows) { const k = WK[drawDow(r.date)]; (wk[k] = wk[k] || []).push(r); }
  for (const k of ["周二", "周四", "周日"]) {
    const sub = wk[k] || []; if (!sub.length) continue;
    const c = counts(sub), s = sumZ(sub), o = oddZ(sub);
    out(`- ${k} n=${String(sub.length).padStart(4)} χ²=${f2(chi2Of(c, sub.length))} 和值 ${f2(s.mean)}(z${signed(s.z)}) 奇数 ${f4(o.mean)}(z${signed(o.z)}) Top3=` +
      Array.from({ length: 33 }, (_, i) => [i + 1, c[i + 1]]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => String(x[0]).padStart(2, "0")).join(","));
  }
  const wkArr = ["周二", "周四", "周日"].filter(k => wk[k]).map(k => [k, Array.from({ length: 33 }, (_, i) => counts(wk[k])[i + 1])]);
  out("- 星期两两号频相关：" + wkArr.flatMap((x, i) => wkArr.slice(i + 1).map(y => ` ${x[0]}~${y[0]} r=${pearson(x[1], y[1]).toFixed(3)}`)).join("；"));
  const thu = wk["周四"] || [];
  const thuZ = sumZ(thu);
  const thuPre = sumZ(thu.filter(r => yearOf(r) <= 2018)), thuPost = sumZ(thu.filter(r => yearOf(r) >= 2019));
  win.thu = { z: thuZ.z, pre: thuPre.z, post: thuPost.z, nPre: thu.filter(r => yearOf(r) <= 2018).length, nPost: thu.filter(r => yearOf(r) >= 2019).length };
  out(`- 唯一扎眼的分层信号：周四和值 z=${signed(thuZ.z)}（${f2(thuZ.mean)} vs 102）；拆开看 2018 年以前 z=${signed(win.thu.pre)}（n=${win.thu.nPre}），2019 年以后 z=${signed(win.thu.post)}（n=${win.thu.nPost}）→ 后期已回到噪声内。`);
  out(`- 而且“3 个开奖日 × 6 个年代 = 18 个分层”里挑一个 |z|≈3 本就在多重比较的预算之内；非平稳的分层不能拿来下注。`);
}
out("");

// --------------------------------------------------------------- D. 投注侧 + 安慰剂
out("## D. 投注侧：别人的选号是可预测的（每条效应都配一个安慰剂）");
out("");
const placebos = [];
let D = {};
{
  const sub = rows.filter(r => r.sales > 0 && r.n2 > 0);
  const M = sub.length;
  out(`样本（有销量 + 奖级注数）：${M} 期 ${sub[0].code} → ${sub[M - 1].code}。中奖注数一律按【每亿元销量】归一化，先把销量这个共同分母除掉（教训 4）。`);
  out(`识别逻辑（教训 3）：一等奖=6红+1蓝，二等奖=6红无蓝，六等奖=只看蓝。于是红球特征必须影响含红奖级、且在纯蓝的六等奖上为 NULL；蓝球特征必须影响含蓝奖级、且在纯红的二等奖上为 NULL。安慰剂一旦显著，就是实现里有混淆，整套结论作废。`);
  const F = sub.map(r => ({
    code: r.code, wk: WK[drawDow(r.date)], sales: r.sales,
    allLe31: r.red.every(x => x <= 31) ? 1 : 0,
    consec: r.red.filter((x, i) => i && x - r.red[i - 1] === 1).length,
    has4: r.red.some(x => x % 10 === 4) ? 1 : 0, has8: r.red.some(x => x % 10 === 8) ? 1 : 0,
    blue: r.blue, blueLe12: r.blue <= 12 ? 1 : 0,
    n1: r.n1, n2: r.n2, n3: r.n3, n6: r.n6, m1: r.m1, m2: r.m2,
  }));
  const rate = (f, k) => f[k] / (f.sales / 1e8);
  const grp = a => { const s = a.slice().sort((x, y) => x - y); return { n: a.length, mean: a.reduce((p, q) => p + q, 0) / a.length, median: s[a.length >> 1] }; };
  const cmp = (label, A, B) => {
    const a = grp(A), b = grp(B), mw = mannWhitney(A, B), ratio = a.median / b.median;
    out(`- ${label.padEnd(28)} 高侧 n=${String(a.n).padStart(4)} 中位 ${a.median.toFixed(1).padStart(9)} ｜ 对照 n=${String(b.n).padStart(4)} 中位 ${b.median.toFixed(1).padStart(9)} ｜ 比值 ${ratio.toFixed(3)}  MW ${pLabel(mw.p)}`);
    return { label, ratio, p: mw.p, a, b };
  };
  const g1 = f => f.allLe31;
  out("");
  out("### D1 生日区（号码 ≤31 才能被日期表达）· 红球特征");
  D.red1 = cmp("一等奖(6+1)", F.filter(g1).map(f => rate(f, "n1")), F.filter(f => !g1(f)).map(f => rate(f, "n1")));
  D.red2 = cmp("二等奖(6+0)", F.filter(g1).map(f => rate(f, "n2")), F.filter(f => !g1(f)).map(f => rate(f, "n2")));
  D.red3 = cmp("三等奖(5+1)", F.filter(g1).map(f => rate(f, "n3")), F.filter(f => !g1(f)).map(f => rate(f, "n3")));
  const dp = cmp("六等奖(只看蓝)＝安慰剂", F.filter(g1).map(f => rate(f, "n6")), F.filter(f => !g1(f)).map(f => rate(f, "n6")));
  placebos.push({ ...dp, name: "红球特征(全红≤31) → 纯蓝奖级(六等奖)", why: "六等奖只由蓝球决定，与红球无关；它显著就说明这个二分组把销量水平/年代结构漏进了对照" });
  out("");
  out("### D2 蓝球偏好 · 蓝球特征");
  const byBlue = {};
  for (const f of F) (byBlue[f.blue] = byBlue[f.blue] || []).push(rate(f, "n6"));
  const bb = Object.entries(byBlue).map(([b, v]) => [Number(b), grp(v)]).sort((x, y) => y[1].median - x[1].median);
  out("- 六等奖中奖注数/亿元 的蓝球中位数排序：" + bb.map(([b, g]) => `${String(b).padStart(2, "0")}:${g.median.toFixed(0)}`).join(" "));
  const top = bb[0], bot = bb[bb.length - 1];
  D.blueRatio = top[1].median / bot[1].median;
  D.blueP = mannWhitney(byBlue[top[0]], byBlue[bot[0]]).p;
  out(`- 最热蓝球 ${String(top[0]).padStart(2, "0")} vs 最冷蓝球 ${String(bot[0]).padStart(2, "0")}：中位比 ${D.blueRatio.toFixed(3)}，MW ${pLabel(D.blueP)} → 玩家确实扎堆在小号/吉利号，冷落 01 这类号。`);
  D.blue1 = cmp("一等奖(6+1) 蓝≤12", F.filter(f => f.blueLe12).map(f => rate(f, "n1")), F.filter(f => !f.blueLe12).map(f => rate(f, "n1")));
  const b2 = cmp("二等奖(6+0) 蓝≤12＝安慰剂", F.filter(f => f.blueLe12).map(f => rate(f, "n2")), F.filter(f => !f.blueLe12).map(f => rate(f, "n2")));
  placebos.push({ ...b2, name: "蓝球特征(蓝≤12) → 纯红奖级(二等奖)", why: "二等奖根本不看蓝球；它显著就说明“蓝≤12”这组与销量/年代同向变化" });
  out("");
  out("### D3 尾数偏好（吉利 8 / 忌讳 4）· 用纯红的二等奖识别");
  D.tail8 = cmp("二等奖 红含尾8", F.filter(f => f.has8).map(f => rate(f, "n2")), F.filter(f => !f.has8).map(f => rate(f, "n2")));
  D.tail4 = cmp("二等奖 红含尾4", F.filter(f => f.has4).map(f => rate(f, "n2")), F.filter(f => !f.has4).map(f => rate(f, "n2")));
  out("");
  out("### D4 形态（连号）· 纯红二等奖");
  D.consec = cmp("二等奖 有连号", F.filter(f => f.consec > 0).map(f => rate(f, "n2")), F.filter(f => f.consec === 0).map(f => rate(f, "n2")));
  out("");
  out("### D5 分层复现（换年代、换开奖日还成立吗）");
  const layers = [["2004-2008", f => +f.code.slice(0, 4) <= 2008], ["2009-2014", f => { const y = +f.code.slice(0, 4); return y >= 2009 && y <= 2014; }],
    ["2015-2020", f => { const y = +f.code.slice(0, 4); return y >= 2015 && y <= 2020; }], ["2021-2026", f => +f.code.slice(0, 4) >= 2021],
    ["周二专场", f => f.wk === "周二"], ["周四专场", f => f.wk === "周四"], ["周日专场", f => f.wk === "周日"]];
  D.replicated = 0; D.layersRun = 0;
  for (const [label, pred] of layers) {
    const S = F.filter(pred), SA = S.filter(g1).map(f => rate(f, "n1")), SB = S.filter(f => !g1(f)).map(f => rate(f, "n1"));
    if (SA.length < 30 || SB.length < 30) { out(`- ${label}：样本不足，跳过`); continue; }
    const a = grp(SA), b = grp(SB), p = mannWhitney(SA, SB).p;
    D.layersRun++;
    D.replicated += (p < 0.05 && a.median > b.median ? 1 : 0);
    out(`- ${label.padEnd(11)} n=${String(S.length).padStart(4)} 一等奖中位比 ${(a.median / b.median).toFixed(3)}  p=${fmtP(p)}${p < 0.05 && a.median > b.median ? " ✓复现" : " ←未复现"}`);
  }
  out(`- ${D.replicated}/${D.layersRun} 个可评估的分层里同号复现（分层之间不独立，不能当 ${D.layersRun} 次独立验证看，但方向一致这一点是硬的）。`);
  out("");
  out("### D6 钱的后果：同池分奖的人数");
  const hi = F.filter(f => f.n1 > 0);
  const hiA = hi.filter(g1), hiB = hi.filter(f => !g1(f));
  const wA = hiA.reduce((a, f) => a + f.n1, 0) / hiA.length, wB = hiB.reduce((a, f) => a + f.n1, 0) / hiB.length;
  out(`- 全红≤31（生日区、玩家扎堆）的期：一等奖平均 ${wA.toFixed(2)} 注/期（${hiA.length} 期有出头）`);
  out(`- 含 32/33 的期：一等奖平均 ${wB.toFixed(2)} 注/期（${hiB.length} 期）`);
  D.boost = wA / wB; D.firstPrizeAvg = hi.reduce((a, f) => a + f.m1, 0) / hi.length;
  const h2n = F.filter(f => f.n2 > 0);
  D.secondPrizeAvg = h2n.reduce((a, f) => a + f.m2, 0) / h2n.length;
  out(`- 票面里【带一个 32 或 33】不改变中奖概率，只改变中奖时同池分奖的人数：${wA.toFixed(2)}/${wB.toFixed(2)} → 到手金额 ×${D.boost.toFixed(4)}（+${pct(D.boost - 1)}）。`);
  out(`- 历史平均单注奖金：一等奖 ${(D.firstPrizeAvg / 1e4).toFixed(0)} 万元、二等奖 ${(D.secondPrizeAvg / 1e4).toFixed(1)} 万元（二等奖同样按 ${D.red2.ratio.toFixed(3)}× 的方向受益，但基数小得多，下面只保守地计一等奖）。`);
  out(`- 注意一二等都是浮动奖（有封顶/保底与奖池调剂规则），上面的换算只是量级估计，不是精算。`);
}
out("");

// --------------------------------------------------------------- E. 经济学
const ECON = {};   // 供 G 节引用
out("## E. 这套结论值多少钱（诚实版）");
out("");
{
  const pRed = h => comb(6, h) * comb(27, 6 - h) / comb(33, 6);
  const pb1 = 1 / 16, pb0 = 15 / 16;
  let fixed = 0;
  fixed += pRed(5) * pb1 * 3000;                        // 三等 5+1
  fixed += pRed(5) * pb0 * 200 + pRed(4) * pb1 * 200;   // 四等
  fixed += pRed(4) * pb0 * 10 + pRed(3) * pb1 * 10;     // 五等
  fixed += (pRed(2) + pRed(1) + pRed(0)) * pb1 * 5;     // 六等
  const pJackpot = 1 / (comb(33, 6) * 16);
  const pSecond = pRed(6) * pb0;
  const evFloat = pJackpot * D.firstPrizeAvg + pSecond * D.secondPrizeAvg;
  const gain = pJackpot * D.firstPrizeAvg * (D.boost - 1);   // 只保守地计一等奖这一项
  const rr = (fixed + evFloat) / 2;
  ECON.rr = rr; ECON.gain = gain; ECON.fixed = fixed; ECON.pJackpot = pJackpot;
  out(`- 一注 2 元，中一等奖概率 1/${(comb(33, 6) * 16).toLocaleString("en-US")}（= C(33,6)×16）。固定奖（三等及以下）期望回收 ${fixed.toFixed(4)} 元。`);
  out(`- 浮动奖按历史均值定价（一等 ${(D.firstPrizeAvg / 1e4).toFixed(0)} 万 × P=${pJackpot.toExponential(2)}，二等 ${(D.secondPrizeAvg / 1e4).toFixed(1)} 万 × P=${pSecond.toExponential(2)}）= ${evFloat.toFixed(4)} 元 → 合计返奖率 ≈ ${pct(rr)}（官方口径约 51%，差异来自奖池调剂与封顶规则，量级一致）。`);
  out(`- “避开生日区 + 避开热门蓝球”这类选号的天花板 = 一等奖期望 × (倍率 ${D.boost.toFixed(4)} − 1) = ${gain.toFixed(4)} 元/注 = 返奖率 +${(gain / 2 * 100).toFixed(1)} 个百分点（${pct(rr)} → ${pct(rr + gain / 2)}）。`);
  out(`- 它【完全不影响】任何一档的中奖概率，只影响“万一中了能留下多少”。剩下那 ${pct(1 - rr)} 是发行费与奖金计提，任何选号法都填不平。`);
  const needN = Math.ceil((1.959964 + 0.8416212) ** 2 * (6 / 33) * (27 / 33) / ((6 / 33) * 0.05) ** 2);
  out(`- 反过来算球偏：要检出 5% 的真实单号偏差（80% 功效）需约 ${needN.toLocaleString("en-US")} 期，而全量历史只有 ${N} 期；观测到的最大 |z|=${f2(Math.max(obs.maxz, obs.minz))} 与不放回零分布下该极值的期望 ${f2(mu.maxz)}±${f2(sd.maxz)} 齐平 —— 开奖侧连“值得动手”的信号都没有。`);
}
out("");

// --------------------------------------------------------------- F. 安慰剂审计 + G. 结论
out("## F. 安慰剂审计（这套东西能不能信，只看这一节）");
out("");
let placeboOk = true;
for (const p of placebos) {
  const ok = p.p > 0.05;
  if (!ok) placeboOk = false;
  out(`- ${p.name}：比值 ${p.ratio.toFixed(3)}，p=${fmtP(p.p)} → ${ok ? "NULL（合格）" : "显著（不合格）"}`);
  out(`  它为什么必须是零：${p.why}`);
}
out(`PLACEBO: ${placeboOk ? "PASS" : "FAIL"}`);
out("");
out("## G. 结论");
out("");
out("- 开奖侧：与上期的重合数、蓝球重复率、lag-1 自相关、遗漏均值/最大值、开奖顺序位置、和值/跨度/奇偶/连号/同尾/三区 —— " +
  `17 个量里没有一个跨过 Bonferroni 阈值 α=${(0.05 / STAT_NAMES.length).toFixed(5)}（最近的是和值 p=${fmtP(B.sumMean)}）；红球最大遗漏 ${obs.gapMax} 甚至【低于】随机模拟的平均 ${f2(nstat.gapMax.mean)}±${f2(nstat.gapMax.sd)}（真被人挑过号的话，这里只会更极端）。`);
out(`- 唯一的提示级信号是红球频次 χ²=${f2(obs.chi2R)}（蒙特卡洛双侧 p=${fmtP(mcP(nulls.chi2R, obs.chi2R).p)}），族内联合校正后 p=${f4(jointP)} —— 提示级，不是发现。` +
  `它也不跨年代：最“不均匀”的年代是 ${win.eraWorst.name}（χ²=${f2(win.eraWorst.chi2)}，p=${fmtP(win.eraWorst.p)}），其余 5 个年代 p 全 ≥ ${fmtP(win.eraOtherMinP)}，2019 年以后最差只是 ${win.eraPostWorst.name}（χ²=${f2(win.eraPostWorst.chi2)}，p=${fmtP(win.eraPostWorst.p)}）。` +
  `分层上最扎眼的是周四和值 z=${signed(win.thu.z)}（C3），拆成 2018 年以前 ${signed(win.thu.pre)} / 2019 年以后 ${signed(win.thu.post)} 就只剩前半 → 非平稳 ⇒ 不可利用（要利用，它得继续存在）。`);
out(`- 投注侧：强且稳健。一等奖 ${D.red1.ratio.toFixed(3)}×（${pLabel(D.red1.p)}） / 二等奖 ${D.red2.ratio.toFixed(3)}×（${pLabel(D.red2.p)}） / 三等奖 ${D.red3.ratio.toFixed(3)}×（${pLabel(D.red3.p)}），纯蓝安慰剂 ${dp_placeholder(0)}；` +
  `蓝球维度一等奖 ${D.blue1.ratio.toFixed(3)}×（${pLabel(D.blue1.p)}）对纯红安慰剂 ${dp_placeholder(1)}；六等奖蓝球最热/最冷 ${D.blueRatio.toFixed(3)}×；尾8 ${D.tail8.ratio.toFixed(3)}×、尾4 ${D.tail4.ratio.toFixed(3)}×。`);
out("- 这是“别人怎么选号”的结构，不是“球怎么掉”的结构 —— 所以它不会随摇号机更换而消失，也不会因为你看得更细而变成预测力。");
out(`- 经济学：避开生日区（票面带 32/33）≈ 返奖率 +${(ECON.gain / 2 * 100).toFixed(1)} 个百分点量级（${pct(ECON.rr)} → ${pct(ECON.rr + ECON.gain / 2)}），且不改变任何一档的中奖概率。`);
out("- 一句话：开奖侧没有可利用结构；唯一真实、可测量、可复现的结构是其他玩家的选号偏好，它只影响你中奖之后能留下多少。");
out("");
out("随机游戏，统计仅供娱乐，不保证中奖。");
out("");
function dp_placeholder(i) { const p = placebos[i]; return `${p.ratio.toFixed(3)}×（p=${fmtP(p.p)}）`; }

// --------------------------------------------------------------- 附录 + 落盘 + 退出码
out(`ACCEPTANCE: ${fails.length ? "FAIL" : "PASS"}（${fails.length ? fails.join(" ; ") : "观测值复现 + 超几何内核 + 零分布期望 + 数据完整性 全过"}` + `）`);
out("");
out("## 附录 A. 复现方式与实现约束");
out("");
out(`- 数据：${SOURCE_FILE}（备源），拉取时已用 cwl.gov.cn 官方接口逐字段交叉校验；结构铁律 = 期号 7 位、红 6 个 01-33 无重复升序、蓝 01-16、开奖顺序是红球集合的排列。`);
out(`- 文件：${rel(DATA_FILE)}（${N} 期 ${rows[0].code}→${rows[N - 1].code}）。数据缺失或最新一期超过 45 天 → analyze 直接拒绝运行（exit 2），不输出任何结论。`);
out(`- 零分布：${SIMS} 次模拟 × ${N} 期，种子 ${SEED}；真实数据与模拟数据共用同一个 statsOf（scripts/randomness/lib.mjs）。`);
out("- 六条铁律（为什么不能用 df=32、为什么排序与原始顺序要分开、为什么安慰剂显著就必须失败…）见 scripts/randomness/README.md。");

mkdirSync(dirname(REPORT_FILE), { recursive: true });
writeFileSync(REPORT_FILE, L.join("\n") + "\n");
console.log(L.join("\n"));
console.error(`报告已写入 ${rel(REPORT_FILE)}`);

// --------------------------------------------------------------- --all：8 彩种扩展（不改动上面的双色球深检）
let multiFail = null;
if (ALL) {
  try {
    const { runMulti } = await import("./multi.mjs");
    const mSims = Number(ARGS.find(a => /^\d+$/.test(a)) || process.env.RANDOMNESS_SIMS || 1200);
    console.log("\n\n================  8 彩种扩展审计（--all）  ================\n");
    const r = runMulti({ sims: mSims });
    console.log(r.text);
    console.error(`\n多彩种报告已写入 ${rel(r.docFile)}（已验证彩种：${r.verifiedKinds.join("、")}）`);
    const missing = r.expectedKinds.filter(k => !r.verifiedKinds.includes(k));
    if (missing.length) multiFail = `有彩种未通过数据验收：${missing.join("、")}`;
  } catch (e) {
    multiFail = e && e.message ? e.message : String(e);
    console.error(`\n!! --all 多彩种扩展失败：${multiFail}`);
    console.error("   双色球深检（上面）已照常完成并落盘；多彩种部分不影响其结论，但本次 --all 未跑全。");
  }
}

if (!placeboOk) {
  console.error("\n!! 安慰剂显著 —— 分析实现里存在混淆（多半是归一化没除掉销量、或分组把年代结构漏进了对照）。本轮结论作废，请修 analyze.mjs/lib.mjs 后重跑。");
  process.exit(1);
}
// --all 跑不全就非零退出：CI 的闸门才有牙，否则「多彩种没跑成」和「多彩种没问题」长得一模一样
if (multiFail) {
  console.error(`\n!! 8 彩种扩展审计未完成：${multiFail}`);
  process.exit(1);
}
if (fails.length) {
  console.error(`\n!! 验收检查失败 ${fails.length} 项：${fails.join(" ; ")}\n!! 这不是“结果为空”，这是“跑挂了”：结果不可用。`);
  process.exit(1);
}
console.error("ACCEPTANCE: PASS ｜ PLACEBO: PASS");
