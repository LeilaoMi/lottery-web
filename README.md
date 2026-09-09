<div align="center">

# 🎱 lottery-web · 自用彩票分析站

**8 个彩种 · 统一预测引擎 · 统计诚实性优先**

[![CI](https://github.com/LeilaoMi/lottery-web/actions/workflows/sync.yml/badge.svg)](https://github.com/LeilaoMi/lottery-web/actions/workflows/sync.yml)
![version](https://img.shields.io/badge/version-0.13.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)

Cloudflare Workers + D1 · 零运行时依赖 · 单页 PWA 前端

*开奖查询 · 统计分析 · 杀号定胆 · 历史回测 · 预测复盘 · 注数与中奖计算*

</div>

> ⚠️ **随机游戏，统计仅供娱乐，不保证中奖。** 本项目的设计目标是让每个「有效」结论都有统计背书，而不是承诺中奖。

---

## ✨ 功能特性

### 🎯 统一预测引擎

- **8 个彩种共用同一套引擎**（`worker/src/predict.js`），接口返回结构完全一致——不存在「双色球有推荐、其他彩种只有统计」的割裂
- **6 套策略推荐**：稳健·热号 / 进取·遗漏 / 均衡 / 区间覆盖 / 杀号缩水 / 随机基准，均带结构分（和值 / 奇偶 / 大小 / 区间 / 跨度 / AC）
- **杀号**：10 类公式加权投票（票数 + 命中原因）；`/api/kill-calibrated` 给出按分公式回测得到的权重与 `/api/kill-tune` 的阈值寻优。**如实说明：这些校准权重目前只用于展示参考名单，没有接入推荐与胆拖单的出票路径**（`recommendAll` / `ticket` 调的是无权重 `killList`）。未擅自接通，是因为它会改变实际下注号码而权重本身并无统计依据
- **定胆**：频率 + 遗漏回归 + 邻号 + 重号
- **胆拖投注单**：一键生成注数金额，可保存收藏 / 复制 / 导出 TXT
- **批量验奖 `POST /api/verify-batch`**：一沓票贴进来一次验多期（≤200 注 × ≤10 期）。奖级判定**复用**与单注验奖、中奖计算器同一套函数——两套验奖规则迟早分叉，分叉的结果就是「工具说中了、彩票站说没中」。金额只给本站校验过的固定奖级；浮动奖（双色球一二等奖）与规则换过时代的彩种（大乐透）返回 `null` 并说明原因，**不猜数、更不显示成 0**
- **冷门度 `/api/coldness`（本项目唯一被样本外验证支持的可操作项）**：估计一注号码**万一中了要和多少人分奖**，不改变中奖概率。系数来自双色球全量 3501 期中 3250 期的**真实一等奖中奖注数**（按销量归一），按时间顺序旧 70%（2275 期）拟合、新 30%（975 期）样本外检验：五分位最热 / 最冷 = **1.506 倍**（p=6.2e-10）；安慰剂对照（蓝球特征打在不含蓝球的二等奖上）= **1.006 / 0.993** 干净归零；连号特征因样本外反号（0.992→1.028）被剔除。全生日区 + 热门蓝 ≈ 12 个同奖者，含 32/33 + 尾 4 + 冷门蓝 ≈ 6 个——**期望回报仍为负**。
  复现与月度重验：`node scripts/coldness/ssq-fit.mjs`（产物 `docs/coldness-latest.md`，同时与线上常量对账）
- **大乐透也拟合过，但没有发布**：目标本身样本外复现了（五分位 1.30×、p=0.007），可预注册的固定奖级安慰剂全灭——大乐透没有任何一档奖金只依赖后区，前区被超买时它的邻域同样被超买，用这份数据**分不清**「实现混淆」和「真实的邻域人气」。按规则 `keep=[]`。负结果与全部中间量见 `docs/coldness-dlt-2026-09.md`（要推进它需要集合外的人气代理数据，不是更多时间）

### 📊 统计诚实性（本项目的灵魂）

- **全量实证基线**：双色球 2003→2026 共 **3501 期**（含各奖级中奖注数 / 销量 / 奖池，与官方接口逐字段核对一致）已完成一遍随机性检验，存档于 `docs/randomness-2026-09.md`，并由 `scripts/randomness/` 每月自动重跑。结论：**独立性检验全部为 null**（与上期重合数、lag-1 自相关、遗漏分布、蓝球连开、开奖位置都落在随机应有的区间内），即冷热、遗漏、回补类说法在这份数据上没有依据
  - **推广到 8 个彩种**（`analyze.mjs --all`，各 2063–8750 期，报告 `docs/randomness-multi-latest.md`）：开奖侧「无可利用结构」从双色球一家的**外推**，升级为 8 家的**实测**。数字型（3D / 排列3 / 排列5）样本最大、灵敏度最高，它的「无信号」最有分量
  - **两条看着像发现的读数，都被证伪而不是被采纳**：大乐透前区 χ²=89.1（p<1e-9）实为 **2007–2014 源数据回填缺陷**（分半相关 r=−0.26，2015+ 重测 p=0.89）；七星彩第 7 位「非均匀」是**规则本身**（0–9 各约 9%、10–14 各约 1.8%），拿 df=14 去检验是模型误设。CI 里每月重跑的正是这套证伪流程
- **历史回测**：逐期用「当期之前」的数据预测再与真实开奖比对（杜绝未来函数），600 期跨度自动抽样，全部结论对照**随机基线**
- **显著性检验**：回测与复盘输出二项检验 p 值（正态近似），样本不足如实返回 null。**徽章有样本门槛**：`tested < 100` 时不再显示「有效 / 显著」，改显示「样本不足，无法判断」——「没检出信号」与「没能力检出信号」是两件事
- **一个写进代码的统计陷阱**：号频 χ² 的零分布均值是 **27 而不是 df=32**（每期 6 个号互斥造成负相关）。若按解析 df=32 计算，真实 p=0.021 会被误判成 p=0.069——所以本站零分布一律用蒙特卡洛。这不是双色球专属：通用式是 `池大小 × (1 − 每期开出数 / 池大小)`，快乐8 的零均值是 **60 而不是 df=79**、大乐透前区 30、七乐彩 23；多彩种套件按各自参数现算，绝不复用别人的数
- **外推检验（holdout）**：校准权重只用旧 70% 数据拟合、新 30% 验证——检验「同一段数据既调权又报成绩」的过拟合
- **分年稳定性**：回测按年分桶，策略是长期有效还是最近退化一眼可见（附柱状图）
- **形态转移**：和值 / 奇偶 / 大小 / 012路 一阶转移矩阵（拉普拉斯平滑），下期形态 Top3（`/api/analyze` 的 `shape` 字段，仅号码池型）
- **未解决如实标注**：全量检验中余下一个边界性异常（号频 χ² 偏高、和值偏低，联合校正 p≈0.02），但它局域在 2015–2018 与周四、2019 年后消失，且是在 33 号 × 6 年代 = 198 个格子里事后定位出来的，属**提示性而非发现**；本站可用历史约 650 期，而检出 ±10% 单号偏差需要约 3500 期——**当前样本量不足以支撑任何"某号更热"的结论**

### 🔁 预测复盘闭环

每日同步自动**快照**下一期推荐 → 开奖后自动**对账** → `/api/review` 公开滚动命中率（推荐 / 定胆 / 杀错率 + 显著性）。预测从「说完就忘」变成可回看的记录。

- **数字型彩种已修通**：`fc3d / pl3 / pl5 / qxc` 的推荐项字段是 `digits` 而非 `main`，此前快照丢号、永久无法对账；现按彩种类型分叉，且数字型严格**逐位比对**
- **闭环自己也有停摆保险丝**：`/api/meta` 返回 `predlog[]`（各彩种最新快照 / 最新对账 / 待对账条数），CI 的 `review` job 显式触发对账并对每日彩种断言「快照距今 ≤2 天且已有对账记录」。此前它对 `/api/review` 的断言是 `typeof summary === 'object'`——空对象也算通过，于是闭环死了五天而 CI 全绿

### 🛡️ 数据可靠性

- **多源交叉校验**：双色球（500 + cwl）、大乐透（500 + 17500）最近 30 期逐期比对，不一致的期号**拒绝落库**
- **数据新鲜度保险丝**：D1 最新期距今天数暴露在 `/api/meta`，前端任一彩种 ≥4 天自动亮黄条
- **上游故障降级**：小彩种上游不可用时自动读 D1 缓存，响应标记 `degraded`
- **CI 部署冒烟**：push / 定时同步后自动对线上 5 端点断言，线上异常 CI 直接红

---

## 🎫 支持彩种

| id | 彩种 | 规则 | 开奖 |
|---|---|---|---|
| `ssq` | 双色球 | 红 6/33 + 蓝 1/16 | 周二·四·日 |
| `dlt` | 大乐透 | 前 5/35 + 后 2/12 | 周一·三·六 |
| `fc3d` | 福彩 3D | 3 位 0-9 | 每日 |
| `pl3` | 排列 3 | 3 位 0-9 | 每日 |
| `pl5` | 排列 5 | 5 位 0-9 | 每日 |
| `qlc` | 七乐彩 | 基本 7/30 + 特别号 | 周一·三·五 |
| `qxc` | 七星彩 | 7 位 0-9 | 周二·五 |
| `kl8` | 快乐 8 | 20/80 | 每日 |

## 🛠 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 运行时 | [Cloudflare Workers](https://workers.cloudflare.com/) | 纯 JS，`fetch(request, env, ctx)` 路由，零 npm 依赖 |
| 存储 | [D1](https://developers.cloudflare.com/d1/) | SQLite，6 张表（开奖×3 / 复盘 / 收藏 / 同步日志） |
| 前端 | 原生单页 + [ECharts 5](https://echarts.apache.org/) | `frontend/` 为唯一事实源，构建时内联进 Worker |
| 定时 | GitHub Actions | 免费版 Workers cron 配额已满，改由 Actions 按开奖日触发落库 |
| 测试 | `node --test` | 106 项单元测试（89 worker + 12 统计内核 + 5 推送，零依赖离线可跑，含批量验奖的前后端契约测试）+ 真实数据源连通性测试 |

---

## 🚀 快速开始

### 前置要求

- Node.js ≥ 20（无需 `npm install`——项目零依赖，wrangler 用 `npx` 临时拉起）
- 一个 Cloudflare 账号（免费版即可）

### 1. 建库

```bash
npx wrangler d1 create lottery          # 记下返回的 database_id
npx wrangler d1 execute lottery --file=db/schema.sql
```

### 2. 部署配置

```bash
cp worker/wrangler.toml worker/wrangler.local.toml
# 编辑 worker/wrangler.local.toml：把 database_id 的 REPLACE_ME 换成第 1 步的 ID
# 不需要自定义域名就删掉 routes 整段
```

> `wrangler.local.toml` 含真实 ID，已在 `.gitignore` 中，不会进仓库。

### 3. 部署

```bash
npm --prefix worker run deploy -- --config worker/wrangler.local.toml
# deploy 脚本会自动先构建前端（frontend/ → worker/src/ui.js），无需单独 build
```

部署成功会输出 `https://lottery-web.<你的子域>.workers.dev`。

### 4. （可选）鉴权

```bash
npx wrangler secret put API_TOKEN
```

鉴权模型：**开奖数据是公开信息，读接口一律免鉴权**；只有写操作与个人数据（`/api/favs` 全部方法、`/api/admin/sync`）要求 `Authorization: Bearer <API_TOKEN>`。未设置 `API_TOKEN` 时写接口一律拒绝（fail-closed）。

### 5. （可选）定时落库

`.github/workflows/sync.yml` 在 CI 通过后按开奖日触发落库（双色球 / 大乐透 / 每日小彩种），并在同步后自动预热校准缓存、生成复盘快照。需在仓库 *Settings → Secrets and variables → Actions* 配置：

| Secret | 值 |
|---|---|
| `WORKER_URL` | 如 `https://lottery-web.xxx.workers.dev` |
| `API_TOKEN` | 与 Worker 的 secret 一致（未设置鉴权则无法同步落库） |

### 6. （可选）D1 备份与开奖推送

两个能力都**默认不生效**，不配 secrets 就打印一行「跳过」——fork 本项目不会莫名多出一个红叉或一个乱说话的机器人。

| 能力 | 打开方式 | 文档 |
|---|---|---|
| **D1 每日备份**（`.github/workflows/backup.yml`） | 配 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `D1_DATABASE` | [docs/BACKUP.md](docs/BACKUP.md) |
| **开奖订阅推送**（`sync.yml` 的 `notify` job） | 配 `NOTIFY_WEBHOOK_URL`（+ `NOTIFY_FORMAT` ∈ dingtalk/feishu/slack/telegram/generic） | [docs/NOTIFY.md](docs/NOTIFY.md) |

备份不是「导出来就完事」：workflow 会把 SQL 真还原进一个临时 sqlite 并逐表报行数。推送也不是只报喜：`needs` 里的 job 失败时它照样发，标题变成 ❌——**告警通路在出事时才有价值**。

> 一句风险提示：GitHub **公开仓库**的 Actions 产物不需要登录就能下载。开奖数据是公开的，但 `favs`（你存的自选号）不是。要么配 R2（私有桶），要么设 `BACKUP_INCLUDE_FAVS=0`，要么仓库转私有——详见 docs/BACKUP.md。

## 💻 本地开发

```bash
cd worker
npm run build:ui     # 从 frontend/ 生成 src/ui.js（ui.js 是构建产物，不进仓库）
npm test             # 单元测试（106 项，零依赖，离线可跑）
npm run test:live    # 真实数据源连通性测试（需联网，默认不跑）
npm run dev          # wrangler dev 本地起服务
```

## 📖 使用说明

前端是一个 7 tab 单页（PWA，手机可安装、弱网有 Service Worker 兜底）：

| Tab | 内容 |
|---|---|
| **预测** | 6 套策略推荐 + 杀号 + 定胆 + 胆拖单生成/导出 |
| **今日** | 今日开奖日历、破纪录遗漏预警、上期对账、下期快照 |
| **分析** | 频次/冷热/遗漏/形态转移可视化、遗漏走势图、回测摘要（分年柱图 + 外推检验 + 阈值寻优按钮） |
| **历史** | 最近 30 期开奖 |
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
| `/api/analyze` | `kind=`, `win=` | 频次/冷热/遗漏/奇偶/大小/质合/AC/012路/区间/连号/重号；号码池型附 `shape` 形态转移矩阵 |
| `/api/kill` | `kind=` | 杀号投票（10 类公式加权 + threshold） |
| `/api/dan` | `kind=`, `win=` | 定胆 |
| `/api/backtest` | `kind=`, `periods=1..600` | 历史回测：真实命中率 vs 随机基线 + p 值 + 分年稳定性；>60 期自动抽样（返回 `tested/stride`） |
| `/api/kill-calibrated` | `kind=`, `holdout=0..0.5` | 校准杀号（按分公式回测生成动态权重）；`holdout=0.3` 触发外推检验；结果缓存 6h |
| `/api/kill-tune` | `kind=` | 杀号阈值寻优：5 分位 × 两段 10 次回测，`gap` 判据防调参过拟合；结果缓存 6h |
| `/api/review` | `kind=`（可选） | 预测复盘：滚动命中率 + 二项检验 p 值 + 对账明细 |
| `/api/trend` | `kind=`, `limit=5..60` | 逐期遗漏走势 |
| `/api/ticket` | `kind=`, `dan=`, `tuo=` | 胆拖投注单（ssq/dlt/qlc） |
| `/api/coldness` | `kind=ssq`, `nums=01,05,...`, `blue=09` | 冷门度：估计中奖后**与多少人分奖**（`ratio`<1 有利）。只影响分奖人数，**不改变中奖概率**；仅双色球有拟合系数 |

### 查询与工具

| 路径 | 参数 | 说明 |
|---|---|---|
| `/api/{kind}/latest` / `history?limit=` | — | 最新一期 / 历史 |
| `/api/{kind}/verify` | ssq: `code&red&blue` · dlt: `code&front&back` · 其余: `code&nums` | 验奖 |
| `/api/verify-batch` | **POST** + JSON `{"kind","code"或"codes"[],"tickets"[],"mult"}` | 批量验奖（≤200 注 × ≤10 期）。返回逐注奖级/命中/金额 + 每期汇总；`errors[].line` 是你贴进来的原始行号，`amount: null` 表示**该奖级金额本站未校验**（浮动奖或规则分时代），不是 0 |
| `/api/meta` | — | 彩种元数据 + `stale[]` 数据新鲜度 |
| `/api/records` | — | 破纪录遗漏预警（当前遗漏 vs 样本内历史最大遗漏） |
| `/api/calc` | `kind=` + 复式/胆拖/追号参数 | 注数 / 金额 / 追号计划 |
| `/api/prize` | `kind=` + 命中参数 | 奖级与固定奖金额 |
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
│   ├── index.html          # 单页应用（7 tab + 内联 JS）
│   ├── sw.js               # Service Worker 离线兜底
│   ├── manifest.json       # PWA manifest
│   └── icon.svg
├── worker/
│   ├── src/
│   │   ├── index.js        # 路由 / 三级缓存 / CORS / 鉴权 / 落库调度 / 复盘 job
│   │   ├── predict.js      # 统一预测引擎（8 彩种共用）
│   │   ├── coldness.js     # 冷门度（分奖人数）评分，系数由 scripts/coldness 拟合
│   │   ├── verify-batch.js # 批量验奖：解析贴进来的票 → 复用上面的奖级函数逐注判
│   │   ├── ssq.js          # 双色球取数（500 + cwl + 17500）与验奖
│   │   ├── dlt.js          # 大乐透取数与验奖
│   │   ├── small.js        # 6 小彩种解析 / 奖级 / 旋转矩阵
│   │   ├── calc.js         # 注数 / 金额 / 追号 / 快乐8 奖金表
│   │   ├── db.js           # D1 读写
│   │   ├── net.js          # 带超时的上游 fetch（境内站点不回包时宁可降级，也不能把请求拖到 20–30s）
│   │   └── ui.js           # ⚠️ 构建产物（不进仓库，先 build:ui）
│   ├── test/
│   │   ├── unit.test.mjs   # 基础单元测试
│   │   ├── predict.test.mjs # 预测引擎测试（含 8 彩种一致性）
│   │   ├── coldness.test.mjs # 冷门度：方向 / 单调 / 输入校验 / 免责声明
│   │   ├── review.test.mjs # 复盘 job 端到端（假 D1 按 WHERE 过滤）
│   │   ├── verify-batch.test.mjs # 批量验奖：解析 / 奖级金额 / 位置敏感 / 汇总 + 路由 HTTP 契约
│   │   ├── ui-render.test.mjs # 前后端契约：真跑后端再让前端渲染函数画一遍（字段改名会被抓住）
│   │   ├── net.test.mjs    # 上游超时：用不回包的本地 server 验超时真的生效
│   │   └── live.test.mjs   # 真实数据源连通性（需联网）
│   └── wrangler.toml       # 部署模板（database_id 已脱敏为 REPLACE_ME）
├── scripts/
│   ├── build-ui.mjs        # frontend/ → worker/src/ui.js 打包脚本
│   ├── notify.mjs          # 开奖推送：读 Worker 公开接口 → 按各家格式 POST webhook（默认不发）
│   ├── notify.test.mjs     # 推送测试：payload 形状 + 本地 http server 真发一次
│   ├── randomness/         # 随机性审计：8 彩种取数 + A/B/C/D/E 检验（零依赖，见其 README）
│   └── coldness/           # 冷门度系数拟合 + 样本外验证 + 与线上常量对账
├── db/schema.sql           # D1 建表（6 张：draws / dlt_draws / small_draws / predlog / favs / sync_log）
├── docs/
│   ├── CHANGELOG.md        # 全部版本变更记录
│   ├── PUBLISH.md          # 发布前自检清单
│   ├── BACKUP.md           # D1 备份与恢复（含公开仓库产物泄露风险、恢复姿势）
│   ├── NOTIFY.md           # 开奖订阅推送：五家格式、排错、为什么做在 Actions
│   ├── research.md         # 调研笔记
│   ├── randomness-2026-09.md      # 双色球随机性基线（深检存档）
│   ├── randomness-latest.md       # 双色球本月自动产物
│   ├── randomness-multi-latest.md # 8 彩种扩展审计（自动产物）
│   ├── coldness-latest.md         # 冷门度重拟合与常量对账（自动产物）
│   └── coldness-dlt-2026-09.md    # 大乐透冷门度：一个负结果的留档
└── .github/workflows/
    ├── sync.yml            # CI：测试 → 线上冒烟 → 定时落库 → 复盘对账 →（默认关闭的）开奖推送
    ├── backup.yml          # 每日 D1 导出 + 还原验证 → R2 或 Actions 产物（不配 secrets 就跳过）
    └── randomness.yml      # 每月：8 彩种随机性审计 + 冷门度重验（不需要 secrets）
```

## 🧭 设计原则

1. **统计诚实**：任何「有效」结论必须对照随机基线 + 显著性检验；工具的第一句话可能是「别调」（阈值寻优的实测结论）
2. **杜绝未来函数**：回测只用当期之前的数据
3. **数据宁缺毋滥**：多源不一致的期号拒绝落库，D1 旧值仍是好的
4. **免费版友好**：CPU 10ms 限制下自动抽样、三级缓存（isolate 内存 → edge cache → 现算）、重计算走独立请求
5. **一份事实源**：前端只有 `frontend/` 一份源码，Worker 内联构建产物，杜绝两份 HTML 漂移

## 📜 版本演进

`v0.5` 数据正确性大修 → `v0.6` 统一预测引擎 → `v0.7` 历史回测 → `v0.8` 校准杀号+胆拖单 → `v0.9` 600 期回测+走势图 → `v0.10` 统计诚实性+复盘闭环 → `v0.11` 工程韧性+今日日报 → `v0.12` 结论可证伪化（8 彩种审计 + 冷门度系数可复现 + 复盘闭环修活）→ `v0.13` 自用顺手与可运维（批量验奖 + 前后端契约测试 + 可选 D1 备份 / 开奖推送，默认关闭）

完整变更记录见 **[docs/CHANGELOG.md](docs/CHANGELOG.md)**。

## 📄 声明

- 自研代码以 MIT 许可发布（见 [LICENSE](LICENSE)）
- 开奖数据归属原站（500.com / 中彩联 cwl.gov.cn / 17500），本项目仅做统计与缓存
- 逻辑借鉴（均为自写实现）：sinyu1012/Double-Color-Ball-AI、oahzxd/lottery、BEWINDOWEB/lotterygrabber、longgeyyds/ssq-fusion、Konata/chinese-lottery-predict、zxz0119/lottery-ai-simulator 等 MIT 项目，TheMelody/LotteryTrend（Apache-2.0，保留声明）；完整清单见站内 `/licenses`
- 随机游戏，统计仅供娱乐，不保证中奖
