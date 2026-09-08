// 注数 / 金额计算 + 进阶奖级判定（中奖计算器）
export const PRICE = 2; // 每注 2 元

export function C(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - i + 1)) / i;
  return Math.round(r);
}

const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isNaN(n) ? d : n; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * 复式 / 胆拖 注数与金额
 * kind: ssq | dlt | qlc | kl8 | fc3d | pl3 | pl5 | qxc
 * 参数：
 *   ssq 复式 red/blue；胆拖 dan/tuo/blue
 *   dlt 复式 front/back；胆拖 fdan/ftuo/bdan/btuo
 *   qlc 复式 main；胆拖 dan/tuo
 *   kl8 复式 pick(选几)/nums(选号个数)
 *   数字型 pos=a,b,c...(各位可选个数)，group=3|6 走组选
 * 追号：chase=期数，mults=1,2,4... 倍数序列
 */
export function calcBet(kind, p = {}) {
  let bets = 0, formula = "", mode = p.dan || p.fdan ? "dantuo" : "duplex";
  const chase = clamp(int(p.chase, 1), 1, 100);
  const mults = String(p.mults || "").split(",").filter(Boolean).map(x => clamp(int(x, 1), 1, 999));
  const m = i => mults.length ? (mults[Math.min(i, mults.length - 1)] || 1) : 1;

  if (kind === "ssq") {
    if (mode === "dantuo") {
      const dan = clamp(int(p.dan, 2), 1, 5), tuo = clamp(int(p.tuo, 8), 7 - dan, 32);
      const blue = clamp(int(p.blue, 1), 1, 16);
      bets = C(tuo, 6 - dan) * blue;
      formula = `C(拖${tuo},${6 - dan}) × 蓝${blue}`;
    } else {
      const red = clamp(int(p.red, 6), 6, 33), blue = clamp(int(p.blue, 1), 1, 16);
      bets = C(red, 6) * blue;
      formula = `C(红${red},6) × 蓝${blue}`;
    }
  } else if (kind === "dlt") {
    if (mode === "dantuo") {
      const fdan = clamp(int(p.fdan, 2), 1, 4), ftuo = clamp(int(p.ftuo, 8), 5 - fdan, 34);
      const bdan = clamp(int(p.bdan, 0), 0, 1), btuo = clamp(int(p.btuo, 2), 2 - bdan, 12);
      bets = C(ftuo, 5 - fdan) * C(btuo, 2 - bdan);
      formula = `C(前拖${ftuo},${5 - fdan}) × C(后拖${btuo},${2 - bdan})`;
    } else {
      const front = clamp(int(p.front, 5), 5, 35), back = clamp(int(p.back, 2), 2, 12);
      bets = C(front, 5) * C(back, 2);
      formula = `C(前${front},5) × C(后${back},2)`;
    }
  } else if (kind === "qlc") {
    if (mode === "dantuo") {
      const dan = clamp(int(p.dan, 2), 1, 6), tuo = clamp(int(p.tuo, 8), 7 - dan, 29);
      bets = C(tuo, 7 - dan);
      formula = `C(拖${tuo},${7 - dan})`;
    } else {
      const main = clamp(int(p.main, 7), 7, 30);
      bets = C(main, 7);
      formula = `C(基本${main},7)`;
    }
  } else if (kind === "kl8") {
    const pick = clamp(int(p.pick, 10), 1, 10), nums = clamp(int(p.nums, pick), pick, 80);
    bets = C(nums, pick);
    formula = `C(${nums},${pick})`;
  } else {
    // 数字型：各位可选个数相乘
    const pos = String(p.pos || "").split(",").filter(Boolean).map(x => clamp(int(x, 1), 1, 10));
    const need = kind === "pl5" ? 5 : (kind === "qxc" ? 7 : 3);
    const arr = pos.length === need ? pos : Array.from({ length: need }, () => 1);
    bets = arr.reduce((a, b) => a * b, 1);
    formula = arr.join(" × ") + (int(p.group) === 3 ? "（组三）" : int(p.group) === 6 ? "（组六）" : "");
    if (int(p.group) === 3) bets = C(pos.length ? Math.max(...arr) : 0, 2);
    if (int(p.group) === 6) bets = C(pos.length ? Math.max(...arr) : 0, 3);
  }

  let totalBets = 0;
  const plan = [];
  for (let i = 0; i < chase; i++) { const b = bets * m(i); totalBets += b; plan.push({ period: i + 1, mult: m(i), bets: b, amount: b * PRICE }); }

  return {
    kind, mode, formula, bets, amount: bets * PRICE,
    chase: { periods: chase, totalBets, totalAmount: totalBets * PRICE, plan: chase > 1 ? plan : undefined },
    note: "金额按每注 2 元估算，实际以官方规则为准"
  };
}

// 快乐8 奖金：pick=选几(1-10)，hit=命中个数。金额以官方当期公告为准
const KL8 = {
  10: { 10: 5000000, 9: 8000, 8: 720, 7: 80, 6: 5, 5: 3, 0: 2 },
  9: { 9: 250000, 8: 2000, 7: 225, 6: 22, 5: 5, 4: 3, 0: 2 },
  8: { 8: 50000, 7: 800, 6: 80, 5: 10, 4: 3, 0: 2 },
  7: { 7: 8500, 6: 300, 5: 30, 4: 4, 0: 2 },
  6: { 6: 2880, 5: 30, 4: 10, 3: 3 },
  5: { 5: 1000, 4: 20, 3: 3 },
  4: { 4: 93, 3: 5, 2: 3 },
  3: { 3: 52, 2: 3 },
  2: { 2: 19 },
  1: { 1: 4.5 }
};
export function kl8Prize(pick, hit) {
  const t = KL8[pick];
  if (!t) return { pick, hit, prize: "未中", note: "选几不在 1-10 范围" };
  const amount = t[hit];
  return {
    pick, hit,
    prize: amount ? (amount >= 10000 ? "高等奖" : "固定奖") : "未中",
    amount: amount || 0,
    note: "快乐8 奖金随玩法而异，金额以官方当期公告为准"
  };
}

// 福彩3D / 排列3：直选 / 组三 / 组六
export function digit3Prize(betDigits, drawDigits) {
  const b = (betDigits || []).map(String), d = (drawDigits || []).map(String);
  if (b.length !== 3 || d.length !== 3) return { prize: "未中", note: "需 3 位号码" };
  const exact = b.every((x, i) => x === d[i]);
  if (exact) return { prize: "直选", amount: 1040, note: "顺序全中" };
  const sameSet = [...b].sort().join() === [...d].sort().join();
  if (!sameSet) return { prize: "未中" };
  const uniq = new Set(d).size;
  if (uniq === 2) return { prize: "组三", amount: 346, note: "含一对，顺序不限" };
  return { prize: "组六", amount: 173, note: "三位各异，顺序不限" };
}
