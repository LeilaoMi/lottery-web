// verify-batch：一沓号码一次验完（自用场景：买了 5 注 2 个彩种，想知道昨晚中了什么）
// 纯函数 + 零依赖，不碰 node 内置模块（Workers 限制）；奖级判定一律复用既有函数，
// 绝不在这里另写一套奖级规则 —— 两套实现迟早分叉，分叉的就是「验奖说中了、官方说没中」。
import { prizeSSQ, prizeDLT, prizeQLC } from "./small.js";
import { kl8Prize, digit3Prize } from "./calc.js";

// 固定奖金额表：**只收录本站有把握的项**，其余一律返回 null 并说明原因。
// 理由不是懒，是错的金额比没有金额更糟：彩票工具一旦报错奖金，用户就再也不信它的任何输出。
//   ssq 三~六等：2014 年规则以来恒定的固定奖（一二等为浮动奖，按当期奖池与注数分配 → null）
//   fc3d / pl3：直选 1040 / 组三 346 / 组六 173（digit3Prize 内置）
//   kl8：按「选几」查表（kl8Prize 内置）
//   dlt：固定奖金额在 2026-02-02 换过规则，且历史上有 4 个时代（实测见 docs/coldness-dlt-2026-09.md）
//        → 不给金额，只给奖级；要钱请看当期官方公告
//   qlc / pl5 / qxc：未做逐字段校验，同样只给奖级
export const FIXED = {
  ssq: { 三等: 3000, 四等: 200, 五等: 10, 六等: 5 },
  dlt: null, qlc: null, pl5: null, qxc: null
};
export const AMOUNT_NOTE = {
  dlt: "大乐透固定奖金额随规则版本变化（2026-02-02 起为新标准），本站只给奖级不给金额",
  qlc: "七乐彩奖级已按官方规则判定；金额需按当期公告，本站未校验",
  pl5: "排列5 奖级按位判定；金额未校验，故不给出",
  qxc: "七星彩一等奖为浮动奖，其余奖级金额未逐字段校验，故不给出"
};
const SPEC = {
  ssq: { main: 6, aux: 1 }, dlt: { main: 5, aux: 2 }, qlc: { main: 7, aux: 0 },
  kl8: { main: null, aux: 0 },            // 快乐8 注数 = 选几个（1..10）
  fc3d: { main: 3, aux: 0, digit: true }, pl3: { main: 3, aux: 0, digit: true },
  pl5: { main: 5, aux: 0, digit: true }, qxc: { main: 7, aux: 0, digit: true }
};
const pad2 = x => String(x).padStart(2, "0");
const toks = s => String(s).split(/[^0-9]+/).filter(Boolean);

// 一行票 → {main[], aux[]} 或 {error}。接受 `01 05 ... + 04`、`01,05+04`、数字彩的 `922` 连写。
export function parseTicket(kind, line) {
  const sp = SPEC[kind];
  if (!sp) return { error: "未知彩种 " + kind };
  const raw = String(line || "").trim();
  if (!raw) return { error: "空行" };
  const plus = raw.indexOf("+");
  const mainRaw = plus < 0 ? raw : raw.slice(0, plus);
  const auxRaw = plus < 0 ? "" : raw.slice(plus + 1);
  let main = toks(mainRaw), aux = toks(auxRaw);
  // 数字彩允许连写：「922」= 9 2 2（只有每格 1 位时才这样拆，避免把 12 当成 1 和 2）
  if (sp.digit && main.length === 1 && mainRaw.replace(/\D/g, "").length === sp.main) main = mainRaw.replace(/\D/g, "").split("");
  const norm = a => a.map(x => sp.digit ? String(Number(x)) : pad2(x));   // 数字型不做 %100 折叠：越界要报错而不是被改成合法号
  main = norm(main); aux = norm(aux);
  const bad = v => v.some(x => !/^\d+$/.test(x));
  if (bad(main) || bad(aux)) return { error: "含非数字字符" };
  if (sp.main && main.length !== sp.main) return { error: `主区需 ${sp.main} 个，实际 ${main.length} 个` };
  if (!sp.main && (main.length < 1 || main.length > 10)) return { error: "快乐8 每注选 1..10 个号" };
  if (main.length !== new Set(main).size && !sp.digit) return { error: "同一注内有重复号" };
  if (aux.length !== (sp.aux || 0)) return { error: sp.aux ? `辅区需 ${sp.aux} 个，实际 ${aux.length} 个` : "该彩种无辅区，去掉 + 后面的号码" };
  // 数字型逐位校验：3D/排列3/排列5 每位 0-9；七星彩只有第 7 位是 0-14 的另一个号池（设计上就不同）
  if (sp.digit) {
    const over = main.findIndex((x, i) => Number(x) > (kind === "qxc" && i === sp.main - 1 ? 14 : 9));
    if (over >= 0) return { error: `${kind === "qxc" && over === sp.main - 1 ? "第 7 位" : "第 " + (over + 1) + " 位"}需在 0-${kind === "qxc" && over === sp.main - 1 ? 14 : 9}，实际 ${main[over]}` };
  }
  const lim = kind === "ssq" ? [33, 16] : kind === "dlt" ? [35, 12] : kind === "qlc" ? [30, 0] : kind === "kl8" ? [80, 0] : [9, 0];
  if (!sp.digit && main.some(x => Number(x) < 1 || Number(x) > lim[0])) return { error: `主区号需在 1-${lim[0]}` };
  if (aux.some(x => Number(x) < 1 || Number(x) > (lim[1] || 9))) return { error: `辅区号需在 1-${lim[1] || 9}` };
  return { main, aux };
}

// 一注 vs 一期开奖 → 奖级 / 命中明细 / 金额（无把握时为 null）
export function scoreTicket(kind, t, d) {
  const sp = SPEC[kind];
  if (kind === "ssq") {
    const S = new Set((d.red || []).map(pad2)), B = pad2(d.blue);
    const hm = t.main.filter(x => S.has(x)).length, hb = t.aux.some(x => x === B) ? 1 : 0;
    const grade = prizeSSQ(hm, hb);
    return { hitMain: hm, hitAux: hb, grade, amount: grade === "未中" ? 0 : (FIXED.ssq[grade] ?? null), ...(grade.match(/一等/) ? { note: "一二等奖为浮动奖，金额按当期公告与中奖注数分配" } : {}) };
  }
  if (kind === "dlt") {
    const F = new Set((d.front || []).map(pad2)), K = new Set((d.back || []).map(pad2));
    const hm = t.main.filter(x => F.has(x)).length, ha = t.aux.filter(x => K.has(x)).length;
    return { hitMain: hm, hitAux: ha, grade: prizeDLT(hm, ha), amount: null, note: AMOUNT_NOTE.dlt };
  }
  if (kind === "qlc") {
    const M = new Set((d.main || []).map(pad2)), S = pad2(d.special);
    const hm = t.main.filter(x => M.has(x)).length, hs = t.main.includes(S) ? 1 : 0;
    return { hitMain: hm, hitSpecial: hs, grade: prizeQLC(hm, hs), amount: null, note: AMOUNT_NOTE.qlc };
  }
  if (kind === "kl8") {
    const W = new Set((d.nums || []).map(pad2));
    const hit = t.main.filter(x => W.has(x)).length, r = kl8Prize(t.main.length, hit);
    return { pick: t.main.length, hitNums: hit, grade: r.prize === "未中" ? "未中" : `选${t.main.length}中${hit}`, amount: r.amount, note: r.note };
  }
  if (kind === "fc3d" || kind === "pl3") {
    const r = digit3Prize(t.main, (d.digits || []).map(String));
    return { posHit: t.main.filter((x, i) => String(Number(x)) === String(Number((d.digits || [])[i]))).length, grade: r.prize, amount: r.prize === "未中" ? 0 : (r.amount ?? null), note: r.note };
  }
  // pl5 / qxc：逐位比对，全对才中；金额未校验 → null
  const act = (d.digits || []).map(String);
  const pos = t.main.filter((x, i) => String(Number(x)) === String(Number(act[i]))).length;
  const exact = pos === sp.main && act.length === sp.main;
  return { posHit: pos, total: sp.main, grade: exact ? "全中" : pos > 0 ? `中${pos}位` : "未中", amount: null, note: AMOUNT_NOTE[kind] };
}

// 主体：tickets（字符串数组）× codes（期号数组）→ 逐注逐期结果 + 汇总
export function verifyBatch(kind, draws, tickets, codes, mult = 1) {
  const sp = SPEC[kind];
  if (!sp) return { error: "未知彩种，可选：" + Object.keys(SPEC).join("/") };
  const list = (tickets || []).map((t, i) => ({ raw: typeof t === "string" ? t : [t.main, t.aux].filter(Boolean).map(x => (Array.isArray(x) ? x : [x]).join(" ")).join(" + "), line: i + 1 })).filter(x => String(x.raw).trim());
  if (!list.length) return { error: "tickets 为空" };
  if (list.length > 200) return { error: "单次最多 200 注（免费版 CPU 限制；复式/胆拖请先展开成注或用 /api/ticket 导出）" };
  const want = (codes && codes.length ? codes : []).map(String).filter(Boolean).slice(0, 10);
  if (!want.length) return { error: "需要 code 或 codes（最多 10 期）" };
  const P = f => kind === "ssq" ? "red" : kind === "dlt" ? "front" : kind === "qlc" ? "main" : kind === "kl8" ? "nums" : "digits";
  const parsed = list.map(x => ({ ...x, ...parseTicket(kind, x.raw) }));
  const rounds = [];
  for (const code of want) {
    const d = (draws || []).find(x => String(x.code) === String(code));
    if (!d) { rounds.push({ code, drawn: false, note: "期号不存在或尚未开奖（用 /api/{kind}/history 确认可用期号）", results: [] }); continue; }
    const results = parsed.map(p => p.error
      ? { ticket: p.raw, error: p.error }
      : { ticket: p.raw, ...scoreTicket(kind, p, d) });
    const byGrade = {}, actual = { code, date: d.date || "", ...{ [P(kind)]: (d[P(kind)] || []).map(String) }, ...(kind === "ssq" ? { blue: pad2(d.blue) } : {}), ...(kind === "dlt" ? { back: (d.back || []).map(pad2) } : {}), ...(kind === "qlc" ? { special: pad2(d.special) } : {}) };
    let won = 0, amt = 0, amtUnknown = 0;
    for (const r of results) {
      if (r.error) continue;
      byGrade[r.grade] = (byGrade[r.grade] || 0) + (Number(mult) || 1);
      if (r.grade !== "未中") { won += Number(mult) || 1; if (r.amount == null) amtUnknown += Number(mult) || 1; else amt += r.amount * (Number(mult) || 1); }
    }
    const n = results.filter(r => !r.error).length, cost = n * (Number(mult) || 1) * 2;
    rounds.push({ code, drawn: true, actual, results, summary: { tickets: n, multi: Number(mult) || 1, winning: won, byGrade, amountKnown: amt, amountUnknownTier: amtUnknown, cost, netIfKnown: amt - cost } });
  }
  const errors = parsed.filter(p => p.error).map(p => ({ line: p.line, ticket: p.raw, error: p.error }));
  return {
    kind, name: ({ ssq: "双色球", dlt: "大乐透", qlc: "七乐彩", kl8: "快乐8", fc3d: "福彩3D", pl3: "排列3", pl5: "排列5", qxc: "七星彩" })[kind],
    tickets: parsed.length, parsed: parsed.length - errors.length, errors,
    // 该彩种的固定奖金额本站未校验 → 只给奖级不给钱（见 AMOUNT_NOTE 的理由）
    amountUnverified: Object.prototype.hasOwnProperty.call(AMOUNT_NOTE, kind) ? [kind] : [],
    rounds,
    note: "注数按每注 2 元计。金额只在本站有把握的奖级给出（null = 未给出而非 0）；奖级判定复用与 /api/prize、/api/{kind}/verify 相同的函数。",
    disclaimer: "验奖只回答「中没中」，不改变中奖概率；长期期望回报为负。"
  };
}
