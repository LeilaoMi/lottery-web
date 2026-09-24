// ⚠️ 由 scripts/coldness/ssq-fit.mjs 生成，勿手改。重跑脚本会覆盖本文件。
// 站内「观测 vs 预测」回看：D1 无历史注数/销量列，只能在拟合时烘焙。
export const COLDBT = {
 "generated": "2026-09-24T14:28:21.448Z",
 "kind": "ssq",
 "nTrain": 2275,
 "nTest": 975,
 "trainQuintiles": [
  {
   "q": 1,
   "n": 455,
   "predicted": 0.9341,
   "observed": 2.255
  },
  {
   "q": 2,
   "n": 455,
   "predicted": 1.1458,
   "observed": 2.323
  },
  {
   "q": 3,
   "n": 455,
   "predicted": 1.3186,
   "observed": 2.942
  },
  {
   "q": 4,
   "n": 455,
   "predicted": 1.4867,
   "observed": 3.601
  },
  {
   "q": 5,
   "n": 455,
   "predicted": 1.733,
   "observed": 3.796
  }
 ],
 "testQuintiles": [
  {
   "q": 1,
   "n": 195,
   "predicted": 0.9101,
   "observed": 2.28
  },
  {
   "q": 2,
   "n": 195,
   "predicted": 1.108,
   "observed": 2.195
  },
  {
   "q": 3,
   "n": 195,
   "predicted": 1.2728,
   "observed": 2.603
  },
  {
   "q": 4,
   "n": 195,
   "predicted": 1.4567,
   "observed": 3.018
  },
  {
   "q": 5,
   "n": 195,
   "predicted": 1.7078,
   "observed": 3.434
  }
 ],
 "ratioTest": 1.506,
 "ratioTrain": 1.862,
 "mwP": 6.16463768920994e-10,
 "note": "predicted = 组合指数（训练段系数）均值，observed = 实际一等奖注数/亿元；样本外五分位单调上升 = 拟合不是噪声。只影响分奖人数，不改变中奖概率。",
 "disclaimer": "随机游戏，统计仅供娱乐，不保证中奖。"
};
