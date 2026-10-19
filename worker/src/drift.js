// 开奖偏差长期监测：标准化伯努利 CUSUM（双侧，k=0.5）。
// 每个号码（数字型为「第几位 × 哪个数字」）一条 0/1 序列，期望 p = 每期开出个数 / 号池大小。
// 阈值 H 由同一开奖机制（不放回抽取）的蒙特卡洛标定：一个区的全部序列在 500 期窗口内
// 任何时刻越界的概率 ≤5%（scripts/drift-calibrate.mjs 重跑；DRIFT_H 是其输出）。
// 越界 = 这个区出现了随机很难解释的偏离（或 5% 的误报）；不越界 = 没有可利用的偏差。
import { SPECS, mainOf, auxOf, posPool } from "./predict.js";

export const WINDOW = 500, K = 0.5;
// zoneKey → H（蒙特卡洛 3000 次，95% 分位，2026-10-19 标定，见 scripts/drift-calibrate.mjs）
export const DRIFT_H = {
  "pool:33:6": 14.92, "pool:16:1": 18.3, "pool:35:5": 15.99, "pool:12:2": 13.73, "pool:30:7": 13.63, "pool:80:20": 14.34,
  "digit:10:3": 16.67, "digit:10:5": 18.33, "digit:10:6": 18.33, "digit:15:1": 18.09
};

// 一个彩种拆成若干「区」：每区 = 号池大小 size、每期开出 pick 个（数字型为每位 1 个）、位数 slots
export function zonesOf(kind) {
  const s = SPECS[kind];
  if (!s) return [];
  if (s.type === "digit") {
    const zs = [];
    const n10 = kind === "qxc" ? 6 : s.digits;
    zs.push({ id: "digits", label: kind === "qxc" ? "前 6 位" : "各位", key: `digit:10:${n10}`, size: 10, slots: n10, pick: 1,
      get: d => mainOf(d, kind).slice(0, n10).map(Number) });
    if (kind === "qxc") zs.push({ id: "pos7", label: "第 7 位", key: "digit:15:1", size: 15, slots: 1, pick: 1, get: d => [Number(mainOf(d, kind)[6])] });
    return zs;
  }
  const zs = [{ id: "main", label: s.main.label, key: `pool:${s.main.max}:${s.main.pick}`, size: s.main.max, slots: 1, pick: s.main.pick, get: d => mainOf(d, kind).map(Number) }];
  if (s.aux && kind !== "qlc") zs.push({ id: "aux", label: s.aux.label, key: `pool:${s.aux.max}:${s.aux.pick}`, size: s.aux.max, slots: 1, pick: s.aux.pick, get: d => auxOf(d, kind).map(Number) });
  return zs;
}

// rows：时间正序的观测，每行是数组（pool：开出的号 1..size；digit：每位的数字 0..size-1）
// 返回每条序列的 { cur+, cur-, max+, max- } 与全区最大值
export function cusumZone(zone, rows) {
  const off = zone.key.startsWith("digit") ? 0 : 1;
  const nSeries = zone.size * zone.slots;
  const p = zone.pick / zone.size, sd = Math.sqrt(p * (1 - p));
  const up = new Float64Array(nSeries), dn = new Float64Array(nSeries), mu = new Float64Array(nSeries), md = new Float64Array(nSeries);
  const hit = new Uint8Array(nSeries);
  for (const r of rows) {
    hit.fill(0);
    if (zone.slots > 1) r.forEach((v, pos) => { if (v >= 0 && v < zone.size) hit[pos * zone.size + v] = 1; });
    else for (const v of r) { const i = v - off; if (i >= 0 && i < zone.size) hit[i] = 1; }
    for (let i = 0; i < nSeries; i++) {
      const z = (hit[i] - p) / sd;
      up[i] = Math.max(0, up[i] + z - K); dn[i] = Math.max(0, dn[i] - z - K);
      if (up[i] > mu[i]) mu[i] = up[i]; if (dn[i] > md[i]) md[i] = dn[i];
    }
  }
  let maxAll = 0;
  for (let i = 0; i < nSeries; i++) maxAll = Math.max(maxAll, mu[i], md[i]);
  return { up, dn, mu, md, maxAll };
}

// 蒙特卡洛：随机开奖（不放回）下全区 maxAll 的 q 分位
export function simulateH(zone, window = WINDOW, sims = 2000, q = 0.95, rnd = Math.random) {
  const vals = [];
  const base = Array.from({ length: zone.size }, (_, i) => i + (zone.key.startsWith("digit") ? 0 : 1));
  for (let s = 0; s < sims; s++) {
    const rows = [];
    for (let t = 0; t < window; t++) {
      if (zone.slots > 1) { const r = []; for (let k = 0; k < zone.slots; k++) r.push(Math.floor(rnd() * zone.size)); rows.push(r); }
      else { const a = base.slice(); for (let k = 0; k < zone.pick; k++) { const j = k + Math.floor(rnd() * (a.length - k)); [a[k], a[j]] = [a[j], a[k]]; } rows.push(a.slice(0, zone.pick)); }
    }
    vals.push(cusumZone(zone, rows).maxAll);
  }
  vals.sort((a, b) => a - b);
  return +vals[Math.floor(q * (vals.length - 1))].toFixed(2);
}

// draws：新→旧（与站内其他取数一致）
export function driftReport(kind, draws, window = WINDOW) {
  const zs = zonesOf(kind);
  if (!zs.length) return { error: "unknown kind" };
  const recent = (draws || []).slice(0, window);
  if (recent.length < 100) return { error: "insufficient_history", note: "历史不足 100 期，无法监测" };
  const rows0 = recent.slice().reverse();
  const zones = zs.map(z => {
    const rows = rows0.map(z.get).filter(r => r.length && r.every(Number.isFinite));
    const c = cusumZone(z, rows), H = DRIFT_H[z.key] || null;
    const series = [];
    for (let i = 0; i < z.size * z.slots; i++) {
      const pos = Math.floor(i / z.size), v = (i % z.size) + (z.key.startsWith("digit") ? 0 : 1);
      const name = z.slots > 1 ? `第${pos + 1}位=${v}` : (z.key.startsWith("digit") ? `第7位=${v}` : String(v).padStart(2, "0"));
      series.push({ name, curHigh: +c.up[i].toFixed(2), curLow: +c.dn[i].toFixed(2), maxHigh: +c.mu[i].toFixed(2), maxLow: +c.md[i].toFixed(2) });
    }
    const peak = Math.max(...series.map(x => Math.max(x.maxHigh, x.maxLow)));
    const alarms = H ? series.filter(x => Math.max(x.maxHigh, x.maxLow) > H).map(x => ({ name: x.name, dir: x.maxHigh >= x.maxLow ? "偏多" : "偏少", peak: Math.max(x.maxHigh, x.maxLow), ongoing: Math.max(x.curHigh, x.curLow) > H })) : [];
    const top = series.slice().sort((a, b) => Math.max(b.curHigh, b.curLow) - Math.max(a.curHigh, a.curLow)).slice(0, 5);
    return { id: z.id, label: z.label, draws: rows.length, threshold: H, peak: +peak.toFixed(2), alarm: alarms.length > 0, alarms, top };
  });
  const any = zones.some(z => z.alarm);
  return {
    kind, window: recent.length, from: recent[recent.length - 1]?.code, to: recent[0]?.code, zones,
    verdict: any ? "有区越界：出现随机难以解释的偏离（也可能是 5% 的误报），可持续观察，但开奖机常换球换机，不宜据此下注" : "全部在阈值内：近期开奖与均匀随机一致，没有可利用的偏差",
    method: `标准化伯努利 CUSUM（双侧，k=${K}），阈值为随机开奖蒙特卡洛 95% 分位（每区全部号码 × ${WINDOW} 期内任一时刻越界的概率 ≤5%）`,
    disclaimer: "随机游戏，统计仅供娱乐，不保证中奖"
  };
}
