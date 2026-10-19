// 重新标定 worker/src/drift.js 的 DRIFT_H：随机开奖（不放回）下每区全部序列 500 期 CUSUM 最大值的 95% 分位。
// 用法：node scripts/drift-calibrate.mjs [sims=2000]  → 打印可直接粘贴的 DRIFT_H 对象
import { zonesOf, simulateH } from "../worker/src/drift.js";
const sims = Number(process.argv[2] || 2000);
const seen = new Map();
for (const k of ["ssq", "dlt", "qlc", "kl8", "fc3d", "pl5", "qxc"]) for (const z of zonesOf(k)) if (!seen.has(z.key)) seen.set(z.key, z);
const out = {};
for (const [key, z] of seen) { out[key] = simulateH(z, 500, sims); console.error(key, out[key]); }
console.log(JSON.stringify(out));
