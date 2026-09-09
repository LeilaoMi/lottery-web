import { fetchT, BULK_MS } from "./net.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export const SRC = {
  fc3d: "http://data.17500.cn/3d_asc.txt",
  pl3: "http://data.17500.cn/pl3_asc.txt",
  pl5: "http://data.17500.cn/pl5_asc.txt",
  qlc: "http://data.17500.cn/7lc_asc.txt",
  qxc: "http://data.17500.cn/7xc_asc.txt",
  kl8: "http://data.17500.cn/kl8_asc.txt"
};

// 期号格式（2026-09 实测 17500 各行，qxc 为 5 位，其余为 7 位）
const CODE_RE = {
  fc3d: /^\d{7}$/,
  pl3: /^\d{7}$/,
  pl5: /^\d{7}$/,
  qlc: /^\d{7}$/,
  qxc: /^\d{5}$/,
  kl8: /^\d{7}$/
};

export function pad2(x) { return String(x).padStart(2, "0"); }

// 号码归一化：用户可能输入 "1" / " 1 " / "01"，统一成 "01"
export function normNums(arr) {
  return (arr || [])
    .map(x => String(x).trim())
    .filter(Boolean)
    .map(x => (/^\d{1,3}$/.test(x) ? pad2(Number(x)) : x));
}

export async function fetchSmall(kind, limit = 100) {
  const url = SRC[kind];
  if (!url) throw new Error("unknown kind " + kind);
  const re = CODE_RE[kind];
  const r = await fetchT(url, { headers: { "User-Agent": UA } }, BULK_MS);
  if (!r.ok) throw new Error("http " + r.status);
  const lines = (await r.text()).split(/\r?\n/);
  const out = [];
  // 文件为升序，倒序遍历取最新
  for (let li = lines.length - 1; li >= 0 && out.length < limit; li--) {
    const p = lines[li].trim().split(/\s+/).filter(Boolean);
    if (p.length < 5) continue;
    const code = p[0], date = p[1] || "";
    if (!re.test(code)) continue;
    const ints = (a, b) => p.slice(a, b).map(x => parseInt(x, 10));
    if (kind === "fc3d" || kind === "pl3") {
      const a = ints(2, 5);
      if (a.length === 3 && a.every(x => x >= 0 && x <= 9)) out.push({ code, date, digits: a.map(String), src: "17500" });
    } else if (kind === "pl5") {
      const a = ints(2, 7);
      if (a.length === 5 && a.every(x => x >= 0 && x <= 9)) out.push({ code, date, digits: a.map(String), src: "17500" });
    } else if (kind === "qlc") {
      const m = ints(2, 9), s = parseInt(p[9], 10);
      // 七乐彩：30 选 7 基本号 + 1 特别号，特别号不与基本号重复
      if (m.length === 7 && m.every(x => x >= 1 && x <= 30) && new Set(m).size === 7 &&
          s >= 1 && s <= 30 && !m.includes(s)) {
        out.push({ code, date, main: m.map(pad2).sort(), special: pad2(s), src: "17500" });
      }
    } else if (kind === "qxc") {
      const a = ints(2, 9);
      if (a.length === 7 && a.every(x => x >= 0 && x <= 9)) out.push({ code, date, digits: a.map(String), src: "17500" });
    } else if (kind === "kl8") {
      const a = ints(2, 22);
      if (a.length === 20 && a.every(x => x >= 1 && x <= 80) && new Set(a).size === 20) {
        out.push({ code, date, nums: a.map(pad2).sort(), src: "17500" });
      }
    }
  }
  return out.slice(0, limit);
}

// 双色球奖级（官方六档）
export function prizeSSQ(hr, hb) {
  if (hr === 6 && hb) return "一等";
  if (hr === 6) return "二等";
  if (hr === 5 && hb) return "三等";
  if ((hr === 5 && !hb) || (hr === 4 && hb)) return "四等";
  if ((hr === 4 && !hb) || (hr === 3 && hb)) return "五等";
  if (hb && hr <= 2) return "六等";
  return "未中";
}

// 超级大乐透奖级（官方九档，修正旧代码把 4+2 判成三等的错误）
export function prizeDLT(hf, hb) {
  if (hf === 5 && hb === 2) return "一等";
  if (hf === 5 && hb === 1) return "二等";
  if (hf === 5 && hb === 0) return "三等";
  if (hf === 4 && hb === 2) return "四等";
  if (hf === 4 && hb === 1) return "五等";
  if (hf === 3 && hb === 2) return "六等";
  if (hf === 4 && hb === 0) return "七等";
  if ((hf === 3 && hb === 1) || (hf === 2 && hb === 2)) return "八等";
  if ((hf === 3 && hb === 0) || (hf === 2 && hb === 1) || (hf === 1 && hb === 2) || (hf === 0 && hb === 2)) return "九等";
  return "未中";
}

// 七乐彩奖级（官方七档）：hitMain 基本号命中数，hitSpecial 特别号是否命中
export function prizeQLC(hitMain, hitSpecial) {
  if (hitMain === 7) return "一等";
  if (hitMain === 6 && hitSpecial) return "二等";
  if (hitMain === 6) return "三等";
  if (hitMain === 5 && hitSpecial) return "四等";
  if (hitMain === 5) return "五等";
  if (hitMain === 4 && hitSpecial) return "六等";
  if (hitMain === 4) return "七等";
  return "未中";
}

function C(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - i + 1)) / i;
  return Math.round(r);
}

// 从 arr 中取 k 个下标的所有组合（已排序）
function combIdxOf(arr, k) {
  const res = [], cur = [];
  (function rec(start) {
    if (cur.length === k) { res.push(cur.slice()); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1); cur.pop(); }
  })(0);
  return res;
}

function randCombo(v, k) {
  const s = new Set();
  while (s.size < k) s.add(Math.floor(Math.random() * v));
  return [...s].sort((a, b) => a - b);
}

/**
 * 旋转矩阵（覆盖设计 C(v,k,t)）
 * 语义：从 v 个自选号中每注选 k 个，保证「若开奖号命中你自选号中的任意 t 个」，
 *       则至少有一注同时包含这 t 个号。t 即 minHit。
 * 旧实现为取模循环，minHit 从未参与计算，不具备任何覆盖保证，已替换。
 */
export function rotation(n, pick, minHit = 4, maxBlocks = 200) {
  const v = Math.max(2, Math.min(33, Math.floor(n) || 12));
  const t = Math.max(2, Math.min(v, Math.floor(minHit) || 4));
  const k = Math.max(t, Math.min(v, Math.floor(pick) || 6));

  const totalT = C(v, t);
  if (totalT > 60000) {
    return { error: "组合规模过大，请减小 n 或提高 minHit", n: v, pick: k, minHit: t, totalT };
  }

  const allIdx = Array.from({ length: v }, (_, i) => i);
  const tSets = combIdxOf(allIdx, t);
  const key = a => a.join(",");
  const uncovered = new Set(tSets.map(key));

  // 候选注：组合数可控时全枚举，否则随机采样（贪心近似，结果会如实标注）
  // 注意先算组合数再决定，避免为 C(33,6)=110 万这种规模先全量枚举
  let pool = [], sampled = false;
  if (C(v, k) <= 12000) {
    pool = combIdxOf(allIdx, k);
  } else {
    sampled = true;
    const seen = new Set();
    while (pool.length < 6000) {
      const b = randCombo(v, k);
      const kk = key(b);
      if (!seen.has(kk)) { seen.add(kk); pool.push(b); }
    }
  }
  const blockTs = pool.map(b => combIdxOf(b, t));
  const nums = allIdx.map(i => pad2(i + 1));

  const combos = [];
  while (uncovered.size > 0 && combos.length < maxBlocks) {
    let bestI = -1, bestC = 0;
    for (let i = 0; i < pool.length; i++) {
      let c = 0;
      for (const ts of blockTs[i]) if (uncovered.has(key(ts))) c++;
      if (c > bestC) { bestC = c; bestI = i; }
    }
    if (bestI < 0) break;
    for (const ts of blockTs[bestI]) uncovered.delete(key(ts));
    combos.push(pool[bestI].map(i => nums[i]).sort());
  }

  const guaranteed = uncovered.size === 0;
  return {
    n: v, pick: k, minHit: t,
    combos,
    blocks: combos.length,
    totalT,
    uncovered: uncovered.size,
    guaranteed,
    sampled,
    note: guaranteed
      ? `覆盖设计 C(${v},${k},${t})：全部 ${totalT} 个 ${t} 号组合均被覆盖，若中 ${t} 个必出`
      : `贪心近似（${sampled ? "候选随机采样" : "候选全枚举"}）：剩余 ${uncovered.size}/${totalT} 个 ${t} 号组合未覆盖，未达 100% 保证，请提高 maxBlocks 或减小 n`
  };
}

/** 独立校验一组注是否真正满足 C(v,t) 覆盖，供测试与自检使用 */
export function verifyCoverage(v, t, blocks) {
  const toIdx = b => b.map(x => parseInt(x, 10) - 1).sort((a, b2) => a - b2);
  const need = new Set(combIdxOf(Array.from({ length: v }, (_, i) => i), t).map(a => a.join(",")));
  for (const b of blocks) {
    for (const ts of combIdxOf(toIdx(b), t)) need.delete(ts.join(","));
  }
  return { covered: true, remain: need.size, ok: need.size === 0 };
}
