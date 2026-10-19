<div align="center">

# 🎱 lottery-web

**自托管 · 8 彩种彩票数据站 —— 把「猜号」换成「算账」**

Cloudflare Workers + D1 · 零 npm 依赖 · 单页 PWA · GitHub Actions 驱动

![version](https://img.shields.io/badge/version-0.19.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![runtime%20deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![unit%20tests](https://img.shields.io/badge/unit%20tests-237-brightgreen)
![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)

*开奖查询 · 批量验奖 · 每注期望回报 · 反热门机选 · 冷门度 · 选号工作台 · 缩水过滤 · 统计分析 · 预测复盘 · 站内审计*

</div>

> ⚠️ **随机游戏，期望回报恒为负，不保证中奖。** 本站能改变的只有「万一中了要和多少人分奖」，改变不了中奖概率。
> 这句话不是套话，是下面这些线上实测数字得出的结论。

---

## 目录

- [结论先行：项目真实现状](#-结论先行项目真实现状)
- [它能做什么](#-它能做什么)
- [数据与可靠性](#-数据与可靠性)
- [运维现状](#-运维现状)
- [架构与技术栈](#-架构与技术栈)
- [支持彩种](#-支持彩种)
- [快速开始](#-快速开始) · [本地开发](#-本地开发) · [API 速览](#-api-速览) · [目录结构](#-目录结构) · [文档地图](#-文档地图)

## 📌 结论先行：项目真实现状

**① 预测（杀号 / 定胆 / 推荐）跑不赢随机——这是线上复盘闭环自己给出的答案。**
每期开奖前快照推荐号，开奖后对账，二项检验对照随机基线（`/api/review`，2026-10-19 数据）：

| 彩种 | 已对账期数 | 推荐命中率 | 随机基线 | p 值 |
|---|---|---|---|---|
| 快乐8 | 34 | 23.8% | 25.0% | 0.41 |
| 排列5 | 33 | 10.5% | 10.0% | 0.75 |
| 排列3 | 33 | 10.1% | 10.0% | 1.00 |
| 福彩3D | 33 | 7.7% | 10.0% | 0.23 |
| 大乐透 | 15 | 18.2% | 14.3% | 0.12 |
| 七乐彩 | 16 | 27.1% | 23.3% | 0.12 |
| 双色球 | 15 | 20.0% | 18.2% | 0.48 |

有高有低、没有一个显著，和纯随机的表现一致。预测模块因此保留为**可证伪的娱乐功能**：
页面照常给出推荐，但复盘数字公开挂着，不再继续加杀号公式（只会制造过拟合）。

**② 真正能动的只有「分奖」，v0.19 把它做成了工具。**

- **每注期望回报**（`/api/ev`）：按现行双色球规则 + 奖池滚存 + 近 6 期销量，估算一注 2 元能拿回多少。
  当前约 **0.99 元（回报率 49.5%）**。奖池常年 10 亿上下、远超两段封顶能派发的上限，
  近 60 期赛前回报率只在 49.51%~49.53% 之间——**「挑奖池大的期买」在现在这个奖池水位下没有区别**，数字会如实显示这一点。
- **反热门机选**（`/api/coldpick`）：在冷门度模型认得的特征上取最冷一侧（含 32/33、无尾 8、含尾 4、蓝球 01/14/15/16），
  同奖倍率约 0.745，回报率约 **51.7%**（普通号码 49.5%）。中奖概率完全不变，多出来的那 2 个百分点全部来自「中了以后少分」。
- **冷门度**只发双色球：大乐透拟合过，但预注册的安慰剂对照没通过，按规则不发布（见 [docs/coldness-dlt-2026-09.md](docs/coldness-dlt-2026-09.md)）；
  固定奖玩法（快乐8 / 3D / 排列3 / 排列5）没人和你分，冷门度对它们的影响严格为 0。

**③ 工程状态**：8 个彩种每天自动落库，复盘闭环、每日 D1 备份、站内审计都在跑；`/api/audit` 当前是 **warn**，
原因如实写在里面：500.com 从 CF 出口偶尔不通，这些批次只剩单一源，没做成交叉校验。

## ✨ 它能做什么

| 我想…… | 用什么 | 说明 |
|---|---|---|
| 查开奖、看奖池销量 | 开奖页 / `/api/{kind}/latest`、`history` | 双色球·大乐透附奖池、销量、一二等奖（仅 500 源有，其余显示「—」，不编造） |
| 对一堆票 | 批量验奖 `/api/verify-batch` | ≤200 注 × ≤10 期；浮动奖金额标 `null`（未校验），不当成 0；大乐透按开奖日期选奖级版本 |
| 知道这期亏多少 | 每注期望回报 `/api/ev` | 双色球；拆成低等奖/一等奖/二等奖三部分，附近 60 期赛前回放 |
| 选一组少人买的号 | 反热门机选 `/api/coldpick`、冷门度 `/api/coldness` | 只影响分奖人数；每注附带自己的期望回报 |
| 自己选号、算注数 | 选号工作台、`/api/calc`、`/api/filter`、`/api/rotation` | 选球盘标当前遗漏；缩水过滤只改变覆盖范围，不改变单注概率；旋转矩阵约理论下界 1.5 倍注数 |
| 看统计、玩预测 | `/api/predict`、`/api/analyze`、`/api/backtest`、`/api/kill-calibrated` | 6 套策略 + 10 类杀号公式 + 定胆；回测给随机基线与 p 值，有未来函数防护 |
| 检查站点健康 | `/api/audit`、`/api/review`、`/api/sync-log` | 新鲜度 / 复盘闭环 / 同步健康 / 冷门度回看 / 免责声明五项；skip 绝不算 pass |

## 🛡️ 数据与可靠性

- **多源交叉校验**：双色球快源 500（cwl 从 CF 出口长期不通），**对等源 17500**；大乐透 500 + 17500。最近 30 期逐期比对，
  不一致的期号**拒绝落库**。校验只放在唯一写入口 `adminSync`，不拖慢页面。
- **单源不许显示成绿灯**：只有一个源应答时 `sync_health` 判 **warn**；三源全挂（读路径占位，0 落库）记为 warn 并单列，
  只有最近一批仍未恢复才 fail；真正的号码冲突才是 fail。
- **快源抖动重试**：落库时 500 源失败会等 3 秒重试一次；GitHub 端落库与复盘请求带 `--retry`（两者都幂等）。
- **批量落库**：D1 `batch` 50 条一块，一次同步约 20 次往返，整轮约 1 分钟（以前逐行 880 次、2~3 分钟，会被掐断）。
- **降级要开口**：小彩种上游挂了读 D1 并标 `degraded`；双色球全挂时的占位数据在页面上红框标明；所有上游 fetch 有硬超时（8s / 全量 20s）。
- **防假数据进库**：占位期号永不落库；Service Worker 只缓存成功响应；未捕获异常统一回 JSON 500。

## ⚙️ 运维现状

| 流水线 | 触发 | 做什么 |
|---|---|---|
| `sync.yml` | push main / 每日定时 / 手动 | 单测 → 部署 → 版本收敛门禁 → 线上冒烟 → 8 彩种落库 → 复盘快照与对账 →（默认关闭的）开奖推送 |
| `backup.yml` | 每日 UTC 16:00 | 导出 D1（默认不含 `favs`）→ 真还原进 sqlite 逐表数行 → R2 或 Actions 产物 |
| `randomness.yml` | 每月 | 8 彩种随机性审计 + 冷门度重拟合与线上常量对账 |

- Cloudflare 免费 Cron 配额已满，定时落库由 GitHub Actions 触发。**实测 GitHub 定时会晚 3 小时左右**（北京时间凌晨才跑），
  当晚开奖仍会在次日早上前入库；两条 cron 同日各跑一次，相当于自带一次重试。
- 部署与落库共用 `lottery-prod` 并发组，和备份互斥（导出期间 D1 会短暂不可用）。
- 鉴权：读接口全部公开；`/api/favs` 与 `/api/admin/*` 需要 `Bearer API_TOKEN`，未配置时一律 401（fail-closed），比较为定长。

## 🏗 架构与技术栈

```
GitHub Actions ──POST /api/admin/sync──▶ Worker ──▶ 500 / 17500（/ cwl）
      │                                   │  交叉校验通过 → D1 batch 落库
      └──POST /api/admin/review-job──▶    │  快照下一期推荐 / 对账已开奖
浏览器 PWA ◀── frontend/ 内联进 Worker ──┘  读接口：isolate 内存 → edge cache → 现算
```

| 层 | 选型 | 说明 |
|---|---|---|
| 运行时 | Cloudflare Workers | 纯 JS 路由表，零 npm 依赖 |
| 存储 | D1 | 6 张表（开奖×3 / 复盘 / 收藏 / 同步日志），迁移版本化 |
| 前端 | 原生单页 + ECharts 5 | `frontend/` 是唯一事实源，构建时内联 |
| 测试 | `node --test` | 237 项离线单元测试（219 worker + 13 统计内核 + 5 推送，零依赖离线可跑）+ 12 项真实数据源连通性测试（`npm run test:live`，需联网，默认不跑） |

## 🎫 支持彩种

| id | 彩种 | 规则 | 开奖 |
|---|---|---|---|
| `ssq` | 双色球 | 红 6/33 + 蓝 1/16 | 周二·四·日 |
| `dlt` | 大乐透 | 前 5/35 + 后 2/12 | 周一·三·六 |
| `fc3d` | 福彩 3D | 3 位 0-9 | 每日 |
| `pl3` | 排列 3 | 3 位 0-9 | 每日 |
| `pl5` | 排列 5 | 5 位 0-9 | 每日 |
| `qlc` | 七乐彩 | 基本 7/30 + 特别号 | 周一·三·五 |
| `qxc` | 七星彩 | 前 6 位 0-9 + 第 7 位 0-14 | 周二·五·日 |
| `kl8` | 快乐 8 | 20/80 | 每日 |

---

## 🚀 快速开始

### 前置要求

- Node.js ≥ 20（无需 `npm install`——项目零依赖，wrangler 用 `npx` 临时拉起）
- 一个 Cloudflare 账号（免费版即可）

### 1. 建库

```bash
npx wrangler d1 create lottery          # 记下返回的 database_id
# ⚠️ --remote 不能省：不加就只在你本机的 miniflare 里建表，部署后的站点照样没有表
npx wrangler d1 execute lottery --remote --file=db/schema.sql -y
```

### 2. 部署配置

```bash
cp worker/wrangler.toml worker/wrangler.local.toml
# 编辑 worker/wrangler.local.toml：把 database_id 的 REPLACE_ME 换成第 1 步的 ID
# 要绑自定义域名就取消那段 routes 的注释（模板默认注释，原因见 docs/PUBLISH.md）
```

> `wrangler.local.toml` 含真实 ID，已在 `.gitignore` 中，不会进仓库。

### 3. 部署

**推荐：GitHub Actions 自动部署。** 仓库已带 `sync.yml`：push 到 main → 单元测试 → 部署 → 冒烟 → 落库 → 复盘。
只需在 *Settings → Secrets and variables → Actions* 配置（未配置则自动跳过部署，fork 友好）：

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 有 Workers/D1 权限的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `D1_DATABASE_ID` | 第 1 步建的库 ID |
| `WORKER_URL` | 站点正式地址（第 5 步还要用它做健康检查与落库，见下） |

可选变量 `WORKER_ROUTE_PATTERN` / `WORKER_ROUTE_ZONE`（如 `cp.example.com` / `example.com`）会把自定义域名一并绑上。
**建议生产入口走自定义域名**：workers.dev 子域是 Cloudflare 的共享域名，个别账号会出现子域整体不可用
（访问报 1101）而自定义域名一切正常的情况；`WORKER_URL` 指向自定义域名即可完全绕开。

**备选：本地手动部署。**

```bash
cd worker
npm run build:ui                                    # frontend/ → src/ui.js
npx --yes wrangler deploy --config wrangler.local.toml
```

> `--config` 是相对 `worker/` 的路径。别写成 `npm --prefix worker run deploy -- --config worker/wrangler.local.toml` ——
> npm 会在**包目录里**执行脚本（实测：临时 package.json 探针的 `process.cwd()` 落在 prefix 目录），
> 那条命令实际会去找 `worker/worker/wrangler.local.toml`，根本不存在。

部署成功会输出 `https://<你的项目名>.<你的子域>.workers.dev`，打开即是完整站点。

### 4. （可选）鉴权

```bash
npx wrangler secret put API_TOKEN
```

鉴权模型：**开奖数据是公开信息，读接口一律免鉴权**；只有写操作与个人数据（`/api/favs` 全部方法、`/api/admin/sync`）
要求 `Authorization: Bearer <API_TOKEN>`。未设置 `API_TOKEN` 时写接口一律拒绝（fail-closed）。

### 5. （可选）定时落库与复盘

`.github/workflows/sync.yml` 在 CI 通过后按开奖日触发落库（双色球 / 大乐透 / 每日小彩种），并在同步后自动预热校准缓存、
生成复盘快照。需在仓库 *Settings → Secrets and variables → Actions* 配置：

| Secret | 值 |
|---|---|
| `WORKER_URL` | 你的 Worker 地址，**优先填自定义域名**；workers.dev 地址在个别账号不可用（1101）时健康检查会一直失败 |
| `API_TOKEN` | 与 Worker 的 secret 一致（未设置鉴权则无法同步落库） |

### 6. （可选）月度随机性审计

`.github/workflows/randomness.yml` 每月重跑 8 彩种审计与冷门度拟合。它**不需要任何 secrets**，但如果希望「号码交叉校验」
这道闸门生效，需配一个**普通变量**（非密钥）：

| Variable | 值 |
|---|---|
| `PUBLIC_API_BASE` | 你的公共接口地址（同 `WORKER_URL`）。不配 → 该闸门被显式跳过并在报告里标注原因，VERIFIED 闸门会如实失败而不是放水通过 |

## 💻 本地开发

```bash
cd worker
npm run build:ui     # 从 frontend/ 生成 src/ui.js（ui.js 是构建产物，不进仓库）
npm test             # 单元测试（237 项，零依赖，离线可跑）
npm run test:live    # 真实数据源连通性测试（需联网，默认不跑）
npm run dev          # wrangler dev 本地起服务
```

排查「页面上什么都没有」用这两个脚本（都不依赖浏览器，仓库根目录跑）：

```bash
node scripts/page-audit.mjs       # 逐个标签页 × 8 彩种查接口：空响应、空字段、类型形状是否完整
                                   # BASE=https://你的站点 node scripts/page-audit.mjs  # 换站点
node scripts/verify-live-ui.mjs   # 部署后核对线上页面脚本的关键渲染事实（图表登记表 / 分流路径 / 警示文案）
```

这两类问题（200 OK 但页面空白）在单测里看不见，只能对着真实响应查——2026-09-30 那轮「只有双色球有图表数据」就是这么定位的。

统计与冷门度脚本（同样零依赖，可在离线数据上复现文档里的全部结论）：

```bash
node scripts/randomness/fetch-ssq.mjs                 # 双色球全量历史 + 官方逐字段交叉校验
node scripts/randomness/fetch-multi.mjs --api-base="https://<你的站点>"   # 其余 7 彩种（不配则跳过线上校验）
node scripts/randomness/analyze.mjs --all             # 8 彩种开奖侧审计
node scripts/coldness/ssq-fit.mjs                     # 冷门度重拟合 + 与线上常量对账
```

## 📖 使用说明

前端是一个 8 tab 单页（PWA，手机可安装、弱网有 Service Worker 兜底）：

| Tab | 内容 |
|---|---|
| **预测** | 6 套策略推荐 + 杀号 + 定胆 + 胆拖单生成/导出 |
| **选号** | 选号工作台：8 彩种选球盘（每球标注当前遗漏）、普通/胆拖、机选、号码篮、缩水过滤、近 30 期走势格子图 |
| **今日** | 今日开奖日历、破纪录遗漏预警、上期对账、下期快照 |
| **分析** | 频次/冷热/遗漏/形态转移可视化、遗漏走势图、回测摘要（分年柱图 + 外推检验 + 阈值寻优按钮） |
| **历史** | 最近 30 期开奖；双色球/大乐透在 500 源可达时附奖池/销量/一二等奖列，缺数据显「—」 |
| **验奖·矩阵** | 按期号验奖；**批量验奖**：一沓票贴进来一次验多期（每行一注，坏行只报行号不吞其余票）；旋转矩阵（覆盖设计） |
| **工具** | 注数/追号计算器、中奖计算器、预测复盘 |
| **收藏** | 自选号管理（需 D1） |

首次打开在顶部填入 Worker 地址（部署后访问首页会自动带入 origin）。

## 🔌 API 速览

所有响应均为 JSON，带 `Access-Control-Allow-Origin: *`，支持 `OPTIONS` 预检。`kind` 取值见「支持彩种」，也可写成路径形式 `/api/ssq/predict`。

### 核心

| 路径 | 参数 | 说明 |
|---|---|---|
| `/api/predict` | `kind=`, `win=5..100`, `n=` | 6 套策略推荐 + 杀号 + 定胆 + 分析，一次返回 |
| `/api/analyze` | `kind=`, `win=` | 号码池型：频次/冷热/遗漏/奇偶/大小/质合/AC/012路/区间/连号/重号 + `shape` 形态转移矩阵；数字型：`perPos[]` 逐位给 `freq`/`omission`/`oddRatio` + `form`（组三/组六/豹子）+ `shape.note`（说明形态转移不适用）。附带 `sources[]` 声明本次数据来源，`sources:["mock"]` 表示上游全挂、页面显示占位数据 |
| `/api/kill` | `kind=` | 杀号投票（10 类公式加权 + threshold） |
| `/api/dan` | `kind=`, `win=` | 定胆 |
| `/api/backtest` | `kind=`, `periods=1..600` | 历史回测：真实命中率 vs 随机基线 + p 值 + 分年稳定性；>60 期自动抽样（返回 `tested/stride`） |
| `/api/kill-calibrated` | `kind=`, `holdout=0..0.5` | 校准杀号（按分公式回测生成动态权重）；`holdout=0.3` 触发外推检验；结果缓存 6h |
| `/api/kill-tune` | `kind=` | 杀号阈值寻优：5 分位 × 两段 10 次回测，`gap` 判据防调参过拟合；结果缓存 6h |
| `/api/review` | `kind=`（可选） | 预测复盘：滚动命中率 + 二项检验 p 值 + 对账明细 |
| `/api/trend` | `kind=`, `limit=5..60` | 逐期遗漏走势 |
| `/api/ticket` | `kind=`, `dan=`, `tuo=` | 胆拖投注单（ssq/dlt/qlc） |
| `/api/coldness` | `kind=ssq`, `nums=01,05,...`, `blue=09` | 冷门度：估计中奖后**与多少人分奖**（`ratio`<1 有利）。只影响分奖人数，**不改变中奖概率**；仅双色球有拟合系数 |
| `/api/ev` | `kind=ssq` | 双色球下一期每注期望回报（低等奖/一等奖/二等奖拆分）+ 近 60 期赛前回放；只有 500 源带奖池/销量，备源降级时如实 503 |
| `/api/coldpick` | `n=1..20` | 反热门机选：冷门度最冷一侧的随机组合，每注附同奖倍率与期望回报；中奖概率不变 |

> **数字型彩种（fc3d / pl3 / pl5 / qxc）没有号码池**，因此：`/api/trend` 的逐期遗漏走势不适用（改看「各位置当前遗漏」）、
> 形态转移矩阵不适用、`/api/analyze` 改按位给 `perPos[]`。这是数据结构决定的，不是功能缺失——
> 站上会直说「不适用」并给出能画的那张图，不会留一张空白图让人以为坏了。

### 查询与工具

| 路径 | 参数 | 说明 |
|---|---|---|
| `/api/{kind}/latest` / `history?limit=` | — | 最新一期 / 历史 |
| `/api/{kind}/verify` | ssq: `code&red&blue` · dlt: `code&front&back` · 其余: `code&nums` | 验奖 |
| `/api/verify-batch` | **POST** + JSON `{"kind","code"或"codes"[],"tickets"[],"mult"}` | 批量验奖（≤200 注 × ≤10 期）。返回逐注奖级/命中/金额 + 每期汇总；`errors[].line` 是你贴进来的原始行号，`amount: null` 表示**该奖级金额本站未校验**（浮动奖），不是 0；大乐透固定奖按开奖日期选择规则版本（2019-02-20 为界） |
| `/api/meta` | — | 彩种元数据 + `stale[]` 数据新鲜度 + `predlog[]` 复盘闭环健康度 |
| `/api/specs` | — | 8 彩种规则规格（球池/位数/奖级结构），选号工作台据此渲染选球盘 |
| `/api/sync-log?limit=` | — | 上游同步健康时序（最近 N 次落库的 fetched / inserted / 交叉校验结果），前端「同步健康」图 |
| `/api/audit` | — | 站内健康审计（5 项检查聚合）：数据新鲜度 / 复盘闭环 / 同步健康 / 冷门度回看 / 免责声明。`overall` 语义 `fail > warn > skip > pass`——有 skip 绝不算 pass |
| `/api/coldness/backtest` | — | 冷门度样本外回看（烘焙的观测 vs 预测五分位），D1 无历史注数列故由拟合脚本烘焙进 Worker |
| `/api/records` | — | 破纪录遗漏预警（当前遗漏 vs 样本内历史最大遗漏） |
| `/api/calc` | `kind=` + 复式/胆拖/追号参数 | 注数 / 金额 / 追号计划（`chase>1` 时附 `plan[].date` / `chase.dates` 开奖日历投影 + 免责说明） |
| `/api/miss` | `kind=`, `win=5..200` | 当前遗漏：每个号码的当前/平均/最大遗漏与窗口频次（号码池型给 `main`/`aux`，数字型给 `perPos[]`）；选号工作台选球盘的数据源，纯历史描述 |
| `/api/filter` | POST `{kind, pool?, dan?, exclude?, pick?, conditions:{sumMin,sumMax,oddMin,oddMax,spanMin,spanMax,acMin,acMax,consecMin,consecMax,repeatMin,repeatMax}}` | 缩水过滤：枚举候选池组合按形态条件筛（仅号码池型）；枚举空间上限 30 万、返回上限 2000 注；过滤只改变覆盖范围，不改变单注中奖概率 |
| `/api/prize` | `kind=` + 命中参数（大乐透可选 `date=YYYY-MM-DD` 选规则版本） | 奖级与固定奖金额 |
| `/api/rotation` | `n=&pick=&hit=` | 旋转矩阵（覆盖设计，注数约理论下界 1.5 倍） |
| `/api/favs` | GET/POST/DELETE | 收藏（需鉴权） |
| `/api/admin/sync` | POST | 触发 8 彩种落库（需鉴权），响应含各彩种 `crosscheck` 报告 |
| `/api/admin/review-job` | POST | 触发复盘快照 + 对账（需鉴权）。CI 的 `review` job 显式调用它，不再依赖 `sync` 内部的 `waitUntil` 自 fetch |
| `/health` | — | `{status, version, lotteries}` |

<details>
<summary><b>返回结构示例（点击展开）</b></summary>

```jsonc
{
  "kind": "ssq", "type": "pool", "window": 30, "count": 30,
  "analysis": { "hot": [], "cold": [], "freq": {}, "omission": {"cur":{}, "avg":{}, "max":{}} },
  "kill":   { "main": [{"n":"27","votes":4,"reasons":["上期出号","跨度26"]}], "threshold": 3.5 },
  "dan":    { "main": [{"n":"05","score":3.4,"freq":21,"cur":2,"avg":1.8}] },
  "picks":  [ { "name":"稳健·热号", "main":["01","05","12","19","26","33"], "aux":["14"], "score":9 } ]
}
```

数字型（`fc3d/pl3/pl5/qxc`）把 `main` 换成按位的 `digits`，`analysis` 含 `perPos[]`，并附近 N 期组三 / 组六 / 豹子形态。

**杀号 10 类公式**：上期出号、邻号 ±1、和值尾、跨度 ±1、极号 ±1、热尾、冷 012 路、质合偏态、热区、上上期号。

</details>

<details>
<summary><b>环境变量参考（点击展开）</b></summary>

| 变量 | 类型 | 说明 |
|---|---|---|
| `DB` | D1 binding | 建库后绑定（`wrangler.local.toml`） |
| `VERSION` | var | 版本号，`/health` 返回 |
| `API_TOKEN` | secret | 写接口鉴权；不设置则写接口一律 401（fail-closed） |
| `DATA_SOURCE_OFFICIAL` | var/secret | 自定义双色球数据源 URL（返回 `[{code,red,blue,date}]` JSON），设置后双色球只走该源 |
| `DATA_SOURCE_PUBLIC` | var/secret | 同上，第二自定义源；两者可并用交叉比对 |

</details>

## 📁 目录结构

```
lottery-web/
├── frontend/               # 前端唯一事实源（构建时内联进 Worker）
│   ├── index.html          # 单页应用（多标签页 + 内联 JS）
│   ├── sw.js               # Service Worker 离线兜底
│   ├── manifest.json       # PWA manifest
│   └── icon.svg
├── worker/
│   ├── src/
│   │   ├── index.js        # 路由 / 三级缓存 / CORS / 鉴权 / 落库调度 / 复盘 job
│   │   ├── predict.js      # 统一预测引擎（8 彩种共用）
│   │   ├── coldness.js     # 冷门度（分奖人数）评分，系数由 scripts/coldness 拟合
│   │   ├── coldness-backtest.js # 冷门度回看：观测分档 vs 预测是否同向
│   │   ├── ev.js           # 双色球每注期望回报（现行规则 + 泊松均分）+ 反热门机选
│   │   ├── verify-batch.js # 批量验奖：解析贴进来的票 → 复用上面的奖级函数逐注判
│   │   ├── ssq.js          # 双色球取数（500 + cwl + 17500）与验奖
│   │   ├── dlt.js          # 大乐透取数与验奖
│   │   ├── small.js        # 6 小彩种解析 / 奖级 / 旋转矩阵
│   │   ├── calc.js         # 注数 / 金额 / 追号 / 快乐8 奖金表
│   │   ├── miss.js         # 当前遗漏（复用 predict.freqStats 口径，供选号工作台）
│   │   ├── filter.js       # 缩水过滤（候选池组合枚举 + 形态条件筛）
│   │   ├── db.js           # D1 读写
│   │   ├── net.js          # 带超时的上游 fetch（宁可降级，也不把请求拖死）
│   │   └── ui.js           # ⚠️ 构建产物（不进仓库，先 build:ui）
│   ├── test/               # 离线套件：npm test 走 test/*.test.mjs（glob，新增文件不会被漏掉）
│   │   ├── unit.test.mjs   # 基础单元测试
│   │   ├── predict.test.mjs # 预测引擎测试（含 8 彩种一致性）
│   │   ├── coldness.test.mjs # 冷门度：方向 / 单调 / 输入校验 / 免责声明
│   │   ├── review.test.mjs # 复盘 job 端到端（假 D1 按 WHERE 过滤）
│   │   ├── verify-batch.test.mjs # 批量验奖：解析 / 奖级金额 / 位置敏感 / 汇总 + 路由 HTTP 契约
│   │   ├── ui-render.test.mjs # 前后端契约：真跑后端再让前端渲染函数画一遍（字段改名会被抓住）
│   │   ├── page-render.test.mjs # 页面渲染契约：8 彩种 × 历史/分析页真的渲染出内容（防空白页）
│   │   ├── analyze-contract.test.mjs # 分析页数据契约：8 彩种 analyze 字段齐全（防数字型渲染成空白）
│   │   ├── frontend.test.mjs # 前端 script 块语法门禁 + 图表实例登记表（防 0 宽空白图）
│   │   ├── crosscheck.test.mjs # 双源交叉校验：与暴力逐期比对对拍（缺期≠冲突）
│   │   ├── regress.test.mjs # 历史缺陷回归锁（40 项，含本轮修过的每个坑）
│   │   ├── small-route.test.mjs # 小彩种路由分派 / 降级数组 / 样本门槛 / 口径
│   │   ├── net.test.mjs    # 上游超时：用不回包的本地 server 验超时真的生效
│   │   ├── sw-queue.test.mjs # Service Worker 离线队列
│   │   ├── readme.test.mjs  # README 事实核对：测试数/版本/目录结构必须与仓库一致（防文档悄悄腐烂）
│   │   ├── miss.test.mjs   # 当前遗漏：号码池/数字型逐位口径与空样本
│   │   ├── detail.test.mjs # 开奖详情：500 页面奖池/销量/奖级列序夹具
│   │   ├── filter.test.mjs # 缩水过滤：枚举/条件/胆码排除/空间上限
│   │   ├── ev.test.mjs     # 期望回报：组合数 / 两段封顶规则 / 冷门倍率 / 机选约束
│   │   ├── hardening.test.mjs # v0.18.1 深挖回归锁：批量落库 / 收藏入参 / 全局兜底 / 定长鉴权 / 全挂分级 / 转义
│   │   └── live.network.mjs # 真实数据源连通性（需联网，刻意不叫 *.test.mjs 以免混入离线套件）
│   ├── wrangler.toml       # 部署模板（database_id 脱敏为 REPLACE_ME，routes 默认注释）
│   └── wrangler.local.toml # 你自己的配置（.gitignore，不提交）
├── scripts/
│   ├── build-ui.mjs        # frontend/ → worker/src/ui.js 打包脚本
│   ├── notify.mjs          # 开奖推送：读公共接口 → 按各家格式 POST webhook（默认不发）
│   ├── notify.test.mjs     # 推送测试：payload 形状 + 本地 http server 真发一次
│   ├── page-audit.mjs      # 线上巡检：7 个标签页 × 8 彩种逐接口查空响应/空字段（BASE 环境变量可覆盖站点）
│   ├── verify-live-ui.mjs  # 部署后核对线上页面脚本的关键渲染事实（不依赖浏览器）
│   ├── randomness/         # 随机性审计：8 彩种取数 + A/B/C/D/E 检验（零依赖，见其 README）
│   └── coldness/           # 冷门度系数拟合 + 样本外验证 + 与线上常量对账
├── db/
│   ├── schema.sql           # D1 bootstrap = 按序拼接的全部迁移（6 张表，unit.test 锁死与 migrations 一致）
│   └── migrations/          # 版本化迁移 0001_baseline.sql…（已发布不许改，改动只许新增 00NN_）
├── docs/                   # 文档地图见下方链接表，索引在 docs/README.md
└── .github/workflows/
    ├── sync.yml            # CI：测试 → 线上冒烟 → 定时落库 → 复盘对账 →（默认关闭的）开奖推送
    ├── backup.yml          # 每日 D1 导出 + 还原验证 → R2 或 Actions 产物（不配 secrets 就跳过）
    └── randomness.yml      # 每月：8 彩种随机性审计 + 冷门度重验（不需要 secrets）
```

## 📚 文档地图

| 我想…… | 看这里 |
|---|---|
| 从零部署一个自己的站 | 本文 [🚀 快速开始](#-快速开始) → [docs/PUBLISH.md](docs/PUBLISH.md)（发布 / 自建清单、CI 能力与所需配置总表） |
| 搞清「哪些结论有依据、哪些被证伪了」 | [docs/research.md](docs/research.md)（假设对账）→ [docs/randomness-2026-09.md](docs/randomness-2026-09.md)（深检基线） |
| 每月自动重跑的报告长什么样 | [docs/randomness-latest.md](docs/randomness-latest.md) · [docs/randomness-multi-latest.md](docs/randomness-multi-latest.md) · [docs/coldness-latest.md](docs/coldness-latest.md) |
| 理解冷门度为什么只发双色球、不发大乐透 | [docs/coldness-dlt-2026-09.md](docs/coldness-dlt-2026-09.md)（一个负结果的留档） |
| 关键设计决策当初为什么这么做（零依赖 / 鉴权 / skip≠pass / 迁移版本化…） | [docs/why.md](docs/why.md) |
| 配备份 / 配开奖推送 | [docs/BACKUP.md](docs/BACKUP.md) · [docs/NOTIFY.md](docs/NOTIFY.md) |
| 看某个版本改了什么、为什么 | [docs/CHANGELOG.md](docs/CHANGELOG.md) |
| 跑统计脚本 | [scripts/randomness/README.md](scripts/randomness/README.md) · [scripts/coldness/README.md](scripts/coldness/README.md) |
| 全部文档索引 | [docs/README.md](docs/README.md) |

## 🧭 设计原则

1. **统计诚实**：任何「有效」结论必须对照随机基线 + 显著性检验；工具的第一句话可能是「别调」（阈值寻优的实测结论）
2. **杜绝未来函数**：回测只用当期之前的数据
3. **数据宁缺毋滥**：多源不一致的期号拒绝落库，D1 旧值仍是好的
4. **闸门宁可失败不可放水**：数据没验过就标 UNVERIFIED、审计缺项就让 CI 红，「没跑成」不能伪装成「没问题」
5. **免费版友好**：CPU 10ms 限制下自动抽样、三级缓存（isolate 内存 → edge cache → 现算）、重计算走独立请求
6. **一份事实源**：前端只有 `frontend/` 一份源码，Worker 内联构建产物，杜绝两份 HTML 漂移
7. **公开仓库默认不带私人数据**：备份默认不含 `favs`、模板不含真实 ID 与 route、源码与 workflow 不写死任何人的站点地址

## 📜 版本演进

`v0.5` 数据正确性大修 → `v0.6` 统一预测引擎 → `v0.7` 历史回测 → `v0.8` 校准杀号+胆拖单 → `v0.9` 600 期回测+走势图 →
`v0.10` 统计诚实性+复盘闭环 → `v0.11` 工程韧性+今日日报 → `v0.12` 结论可证伪化（8 彩种审计 + 冷门度系数可复现 + 复盘闭环修活）→
`v0.13` 顺手与可运维（批量验奖 + 前后端契约测试 + 可选 D1 备份 / 开奖推送，默认关闭）→
`v0.14` 大乐透奖级版本化 → `v0.15` 缺陷排查两轮 + CI 自动部署 → `v0.16` 选号工作台 + 当前遗漏 →
`v0.17` 缩水过滤 + 走势格子图 → `v0.18` 开奖详情（奖池/销量/一二等奖，仅双色球·大乐透）→
`v0.19` 从猜号转向算账：每注期望回报 + 反热门机选（并含 v0.18.1 的全量深挖修复）

完整变更记录见 **[docs/CHANGELOG.md](docs/CHANGELOG.md)**。

## 📄 声明

- 自研代码以 MIT 许可发布（见 [LICENSE](LICENSE)）
- 开奖数据归属原站（500.com / 中彩联 cwl.gov.cn / 17500），本项目仅做统计与缓存
- 逻辑借鉴（均为自写实现）：sinyu1012/Double-Color-Ball-AI、oahzxd/lottery、BEWINDOWEB/lotterygrabber、
  longgeyyds/ssq-fusion、Konata/chinese-lottery-predict、zxz0119/lottery-ai-simulator 等 MIT 项目，
  TheMelody/LotteryTrend（Apache-2.0，保留声明）；完整清单见站内 `/licenses` 与 [docs/research.md](docs/research.md)
- **随机游戏，统计仅供娱乐，不保证中奖**
