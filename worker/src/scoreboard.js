// 复盘记分牌的两个统计工具：Holm 多重比较校正 + 二项序贯概率比检验（SPRT）。纯函数。

// Holm–Bonferroni：返回与输入同序的校正后 p 值（单调化并夹到 1）；null 原样保留
export function holm(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null && Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = idx.length, out = ps.map(p => (p == null ? null : p));
  let run = 0;
  idx.forEach(([p, i], r) => { run = Math.max(run, Math.min(1, (m - r) * p)); out[i] = +run.toFixed(4); });
  return out;
}

// Wald SPRT：H0 p=p0，H1 p=p0×lift。返回对数似然比与判决（h0 / h1 / continue）
export function sprt(hits, n, p0, lift = 1.2, alpha = 0.05, beta = 0.05) {
  if (!(n > 0) || !(p0 > 0 && p0 < 1)) return null;
  const p1 = Math.min(0.999, p0 * lift);
  const llr = hits * Math.log(p1 / p0) + (n - hits) * Math.log((1 - p1) / (1 - p0));
  const A = Math.log((1 - beta) / alpha), B = Math.log(beta / (1 - alpha));
  return { llr: +llr.toFixed(3), upper: +A.toFixed(3), lower: +B.toFixed(3), lift, verdict: llr >= A ? "h1" : llr <= B ? "h0" : "continue" };
}
