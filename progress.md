# progress · lottery-web v0.8.0 完成

## v0.8.0：校准杀号 + 胆拖单 + 转移矩阵（打磨轮 2）
- `killList` 重构：10 类公式带稳定 key（FORMULAS），支持 `weights` 动态权重与 `perFormula` 分公式名单；零权重公式不计入 reasons
- `calibrate()`：按分公式回测命中率生成 [0.2,2] 权重（rate=基线→1，越高越降权）；`/api/kill-calibrated`（缓存 1800s）
- `ticket()`：胆拖投注单（ssq/dlt/qlc），胆=校准评分 top-D（剔除杀号），注数=C(拖, pick-胆)；`/api/ticket`
- `analyze` 新增 `auxTransition`（副区转移 Top6 + 无样本 fallback）；`picks[]` 带 sum/span；`predict?filter=1` 形态过滤（shapeOk）
- `/api/{qlc|kl8}/trend` 逐期遗漏走势；历史样本取数扩到 320 期（回测/校准/胆拖单）
- 自测抓到 3 个自产 bug：零权重公式仍进 reasons、胆拖缺省拖数被钳位成 1、转移字典 `tc` 被期数常量 `cnt` 遮蔽恒为空
- 测试 53 passed + live 12 passed；部署 Version 6552edaf；线上 5 接口实测全 200

## v0.7.0：回测引擎（打磨轮 1）
- `predict.js` 新增 `backtest()` / `backtestDigit()`：逐期「用当期之前的数据预测 → 与真实开奖比对」，热/冷/胆复用 scorePool 同一打分，杀号直接复用 killList（线上给什么就验什么）
- 输出全部带随机基线（单号 = pick/poolSize；数字型单位 = 10%），并给出「有效 / 无信息」诚实结论
- 修自产 bug：回测循环方向写反（测了最旧几期、历史窗口为空）→ 改为从最新往回测 periods 期
- 小彩种样本 60 → 150 期；`/api/backtest` 缓存 3600s
- 前端分析页：回测摘要（策略/杀号命中率 vs 基线 + 结论）+ 当前遗漏 Top10
- 测试 46 passed；线上 5 彩种回测实测（详见 README v0.7.0 节）

## 部署
- Version `2d862c1c-d587-4983-8c1b-e9824df08b77`
- https://lottery-web.horjane.workers.dev ，cp.leilaomi.cc.cd/* 路由已绑定
- D1 `lottery` APAC（NRT）已绑定；API_TOKEN secret 已配置（fail-closed 鉴权模型）

## v0.6.0 核心：统一预测引擎
- `worker/src/predict.js`：8 彩种共用同一套 分析 / 杀号 / 定胆 / 推荐 / 结构打分
- `worker/src/calc.js`：复式 / 胆拖 / 追号注数金额；快乐8 官方奖金表；3D 直选/组三/组六
- 新路由：`/api/predict|analyze|kill|dan|specs|calc|prize`；ssq / dlt / small 三套路由全部走同一引擎
- 小彩种补齐 `analyze|predict|kill|dan`（此前只有 latest/history/verify）
- 前端：预测页展示 6 组参考 + 杀号 + 定胆；新增「工具」页（注数 / 追号 / 中奖计算）

## 线上实测证据（2026-09-08，v0.6.0）
```
GET /health                     -> {"status":"ok","version":"0.6.0","lotteries":[8种]}
GET /api/predict?kind=ssq       -> 6 组参考（稳健·热号/进取·遗漏/均衡/区间覆盖/杀号缩水/随机基准），含结构分
GET /api/predict?kind=kl8&n=10  -> 快乐8 选十推荐，结构分按实际选号个数评估
GET /api/predict?kind=fc3d      -> 分位推荐 922 / 107 / 872 / 822 / 278 / 随机
GET /api/predict?kind=qxc       -> 七星彩 7 位分位冷热 + 遗漏
GET /api/predict?kind=qlc       -> 七乐彩 7 基本 + 1 特别（特别号不与基本号重复）
GET /api/calc?kind=ssq&red=9&blue=3&chase=3&mults=1,2,4 -> 252 注，追号 3 期合计 1764 注 / 3528 元
GET /api/prize?kind=kl8&pick=10&hit=9  -> 固定奖 8000
GET /api/prize?kind=fc3d&bet=1,1,2&draw=2,1,1 -> 组三 346
POST /api/admin/sync（Bearer API_TOKEN）-> 200，db=true，8/8 彩种全部 inserted
POST /api/admin/sync（无 token）-> 401；GET /api/favs 无 token -> 401（读接口仍公开）
```

## 鉴权与 CI
- API_TOKEN：`wrangler secret put API_TOKEN` 已设置（本机留存于 `~/.lottery_api_token`，600）
- Actions Secrets：`WORKER_URL` + `API_TOKEN` 已写入仓库（libsodium sealed box 加密，201）
- GitHub Actions 两次运行（push + workflow_dispatch）均 **success**（测试 + 落库同步）

## 测试
- `npm test`：44 passed / 0 failed（unit 34 + predict 10，含 8 彩种一致性、杀号降序、胆码去重、qlc 特别号不重复、缩水剔除杀号等）
- `npm run test:live`：12 passed / 0 failed

## 提交
- `8c5c285` feat(predict): 8 彩种统一预测引擎 + 杀号定胆 + 注数/中奖计算器
- `3a1da68` ci: 单元测试纳入统一预测引擎用例

## 已知待办
- 旋转矩阵为贪心构造，注数约为理论下界 1.5 倍（12/6/4：53 vs 33），非最优
- 杀号 / 定胆权重为经验值，可继续用历史回测校准
- 快乐8 奖金表为 2026-01 官方调整后数值，如官方再调需同步 `calc.js` 的 KL8 表
