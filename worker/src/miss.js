// 当前遗漏：每个号码「距最近一次出现隔了多少期」+ 历史平均/最大遗漏 + 窗口内频次。
// 纯描述统计（与 analyze 的 freqStats 同一口径），只陈述历史，不构成对下期的任何预测。
// 复用 predict.js 的 freqStats/poolOf/posPool/mainOf/auxOf，避免再写一套取号逻辑而口径分叉。
import { SPECS, specOf, poolOf, posPool, mainOf, auxOf, freqStats, DISCLAIMER } from "./predict.js";

function zoneRows(kind, draws, zone, getNums, pool) {
  const st = freqStats(draws, pool, getNums);
  return pool.map(num => ({
    num,
    freq: st.freq[num] ?? 0,
    cur: st.cur[num] ?? draws.length,
    avg: st.avg[num] ?? draws.length,
    max: st.max[num] ?? draws.length
  }));
}

// draws 约定与全站一致：新期在前（draws[0] 为最新一期）。
export function missStats(kind, draws, win = 100) {
  const s = specOf(kind);
  const list = (Array.isArray(draws) ? draws : []).slice(0, win);
  const out = {
    kind, name: s.name, type: s.type,
    count: list.length,
    latest: list.length ? (list[0].code || "") : "",
    disclaimer: DISCLAIMER
  };
  if (!list.length) return out;
  if (s.type === "digit") {
    out.perPos = [];
    for (let p = 0; p < s.digits; p++) {
      out.perPos.push(zoneRows(kind, list, null, d => {
        const v = mainOf(d, kind)[p];
        return v === undefined ? [] : [v];
      }, posPool(kind, p)));
    }
    return out;
  }
  out.main = zoneRows(kind, list, s.main, d => mainOf(d, kind), poolOf(s.main));
  if (s.aux) out.aux = zoneRows(kind, list, s.aux, d => auxOf(d, kind), poolOf(s.aux));
  return out;
}

export { SPECS };
