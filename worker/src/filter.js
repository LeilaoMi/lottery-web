// 缩水过滤：在候选号码池中枚举全部组合，按形态条件筛掉不符合的组合。
// 纯组合数学 + 描述性条件（和值/跨度/奇偶/大小/AC/连号/重号），不声称能提高中奖概率——
// 过滤的本质是「用更少的注数覆盖你选定的形态范围」，被筛掉的组合与保留的组合开奖概率相同。
import { specOf, poolOf, acValue, DISCLAIMER } from "./predict.js";

const MAX_SPACE = 300000; // 枚举空间上限：超过直接拒绝，避免在 Worker 里跑组合爆炸
const MAX_RETURN = 2000;  // 返回组合上限：够前端展示与入篮，再多也下注不过来

function combCount(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - i + 1)) / i;
  return Math.round(r);
}

const inRange = (v, min, max) => (min == null || v >= min) && (max == null || v <= max);
const intOrNull = v => { const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; };

// kind: 号码池型彩种；候选池 pool（号码字符串数组，缺省全池）；pick 每注选几个（缺省 spec.main.pick）
// dan: 必含号码（胆）；exclude: 必不含号码；conditions: sum/span/odd/big/ac/consec/repeat 的 min/max
// prevMain: 上一期主区号码（给 repeat 重号条件用），由调用方从最新一期开奖取
export function filterPool(kind, opts = {}) {
  const s = specOf(kind);
  if (s.type !== "pool") return { error: "该彩种为数字型，缩水过滤只适用于号码池型彩种" };
  const pick = Math.max(1, Math.min(20, intOrNull(opts.pick) ?? s.main.pick));
  const norm = a => [...new Set((Array.isArray(a) ? a : []).map(x => String(x).padStart(2, "0")))];
  const dan = norm(opts.dan);
  const exclude = new Set(norm(opts.exclude));
  let pool = norm(opts.pool && opts.pool.length ? opts.pool : poolOf(s.main)).filter(x => !exclude.has(x));
  for (const d of dan) if (!pool.includes(d)) pool.push(d);
  pool.sort();
  if (dan.length >= pick) return { error: "胆码个数必须小于每注号码个数" };
  const space = combCount(pool.length - dan.length, pick - dan.length);
  if (space > MAX_SPACE) return { error: `组合空间过大（约 ${space} 注），请缩小候选池或增加胆码` };
  const mid = (s.main.min + s.main.max) / 2;
  const prev = new Set(norm(opts.prevMain));
  const c = opts.conditions || {};
  const lim = {
    sumMin: intOrNull(c.sumMin), sumMax: intOrNull(c.sumMax),
    spanMin: intOrNull(c.spanMin), spanMax: intOrNull(c.spanMax),
    oddMin: intOrNull(c.oddMin), oddMax: intOrNull(c.oddMax),
    bigMin: intOrNull(c.bigMin), bigMax: intOrNull(c.bigMax),
    acMin: intOrNull(c.acMin), acMax: intOrNull(c.acMax),
    consecMin: intOrNull(c.consecMin), consecMax: intOrNull(c.consecMax),
    repeatMin: intOrNull(c.repeatMin), repeatMax: intOrNull(c.repeatMax)
  };
  const rest = pool.filter(x => !dan.includes(x));
  const combos = [];
  let total = 0;
  const cur = [...dan].map(Number);
  const visit = start => {
    if (cur.length === pick) {
      const nums = [...cur].sort((a, b) => a - b);
      const sum = nums.reduce((a, b) => a + b, 0);
      const span = nums[nums.length - 1] - nums[0];
      const odd = nums.filter(v => v % 2 === 1).length;
      const big = nums.filter(v => v > mid).length;
      const ac = acValue(nums.map(String));
      let consec = 0;
      for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1] + 1) consec++;
      const repeat = prev.size ? nums.filter(v => prev.has(String(v).padStart(2, "0"))).length : 0;
      if (!inRange(sum, lim.sumMin, lim.sumMax)) return;
      if (!inRange(span, lim.spanMin, lim.spanMax)) return;
      if (!inRange(odd, lim.oddMin, lim.oddMax)) return;
      if (!inRange(big, lim.bigMin, lim.bigMax)) return;
      if (!inRange(ac, lim.acMin, lim.acMax)) return;
      if (!inRange(consec, lim.consecMin, lim.consecMax)) return;
      if ((lim.repeatMin != null || lim.repeatMax != null) && !inRange(repeat, lim.repeatMin, lim.repeatMax)) return;
      total++;
      if (combos.length < MAX_RETURN) combos.push(nums.map(v => String(v).padStart(2, "0")));
      return;
    }
    for (let i = start; i < rest.length; i++) {
      if (rest.length - i < pick - cur.length) break;
      cur.push(Number(rest[i]));
      visit(i + 1);
      cur.pop();
    }
  };
  visit(0);
  return {
    kind, name: s.name, pick, poolSize: pool.length, space,
    total, combos, truncated: total > combos.length,
    disclaimer: DISCLAIMER + "；过滤只改变覆盖范围，不改变单注中奖概率"
  };
}
