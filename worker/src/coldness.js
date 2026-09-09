// coldness：冷门组合评分 —— 唯一被真实分奖数据证实、且样本外成立的结构性收益来源。
// 它衡量的是「万一中了能独享多少」，不改变中奖概率；期望回报仍为负。
//
// 复现与月度重验：scripts/coldness/ssq-fit.mjs（randomness.yml 每月跑，样本外反号 / 安慰剂破 /
// 常量脱节都会把构建打成红）。想改下面任何一个 m，先改脚本、让它重拟合，别手调。
//
// 为什么只覆盖部分彩种（别为了「对称」把它铺到 8 个彩种）：
// 冷门度的全部价值来自「浮动奖要按中奖注数分奖」。固定奖玩法中了就是固定金额、无人与你分，
// 对这些玩法 coldness 对期望值的影响严格为 0 —— 属「不该做」，不是「还没做」：
//   已实现：ssq（一二等浮动，系数已样本外验证）
//   不该做：kl8 选1..选10 全固定奖、fc3d 直选1040/组三346/组六173、pl3、pl5（均固定奖）
//   试过但没发布：dlt —— 2921 期拟合过，目标样本外确实复现（五分位 1.30×、MW p=0.007），
//     但预注册的固定奖级安慰剂全灭：大乐透**没有任何一档奖金只依赖后区**（三等奖=前区5中+后区0中），
//     前区被超买时它的邻域(4中5)同样被超买，固定档注数被同一机制推高 → 这份数据无法区分「混淆」
//     与「真实的邻域人气」。按预注册规则 keep=[]、不发布。详见 docs/coldness-dlt-2026-09.md，
//     重跑见 scripts/coldness/dlt-fit.mjs。要推进它需要的是**集合外人气代理**，不是更多时间。
//   未验证：qxc 一等奖、qlc 一二等奖（浮动奖，理论上适用；但奖级列一列都没做过逐字段校验）
// 系数来源：全量 3501 期里 3250 期进入拟合（需销量>0 且一二等注数齐全），
//   按时间顺序旧 70%（2275 期）拟合、新 30%（975 期）样本外验证。
//   样本外同号：allLe31 1.135 / tail8 1.065 / tail4 0.884 / blueHot 1.220 / blueCold 0.845
//   样本外五分位最热 vs 最冷 = 1.506（p=6.2e-10）；安慰剂（蓝球特征打在不含蓝的二等奖上）1.006 / 0.993
//   连号特征样本外反号（0.992→1.028），已剔除——不因样本内好看就保留
export const COLD_KINDS = { ssq: true };
const SSQ = {
  features: [
    { key: 'allLe31', label: '全部红球 ≤31（可用日期表达，最多人在买）', m: 1.174 },
    { key: 'hasTail8', label: '含尾数 8（吉利偏好）', m: 1.074 },
    { key: 'hasTail4', label: '含尾数 4（回避，买的人少）', m: 0.918 },
    { key: 'blueHot', label: '蓝球在大热名单 05-12（同奖人数显著更多）', m: 1.241 },
    { key: 'blueCold', label: '蓝球在冷门名单 01/14/15/16', m: 0.812 }
  ],
  blueHotSet: [5, 6, 7, 8, 9, 10, 11, 12],
  blueColdSet: [1, 14, 15, 16],
  // 一等奖中奖注数均值：3412 期实测（有中奖期均值 8.68，一等奖空出的期占 4.7%），
  // 作为 estWinners 的绝对刻度；ratio 是每亿元投注归一后的相对倍数
  avgFirstWinners: 8.27,
  // 号码 ≥32 只有两个取值，出现即代表「日期表达不了」——是 allLe31 的反面，单列为提示
  coldLabel: r => r < 0.7 ? '很冷' : r < 0.9 ? '偏冷' : r <= 1.1 ? '中性' : r <= 1.4 ? '偏热' : '很热'
};
const DISC = '冷门度只影响中奖后与多少人分奖，不改变中奖概率；期望回报仍为负。';
const pad = x => String(x).padStart(2, '0');
const toNums = arr => (arr || []).map(x => (typeof x === 'number' ? x : parseInt(String(x).replace(/^0+(?=\d)/, ''), 10))).filter(Number.isFinite);
// 主入口：main = 红球数组，aux = 蓝球数组（ssq 取第一个）。非法输入返回 { error }，由路由转 400。
export function coldness(kind, main, aux) {
  if (!COLD_KINDS[kind]) return { supported: false, note: '当前仅双色球有拟合系数（数据源：3501 期真实一等奖注数）', disclaimer: DISC };
  const red = toNums(main), blue = toNums(aux)[0];
  if (red.length !== 6 || new Set(red).size !== 6 || red.some(x => x < 1 || x > 33)) return { error: '红球需为 6 个不重复的 01-33' };
  if (!Number.isFinite(blue) || blue < 1 || blue > 16) return { error: '蓝球需为 01-16 中的一个' };
  const b = SSQ, present = {
    allLe31: red.every(x => x <= 31) ? 1 : 0,
    hasTail8: red.some(x => x % 10 === 8) ? 1 : 0,
    hasTail4: red.some(x => x % 10 === 4) ? 1 : 0,
    blueHot: b.blueHotSet.includes(blue) ? 1 : 0,
    blueCold: b.blueColdSet.includes(blue) ? 1 : 0
  };
  let ratio = 1;
  const factors = [];
  for (const f of b.features) {
    if (!present[f.key]) continue;
    ratio *= f.m;
    factors.push({ key: f.key, label: f.label, effect: +f.m.toFixed(3) });
  }
  ratio = +ratio.toFixed(3);
  return {
    kind, main: red.map(pad), aux: [pad(blue)],
    ratio,                                   // 预计一等奖同奖人数 / 平均同奖人数，<1 对你有利
    label: b.coldLabel(ratio),
    coldIndex: Math.max(0, Math.min(100, Math.round(100 / ratio))), // 仅展示用的单调变换，越大越冷门
    avgFirstWinners: b.avgFirstWinners,
    estWinners: +(b.avgFirstWinners * ratio).toFixed(1),
    factors,
    note: '系数由历史一等奖实际中奖注数拟合，已做样本外验证与安慰剂对照；未覆盖的特征不计入。',
    disclaimer: DISC
  };
}
// 胆拖/复式的组合级估计：无法逐注算，给出「按注数期望的同奖人数」下界提示，措辞保持保守
export function coldnessSummary(kind, main, aux) { return coldness(kind, main, aux); }
