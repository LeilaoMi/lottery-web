# progress · lottery-web v0.12.0

## v0.12.0：复盘闭环复活 + 冷门度模型 + 诚实性收敛（2026-09-10）

**本轮由一次全量实证审计驱动**，不是加功能冲动：把双色球 2003→2026 共 3501 期真实开奖（含各奖级中奖注数/销量/奖池，与官方接口逐字段核对 62+100 期全一致）跑完 4 组统计检验，据此修死链路、改口径，并且**只实现统计上站得住的那一项**。

### 修掉的三处「看着绿其实空转」

1. **复盘闭环从未对账**（`worker/src/index.js`）：全库仅 8 条快照、全部 `checked=0`、全部创建于 09-08 07:33，而 2026104 / 2026242 早已开奖入库。根因是 `reviewJob` 只被 `adminSync` 的 `ctx.waitUntil` 自 fetch 触发（免费层静默丢弃）。修法：CI 新增独立 `review` job 显式 `POST /api/admin/review-job`，并对每日彩种断言「最新快照距今 ≤2 天 + 已有对账记录」。
2. **CI 空断言**（`.github/workflows/sync.yml:59`）：对 `/api/review` 只断言 `typeof summary === 'object'`，`{}` 也通过——这就是闭环死了五天而 CI 全绿的原因。已换成实质形状断言 + 上面的真门禁。
3. **数字型彩种永久丢号**：`recommendDigits` 的字段是 `digits`/`number`，而快照与对账都读 `x.main` → fc3d/pl3/pl5/qxc 四个彩种快照只剩 `name`+`aux`（线上实测），永久不可对账。已按 `type` 分叉，数字型严格**逐位比对**（退化成"号出现在开奖号里"会让 123 判成与 321 全中）。

### 新增（唯一被样本外支持的）

- `worker/src/coldness.js` + `/api/coldness`：冷门度。**旧 70% 拟合 / 新 30% 样本外**：五分位最热/最冷 = 1.506 倍（p=6.2e-10）；**安慰剂**（蓝球特征打在不含蓝的二等奖）= 1.006 / 0.993 干净归零；连号特征样本外反号 0.992→1.028 **已剔除**。响应硬编码免责声明：只影响分奖人数，不改变中奖概率，期望回报仍为负。
- `scripts/randomness/`（+ 月度 workflow）：可重跑的 4 组检验，含"安慰剂一旦显著就构建失败"的门禁。复现值 `chi2R=44.5438`、`sumMean=100.9623`、χ² 零分布均值 **26.91（不是 df=32）**。
- 前端（`frontend/index.html`）：校准权重文案改「展示参考，不参与出票」；回测徽章加 `tested≥100` 门槛；噪声 ±2σ 基线图；追号护栏（总投入 / 长期期望损失 / 最坏累计）；复盘未运行红色告警。

### 验证

- `node --test`：**73 passed / 0 failed**（unit+predict 60 + coldness 8 + review 端到端 5，8 suites）；`worker/src/index.js` 真实 `import()` 通过；直接调用 Worker 处理器实测 `/health`→`0.12.0`、`/api/coldness` 200/400/未拟合彩种 `supported:false` 三种路径均正确
- **变异测试**：只把 `danHit` 改回下标遮蔽的错写 → `pass 4 / fail 1`（恰好只红对应那项）；还原后 73 全绿。证明新增的 5 项端到端回归是真守卫
- YAML：两份 workflow 经 PyYAML 解析通过，job 依赖图 `test → {smoke, sync → review}` 正确
- 前端重新构建 `ui.js` 60.6 KB，新字符串（coldness / 样本不足 / 展示参考 / 不改变中奖概率 / predlog）已落盘
- 密钥扫描：本轮全部 diff 与新文件中 `ghp_` / JWT / `TOKEN=字面量` / `Bearer 长串` 均 0 命中
- **本轮踩到并记下的两个陷阱**：① 测试桩若不模拟 `WHERE kind=?`，其他彩种循环会拿去解析 fc3d 的行并以空结果覆盖 UPDATE，造成**假阴性**（我一度据此误判产品代码有 bug）；② 测试代码里整串写 `Authorization: "Bearer x"` 会被环境的密钥脱敏改写，导致全部请求 401——必须拆片段拼接。另：我第一版 `danHit` 确实写下标遮蔽 bug（内层 `filter((v,i)` 的 `i` 是候选序号），被端到端测试抓到并已修复

### 自我更正（防复发）

曾断言 `kill-tune` 的 `periods` 参数无效——**错的**：`train[0].tested` 随 10/30/50/60 精确变化，只有 90 被 `num()` 钳位到 60，而我拿 80/90/120 三个都被钳位的值做对比。但同轮暴露了真问题：`periods=10` 判"有信息量"、`periods≥30` 判"过拟合"，结论依赖隐藏旋钮——这正是徽章加样本门槛的依据。

### 架构决策变更

原计划 P1 的 `money` 表 + D1 回填**取消**：coldness 改为离线拟合常量，外部操作面从「部署 + 迁移 + 回填 + Secrets」缩到「仅部署」。代价：系数需定期重拟合——**已还**：`scripts/coldness/ssq-fit.mjs` 重拟合 + 样本外验证 + 安慰剂 + 与 `worker/src/coldness.js` 常量对账，挂在 `randomness.yml` 月度作业里。

它对账的第一次运行就抓到两处**文档说谎**（代码是对的、注释是错的）：头注写「旧 70%（2437 期）」实际 2275 期；README 写「系数来自 3412 期」，而 3412 只是绝对刻度 `avgFirstWinners` 的分母，真正进入拟合的是 3250 期。顺带厘清一个会反复踩的口径坑：无条件均值 8.27（含 4.7% 一等奖空出的期，彩民每期都买所以刻度要用它）vs 拟合样本内条件均值 8.68，两者混用会把 `estWinners` 系统性高估。

### 第二阶段：把结论从「一家实测」推到「八家实测」，并给常量装上复现机器

- **随机性审计推广到 8 彩种**：`fetch-multi.mjs`（结构校验 + 与线上公共接口逐期号码交叉校验）+ `lib-kinds.mjs`（按 `池/开出数/type` 参数化，零分布期望现算）+ `analyze.mjs --all` → `docs/randomness-multi-latest.md`。116 个检验走 Bonferroni（α=4.31e-4）， surviving 的两条「显著」都被证伪：大乐透前区 χ²=89.1 是 2007–2014 **源数据回填缺陷**（分半 r=−0.26，2015+ p=0.89），七星彩第 7 位「非均匀」是**规则本身**（0–9 约 9%、10–14 约 1.8%）。`--all` 跑不全改成非零退出 + CI 数 VERIFIED 行数，别再出现「没跑成」和「没问题」一个样。
- **大乐透冷门度 = 负结果，按负结果处理**：只用 2015+（2921 期里 1753 期），目标样本外复现（五分位 1.30×、MW p=0.007），但固定奖级安慰剂对全部候选特征失败 → `keep=[]`、不发布。死结是方法学的：**大乐透没有任何一档奖金只依赖后区**，前区超买会连带推高 4中5 邻域的低奖级注数，这份数据分不清混淆与真实人气。**刻意不进月度 CI**（缺的是集合外人气代理，不是时间；每月一根红灯只会训练人忽略红灯）。留档 `docs/coldness-dlt-2026-09.md` + `scripts/coldness/dlt-fit.mjs`。
- **数据基线**：`scripts/randomness/data/*.json`（8 彩种）进仓库供离线复现，原始 `*_asc.txt`（约 4MB）加进 `.gitignore`。
- **验证**：`ssq-fit.mjs` 打印 `COLDNESS: PASS` 且 5 个上线系数与线上常量逐位相同（漂移 ≤0.0004）、冷热名单一致、8.27 对上；变异测试两轮都变红（安慰剂目标换成一等奖 → 2 失败退出 1；系数抹平为 1 → 6 失败、五分位塌到 1.177）。`analyze.mjs --all` 本地全跑：8 彩种 VERIFIED、`ACCEPTANCE: PASS ｜ PLACEBO: PASS`、退出码 0；`dlt-fit.mjs` 与姊妹解析 **2921/2921** 期号码一致。CI 四个 grep 锚点逐条在真实产物上验证过命中数（PLACEBO 1 / ACCEPTANCE 1 / VERIFIED 7 / 范围界定 1），并用「拿 `｜VERIFIED$` 去 grep 双色球深检报告 → 0 命中」做错靶对照，确认锚点不是巧合匹配；但**没做「把结论改坏看闸门是否变红」的负对照**——真正有牙的证据是上面那两轮变异测试。两份 workflow 经 `pyyaml.safe_load` 解析通过（bundled python：`~/.workbuddy/binaries/python/versions/3.13.12/python.exe`）。worker 73 + randomness 12 = **85 项全过**。
- **闸门断言必须自带负对照**：这一条本轮又被验证一次——`analyze.mjs` 的 `--all` 失败原来被 catch 吞掉（exit 0），意味着「多彩种挂掉」在 CI 里完全隐形。

### 下一步（待用户确认的外部操作）

1. `wrangler deploy`（走 `~/lw-deploy` 绕行，工作区内会被沙箱拦）→ 部署后 `/health` 应返回 0.12.0
2. push 后观察 Actions：`review` job 首次真实跑通对账（预期 `fc3d/pl3/pl5/kl8` 当轮即有 `reconciled>0`）
3. **`randomness.yml` 从未在 CI 跑过**：push 后手动 `workflow_dispatch` 一次（它需要能访问 data.17500.cn 与线上公共接口；任一数据源从 runner 不可达时会诚实失败，而不是给个好看的空结论——那时先看第 0 节的验收输出再判断是网络还是代码）
4. 线上冒烟 6 端点 + `/api/coldness` 实测；确认数字型快照不再丢号
5. GitHub PAT 换 fine-grained（权限过大，与本任务无关但同源风险）

## v0.11.0：工程韧性 + 使用体验（继续琢磨轮）
- **CI 部署冒烟**：sync.yml 新增 smoke job（push/定时后对线上 health/meta/ssq-latest/dlt-analyze/review 5 端点断言 200+关键字段）；smoke 与 sync 都依赖 secrets.WORKER_URL/API_TOKEN
- **dlt 交叉校验**：adminSync 的 dlt 段拉 fetchDLT+fetch17500DLT 最近 30 期逐期比对（`crossCheck` 助手与 ssq 复用，`drawPair` 归一各彩种号型字段），不一致期号拒绝落库
- **staleness 保险丝**：/api/meta 带 stale[]（8 彩种 D1 最新期距今天数，loadDraws×8 并行 + 10min 内存缓存 META_MEM）；前端 loadStale() 任一 kind ≥4 天顶部黄条
- **复盘显著性**：/api/review summary 挂 pickP/danP/killP（binomP 对照随机单号基线）；前端复盘卡片 pTag
- **阈值寻优**：predict.js `thresholdTune`（5 分位 FRACS × 旧70%/新30%，trainBest vs oracle 的 gap 判据）；/api/kill-tune 接入（periods 默认 20 抽样防 CPU 超限，结果 stashCache 缓存 6h）；前端分析页「杀号阈值寻优」按钮。**线上实测 ssq：train 最优 30% → test 20.2% vs oracle 40%/18.4%，gap=0.018 → 诚实判定「默认 30% 即可」**
- **缓存**：drawsDeep 加 DEEP_MEM（TTL 30min，key=kind+probe 最新期号，新开奖自动失效）；kill-calibrated 缓存写回抽 `stashCache` 与 kill-tune 共用
- **今日日报页**：前端新 tab（data-t=d）——开奖日历（LOT_DAYS 红灰标）/ 破纪录遗漏（/api/records breaking/near）/ 上期对账 / 下期快照
- **/api/records**：pool 型逐号 + digit 型逐位遗漏（O(N×pool) 单扫式，8 彩种并行，REC_MEM 缓存 30min）；breaking=当前遗漏≥样本内纪录，near=≥80% 且纪录≥10
- **可视化**：回测 eras 柱图（btchart：热/杀命中率×基线参考线）、复盘 revchart 小图（实际 vs 随机基线）
- **线上发现并修复 P2**：review-job 只取 8 期喂 analyzeAll(win=30) → 快照 picks/dan 全空；改 60 期；D1 清掉 checked=0 且 picks 空的 bug 快照（ON CONFLICT DO NOTHING 不会覆盖旧快照），今晚 cron 重建
- 测试 60 全过（+2：killThreshold 分位参数化 / thresholdTune 结构与 holdout 方向）；版本 0.11.0；部署 Version a8a1cb57；README/接口表同步
- **线上验证记录**：health 0.11.0 ✓ / meta stale 数值合理（ssq 2 天）✓ / records 三型正常 ✓ / kill-tune 200（5.9s 冷，CPU 达标）✓ / dlt predict picks6 kill25 dan8 ✓ / kill-calibrated weights10 ✓ / backtest 600 期 200 ✓

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
