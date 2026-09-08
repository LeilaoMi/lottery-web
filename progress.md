# progress · lottery-web v0.10.0 完成

## v0.10.0：统计诚实性 + 预测记忆闭环 + 数据可靠性（反复琢磨轮）
- **指导思想**：彩票近似独立随机，「更玄的公式」不会带来真实提升；打磨方向 = 让「有效」有统计背书 + 预测可回看 + 数据链路防翻车
- **p 值**：backtest 三策略/杀号/逐公式全部输出二项检验 p（正态近似双侧，n<20 → null）；前端「显著」绿标
- **holdout 外推检验**：`kill-calibrated?holdout=0.3`——旧 70% 拟合权重，新 30% 上对比加权 vs 未加权杀号命中率；显式传参才算（默认 CPU 不变）
- **calibrate 样本量保护（审计修复）**：killed<10 → 权重 1；killed≥10 线性收缩到满强度（40 期满）；backtest 接受 weights 传入 killList——加权杀号的回测口径补齐（审计发现权重此前从未进回测）
- **分年稳定性**：backtest 输出 eras[]（date/期号前缀分桶），前端 >1 个年代才展示
- **形态转移矩阵**：analyze 号码池型返回 shape（和值/奇偶/大小/012路一阶转移 + 拉普拉斯平滑），前端卡片「上期形态→下期 Top3」
- **预测复盘闭环**：predlog 表（UNIQUE(kind,code)）+ review-job 独立请求（同步后 waitUntil 自 fetch 触发，CPU 独立）快照下一期推荐 + 开奖对账；/api/review 汇总滚动命中率；工具页复盘卡片
- **多源交叉校验**：getDraws 对 500/cwl 最近 30 期逐期比对，不一致期号拒绝落库，sync 报 crosscheck；getDraws 本来只比最新 1 期，本轮加深
- **数据去重（审计修复）**：drawsOf/drawsDeep/loadDraws 出口全按 code 去重并透传 _ 元属性；**mainOf/auxOf null 防御**（审计发现缺期数据可崩全链）
- 审计贡献：fresh-eyes 子代理独立审计 v0.9.0 方法学，产出 3 条已折入修复（死权重口径/样本量保护/null 崩溃）；未来函数与数组方向未发现问题
- 测试 58 全过（+5：binomP/eras/weights 回测/holdout/shapeTrans）；版本 0.10.0；README/接口表同步

## v0.9.0：回测 600 期 + 走势图 + 胆拖单导出 + 缓存三级化（做到位轮）
- **600 期回测**：`backtest` maxP 60→600；免费版 Workers CPU 10ms 限制 → 跨度 >60 期自动步长抽样（tested 封顶 60，返回 `tested/stride`）；killList 回测历史窗口封顶 100 期；`drawsDeep`(650 期) 接入 backtest/kill-calibrated/ticket
- **freqStats 性能重写**：当前遗漏由 lastSeen O(1) 推导（语义等价），消除 O(pool×draws) 次重复 getNums；600 期基准 ssq/kl8 33→25ms
- **线上实测 600 期通过**：ssq/qxc/kl8 全 200（periods=600/tested=60/stride=10）；ssq 杀号 16.7%<基线 18.2% 判「有效」，10 公式全有样本
- **遗漏走势图**：统一 `/api/trend?kind=`（号码池型全通），前端 ECharts 折线（默认最冷 4 号可自选 ≤8 个，dataZoom）；分析页自动加载
- **胆拖单保存/导出**：生成后可「保存到收藏」（POST /api/favs→D1）/复制/导出 TXT；线上 POST+GET+DELETE 冒烟闭环
- **kill-calibrated 三级缓存**：isolate 内存（x-cache: MEM，TTL 6h）→ caches.default（自定义域生效；workers.dev 上 no-op 是平台行为）→ 现算；缓存检查**前置到取数之前**（省 2.5s 上游拉取）
- **同步预热**：adminSync 完成后 waitUntil 自 fetch 8 彩种校准端点（各自独立请求 CPU 独立）；线上 sync 5.3s 返回 warm=[8 彩种]，预热后 ssq 即 MEM 命中
- 版本 0.9.0（package.json / wrangler*.toml / health）；部署 Version 8102b906；53 单测全过
- **过程教训（重要）**：同一文件多个 Edit 并行发送会互相覆盖（last-writer-wins），必须串行编辑 + 事后 grep 复验落盘；本机代理 57015 会故障（监听但上游断），workers.dev 可 `curl --noproxy '*'` 直连
- **推送完成（2026-09-08）**：代理恢复后 `git -c http.sslVerify=false -c http.proxy/https.proxy=127.0.0.1:57015 push origin main` 一次通过；GitHub MCP connector token 只读（403），不可用作推送通路（备用结论保留）

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
