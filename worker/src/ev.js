// 双色球每注期望回报（EV）+ 反热门选号。纯函数，无 I/O，便于单测。
//
// 规则口径（财政部 2014 年变更后的《中国福利彩票双色球游戏规则》）：
//   当期奖金 = 销售额 × 49%；当期高等奖奖金 H = 当期奖金 − 当期低等奖（3~6 等固定奖）支出
//   一等奖：奖池 < 1 亿 → (75%·H + 奖池) 按注均分，单注封顶 500 万
//           奖池 ≥ 1 亿 → (55%·H + 奖池) 按注均分封顶 500 万 + 20%·H 按注均分封顶 500 万
//   二等奖：25%·H 按注均分，封顶 500 万；三~六等奖固定 3000/200/10/5 元
// 实测校验：近 40 期 500 详情反推「二等奖总额 / H」均值 0.258（≈25%）；奖池 ≥1 亿时一等奖单注
// 顶格 1000 万（两部分各封顶 500 万）与页面一致。
//
// 估计口径：低等奖支出与他人中奖注数都按「销量 ÷ 2 元 = 注数」的期望算；他人中一/二等奖注数
// 视为泊松分布，λ = 注数 × 单注中奖概率 × 冷门度倍率（红球特征才影响二等奖，蓝球特征不影响——
// 与 coldness.js 的安慰剂设计同口径）。下一期销量取最近 6 期均值、奖池取最近一期开奖后的滚存。
import { coldness } from "./coldness.js";

export const SSQ_TOTAL = 17721088; // C(33,6) × 16
export const SSQ_PROB = { p1: 1, p2: 15, p3: 162, p4: 7695, p5: 137475, p6: 1043640 }; // 分子，分母 SSQ_TOTAL
export const SSQ_FIXED = { p3: 3000, p4: 200, p5: 10, p6: 5 };
export const CAP = 5e6;
export const PRICE = 2;
const LOW_EV = (SSQ_PROB.p3 * 3000 + SSQ_PROB.p4 * 200 + SSQ_PROB.p5 * 10 + SSQ_PROB.p6 * 5) / SSQ_TOTAL; // ≈0.4863 元

// E[min(cap, A / (1 + W))]，W ~ Poisson(λ)：自己中奖时与其余 W 注均分 A。逐项求和到尾概率可忽略。
export function expShare(A, lambda, cap = CAP) {
  if (!(A > 0)) return 0;
  if (!(lambda > 0)) return Math.min(cap, A);
  let p = Math.exp(-lambda), s = 0, acc = 0;
  const kmax = Math.ceil(lambda + 12 * Math.sqrt(lambda) + 30);
  for (let k = 0; k <= kmax; k++) {
    if (k > 0) p *= lambda / k;
    s += p * Math.min(cap, A / (1 + k));
    acc += p;
  }
  return acc > 0 ? s / acc : 0;
}

// 单期 EV。ratio1/ratio2 = 一/二等奖同奖人数相对平均的倍率（冷门度），默认 1 = 平均号码。
export function ssqEV({ sales, pool, ratio1 = 1, ratio2 = 1 }) {
  if (!(sales > 0) || !(pool >= 0)) return null;
  const tickets = sales / PRICE;
  const H = Math.max(0, 0.49 * sales - tickets * LOW_EV);
  const l1 = tickets * SSQ_PROB.p1 / SSQ_TOTAL * ratio1;
  const l2 = tickets * SSQ_PROB.p2 / SSQ_TOTAL * ratio2;
  const pay1 = pool >= 1e8
    ? expShare(0.55 * H + pool, l1) + expShare(0.20 * H, l1)
    : expShare(0.75 * H + pool, l1);
  const pay2 = expShare(0.25 * H, l2);
  const ev1 = pay1 * SSQ_PROB.p1 / SSQ_TOTAL, ev2 = pay2 * SSQ_PROB.p2 / SSQ_TOTAL;
  const ev = LOW_EV + ev1 + ev2;
  return {
    ev: +ev.toFixed(4), returnRate: +(ev / PRICE).toFixed(4),
    breakdown: { low: +LOW_EV.toFixed(4), first: +ev1.toFixed(4), second: +ev2.toFixed(4) },
    expectPay: { first: Math.round(pay1), second: Math.round(pay2) },
    othersExpected: { first: +l1.toFixed(2), second: +l2.toFixed(1) },
    highFund: Math.round(H)
  };
}

// 冷门度 → 一/二等奖倍率。二等奖不含蓝球，只连乘红球特征（allLe31 / 尾 8 / 尾 4）。
export function ratiosOf(red, blue) {
  const c = coldness("ssq", red, [blue]);
  if (c.error) return { error: c.error };
  const r2 = (c.factors || []).filter(f => !/^blue/.test(f.key)).reduce((m, f) => m * f.effect, 1);
  return { ratio1: c.ratio, ratio2: +r2.toFixed(3), coldness: c };
}

// 由开奖序列（新→旧，含 500 的 detail）估计下一期并回放历史每期的赛前 EV。
// 第 i 期的赛前奖池 = 第 i+1 期（上一期）开奖后的滚存；历史回放用当期真实销量（事后可知，标注为回看）。
export function ssqEVReport(draws, opts = {}) {
  const rows = (draws || []).filter(d => d && d.detail && d.detail.sales > 0 && d.detail.pool >= 0);
  if (rows.length < 7) return { supported: true, error: "insufficient_detail", note: "500 源未返回奖池/销量详情（备源不带这两列），暂时无法估算" };
  const recent = rows.slice(0, 6);
  const salesEst = Math.round(recent.reduce((s, d) => s + d.detail.sales, 0) / recent.length);
  const poolNow = rows[0].detail.pool;
  const r = opts.ratio1 ? { ratio1: opts.ratio1, ratio2: opts.ratio2 || 1 } : {};
  const next = { afterCode: rows[0].code, pool: poolNow, salesEst, ...ssqEV({ sales: salesEst, pool: poolNow, ...r }), avg: ssqEV({ sales: salesEst, pool: poolNow }) };
  const history = [];
  for (let i = 0; i + 1 < rows.length && history.length < 60; i++) {
    const e = ssqEV({ sales: rows[i].detail.sales, pool: rows[i + 1].detail.pool });
    if (e) history.push({ code: rows[i].code, date: rows[i].date, poolBefore: rows[i + 1].detail.pool, sales: rows[i].detail.sales, ev: e.ev, returnRate: e.returnRate });
  }
  const rates = history.map(h => h.returnRate).sort((a, b) => a - b);
  const pct = rates.length ? rates.filter(x => x <= next.avg.returnRate).length / rates.length : null;
  return {
    supported: true, kind: "ssq", next, history,
    percentile: pct === null ? null : +pct.toFixed(2),
    note: "按现行规则与期望注数估算，销量取近 6 期均值、奖池取最近一期滚存；不含追加/调节基金补足等边角。回报率 <100% 即长期亏损。",
    disclaimer: "随机游戏，期望回报恒为负；本数字只用于比较不同期之间哪期亏得少，不构成购买建议。"
  };
}

// 反热门选号：在冷门度模型认得的特征上取最冷一侧（含 32/33、无尾 8、含尾 4、蓝球冷门名单），
// 其余随机——模型没认的形态（连号、等差）不宣称有效果，只排除最常见的人工形态以免撞号。
export function coldPicks(n = 5, rnd = Math.random) {
  const BLUE = [1, 14, 15, 16];
  const out = [], seen = new Set();
  const pickRed = () => {
    const pool = []; for (let i = 1; i <= 33; i++) if (i % 10 !== 8) pool.push(i);
    const set = new Set([[32, 33][Math.floor(rnd() * 2)], [4, 14, 24][Math.floor(rnd() * 3)]]);
    while (set.size < 6) set.add(pool[Math.floor(rnd() * pool.length)]);
    return [...set].sort((a, b) => a - b);
  };
  const humanish = r => { let run = 1, best = 1; for (let i = 1; i < r.length; i++) { run = r[i] === r[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); } const d = r[1] - r[0]; return best >= 3 || r.every((x, i) => i === 0 || x - r[i - 1] === d); };
  for (let guard = 0; out.length < n && guard < n * 200; guard++) {
    const red = pickRed();
    if (humanish(red)) continue;
    const blue = BLUE[Math.floor(rnd() * BLUE.length)];
    const key = red.join(",") + "+" + blue;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = ratiosOf(red, blue);
    out.push({ red: red.map(x => String(x).padStart(2, "0")), blue: String(blue).padStart(2, "0"), ratio: r.coldness.ratio, ratio2: r.ratio2, label: r.coldness.label });
  }
  return out;
}

// ---------------- 大乐透（2026 新规，第 26014 期起） ----------------
// 规则（财综〔2025〕51 号）：当期奖金 = 销售额 × 49%；R = 当期奖金 − 固定奖总额
//   一等奖：奖池 <1 亿 → 78%R + 奖池；1~8 亿 → (58%R + 奖池) 与 20%R 两段；≥8 亿 → (20%R + 奖池) 与 40%R 两段；各段单注封顶 500 万
//   二等奖：奖池 <8 亿 → 22%R；≥8 亿 → 40%R；封顶 500 万。一、二等奖单期总额各限 1 亿（期望注数下几乎不触发，未建模）
//   三~七等固定奖随奖池分档（<8 亿：5000/300/150/15/5；≥8 亿：6666/380/200/18/7）
//   追加投注 +1 元：浮动奖按基本投注的 80% 另得，均分时按 0.8 注计（追加占比未知，λ 按基本投注计）
export const DLT_TOTAL = 21425712; // C(35,5) × C(12,2)
export const DLT_PROB = { p1: 1, p2: 20, p3: 195, p4: 3000, p5: 11100, p6: 127600, p7: 1287281 };
const DLT_FIX = { low: [5000, 300, 150, 15, 5], high: [6666, 380, 200, 18, 7] };
function dltLowEV(high) {
  const a = high ? DLT_FIX.high : DLT_FIX.low, P = DLT_PROB;
  return (P.p3 * a[0] + P.p4 * a[1] + P.p5 * a[2] + P.p6 * a[3] + P.p7 * a[4]) / DLT_TOTAL;
}
export function dltEV({ sales, pool }) {
  if (!(sales > 0) || !(pool >= 0)) return null;
  const high = pool >= 8e8, tickets = sales / PRICE, low = dltLowEV(high);
  const R = Math.max(0, 0.49 * sales - tickets * low);
  const l1 = tickets * DLT_PROB.p1 / DLT_TOTAL, l2 = tickets * DLT_PROB.p2 / DLT_TOTAL;
  const pay1 = pool < 1e8 ? expShare(0.78 * R + pool, l1)
    : high ? expShare(0.20 * R + pool, l1) + expShare(0.40 * R, l1)
    : expShare(0.58 * R + pool, l1) + expShare(0.20 * R, l1);
  const pay2 = expShare((high ? 0.40 : 0.22) * R, l2);
  const ev1 = pay1 * DLT_PROB.p1 / DLT_TOTAL, ev2 = pay2 * DLT_PROB.p2 / DLT_TOTAL;
  const ev = low + ev1 + ev2, addOn = 0.8 * (ev1 + ev2);
  return {
    ev: +ev.toFixed(4), returnRate: +(ev / PRICE).toFixed(4),
    breakdown: { low: +low.toFixed(4), first: +ev1.toFixed(4), second: +ev2.toFixed(4) },
    // 追加：多付 1 元换 0.8×浮动奖期望
    addOn: { ev: +addOn.toFixed(4), returnRate: +addOn.toFixed(4), ticket3: { ev: +(ev + addOn).toFixed(4), returnRate: +((ev + addOn) / 3).toFixed(4) } },
    tier: high ? "≥8亿（固定奖上调档）" : pool >= 1e8 ? "1~8亿" : "<1亿",
    expectPay: { first: Math.round(pay1), second: Math.round(pay2) },
    othersExpected: { first: +l1.toFixed(2), second: +l2.toFixed(1) },
    highFund: Math.round(R)
  };
}
export function dltEVReport(draws) {
  // 只用新规执行后的期号做回放（26014 起）；更早的期按旧规则开奖，套新规会算错
  const rows = (draws || []).filter(d => d && d.detail && d.detail.sales > 0 && d.detail.pool >= 0 && /^\d{5}$/.test(String(d.code)));
  if (rows.length < 7) return { supported: true, error: "insufficient_detail", note: "500 源未返回奖池/销量详情，暂时无法估算" };
  const recent = rows.slice(0, 6);
  const salesEst = Math.round(recent.reduce((s, d) => s + d.detail.sales, 0) / recent.length);
  const poolNow = rows[0].detail.pool;
  const next = { afterCode: rows[0].code, pool: poolNow, salesEst, avg: dltEV({ sales: salesEst, pool: poolNow }) };
  const history = [];
  for (let i = 0; i + 1 < rows.length && history.length < 60; i++) {
    if (String(rows[i].code) < "26014") break;
    const e = dltEV({ sales: rows[i].detail.sales, pool: rows[i + 1].detail.pool });
    if (e) history.push({ code: rows[i].code, date: rows[i].date, poolBefore: rows[i + 1].detail.pool, sales: rows[i].detail.sales, ev: e.ev, returnRate: e.returnRate, tier: e.tier });
  }
  return {
    supported: true, kind: "dlt", next, history,
    note: "按 2026 新规与期望注数估算，销量取近 6 期均值、奖池取最近一期滚存；追加投注占比未知，均分人数按基本投注计；一二等奖单期 1 亿总额上限未建模。",
    disclaimer: "随机游戏，期望回报恒为负；本数字只用于比较不同期之间哪期亏得少，不构成购买建议。"
  };
}
