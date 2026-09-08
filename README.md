# lottery-web · 自用彩票网页端 v0.9.0

8 个彩种的开奖查询 / 统计 / 杀号定胆 / 预测 / 验奖 / 注数与中奖计算。Cloudflare Worker + D1，零运行时依赖，单文件前端。

**8 个彩种共用同一套预测引擎**（`worker/src/predict.js`），接口返回结构完全一致，不存在「双色球有推荐、其他彩种只有统计」的割裂。

> 随机游戏，统计仅供娱乐，不保证中奖。

## 支持彩种

| id | 彩种 | 规则 | 开奖 |
|---|---|---|---|
| `ssq` | 双色球 | 红 6/33 + 蓝 1/16 | 二四日 |
| `dlt` | 大乐透 | 前 5/35 + 后 2/12 | 一三六 |
| `fc3d` | 福彩 3D | 3 位 0-9 | 每日 |
| `pl3` | 排列 3 | 3 位 0-9 | 每日 |
| `pl5` | 排列 5 | 5 位 0-9 | 每日 |
| `qlc` | 七乐彩 | 基本 7/30 + 特别号 | 一三五 |
| `qxc` | 七星彩 | 7 位 0-9 | 二五 |
| `kl8` | 快乐 8 | 20/80 | 每日 |

## 数据源

| 彩种 | 主源 | 备源 |
|---|---|---|
| 双色球 | 500.com、中彩联 cwl.gov.cn（双源交叉比对） | 17500 |
| 大乐透 | 500.com | 17500 |
| 其余 6 种 | 17500 文本源 | — |

双色球拉取时并行请求 500 与 cwl，比对最新一期期号与号码后给出 `consistent` 标记。

## 接口

所有响应均为 JSON，带 `Access-Control-Allow-Origin: *`，支持 `OPTIONS` 预检。

### 通用

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{status,version,lotteries}` |
| GET | `/api/meta` | 彩种列表与数据源 |
| GET | `/` | 单页前端（由 `frontend/` 构建内联） |
| GET | `/manifest.json` `/sw.js` `/icon.svg` | PWA 资源 |
| GET | `/licenses` | 第三方思路声明 |
| GET | `/api/rotation?n=12&pick=6&hit=4` | 旋转矩阵（覆盖设计） |
| GET/POST/DELETE | `/api/favs` | 收藏（需 D1，读写均需鉴权） |
| POST | `/api/admin/sync` | 触发 8 彩种落库（需鉴权） |

### 统一预测（8 彩种口径一致）

`kind` = `ssq` / `dlt` / `qlc` / `kl8` / `fc3d` / `pl3` / `pl5` / `qxc`，也可写成 `/api/{kind}/{analyze|kill|dan|predict}`。

| 路径 | 参数 | 说明 |
|---|---|---|
| `/api/predict` | `kind=`, `win=5..100`, `n=` | 6 套策略推荐 + 杀号 + 定胆 + 分析，一次返回 |
| `/api/backtest` | `kind=`, `periods=1..600`, `win=`, `warmup=` | 历史回测：各策略/杀号的真实命中率 vs 随机基线；跨度 >60 期自动抽样（免费版 CPU 限制），返回 `tested/stride` |
| `/api/kill-calibrated` | `kind=`, `periods=` | 校准杀号：按分公式回测命中率生成动态权重后重新投票；结果进边缘缓存 6h，`/api/admin/sync` 完成后自动预热 |
| `/api/ticket` | `kind=`, `dan=`, `tuo=` | 胆拖投注单（ssq/dlt/qlc）：胆拖号码 + 注数金额；前端支持保存到收藏 / 复制 / 导出 TXT |
| `/api/trend` | `kind=`, `limit=5..60` | 逐期遗漏走势（统一引擎，号码池型通用；前端 ECharts 折线渲染） |
| `/api/analyze` | `kind=`, `win=` | 频次 / 冷热 / 遗漏 / 奇偶 / 大小 / 质合 / AC / 012 路 / 区间 / 连号 / 重号 |
| `/api/kill` | `kind=` | 杀号投票（10 类公式加权） |
| `/api/dan` | `kind=`, `win=` | 定胆（频率 + 遗漏回归 + 邻号 + 重号） |
| `/api/specs` | — | 各彩种号码池与默认推荐个数 |

返回结构（号码池型 / 数字型同构）：

```jsonc
{
  "kind": "ssq", "type": "pool", "window": 30, "count": 30,
  "analysis": { "hot": [], "cold": [], "freq": {}, "omission": {"cur":{}, "avg":{}, "max":{}}, ... },
  "kill":   { "main": [{"n":"27","votes":4,"reasons":["上期出号","跨度26"]}], "aux": [...] },
  "dan":    { "main": [{"n":"05","score":3.4,"freq":21,"cur":2,"avg":1.8}], "aux": [...] },
  "picks":  [ { "name":"稳健·热号", "main":["01",...], "aux":["14"], "score":9, "note":"..." } ]
}
```

数字型（`fc3d`/`pl3`/`pl5`/`qxc`）把 `main` 换成按位的 `digits`，`analysis` 含 `perPos[].freq/omission/hot/cold`，并额外给出近 N 期组三 / 组六 / 豹子形态。

**杀号公式**（加权投票，票数越高越该杀）：上期出号、邻号 ±1、和值尾、跨度 ±1、极号 ±1、热尾、冷 012 路、质合偏态、热区、上上期号。`/api/kill` 同时给出 `threshold`，「杀号缩水」策略剔除票数 ≥ 阈值的号码。

### 计算器

| 路径 | 参数 | 说明 |
|---|---|---|
| `/api/calc` | `kind=`, 复式/胆拖参数, `chase=`, `mults=` | 注数 / 金额 / 追号计划（每注 2 元） |
| `/api/prize` | `kind=`, 命中参数 | 奖级与固定奖金额 |

- 双色球 `red`/`blue` 复式，`dan`/`tuo` 胆拖；大乐透 `front`/`back` 或 `fdan`/`ftuo`/`bdan`/`btuo`
- 七乐彩 `main` 或 `dan`/`tuo`；快乐 8 `pick`（选几）+ `nums`（选号个数）
- 数字型 `pos=2,3,4`（各位可选个数）、`group=3|6` 组选
- 追号：`chase=3&mults=1,2,4` 返回逐期注数金额与合计
- 中奖：快乐 8 按官方奖金表（选十中 10 ≤500 万 / 中 9 = 8000 / 中 8 = 720 / 中 0 = 2），3D 与排列 3 判直选 1040 / 组三 346 / 组六 173

### 双色球 `/api/ssq/*`

| 路径 | 参数 | 说明 |
|---|---|---|
| `latest` | — | 最新一期，含 `sources` / `consistent` |
| `history` | `limit=1..200` | 历史（新→旧） |
| `trend` | `win=5..100` | 逐期遗漏表 |
| `analyze` | `win=5..100` | 频次 / 冷热 / 奇偶 / 质合 / AC / 012 路 / 连号 / 重号 / 遗漏 |
| `recommend` | — | 6 组参考（含结构分） |
| `verify` | `code=&red=&blue=` | 验奖，返回 `hitRed` / `hitBlue` / `prize` |

### 大乐透 `/api/dlt/*`

`latest` / `history?limit=` / `analyze?win=` / `verify?code=&front=&back=`

### 小彩种 `/api/{fc3d|pl3|pl5|qlc|qxc|kl8}/*`

| 路径 | 参数 | 说明 |
|---|---|---|
| `latest` | — | 最新一期 |
| `history` | `limit=1..100` | 历史 |
| `analyze` | `win=5..100` | 与双色球同口径的统计（数字型按位输出） |
| `predict` | `win=`, `n=` | 与双色球同口径的 6 套策略 + 杀号 + 定胆 |
| `kill` / `dan` | `win=` | 杀号 / 定胆 |
| `verify` | `code=&nums=` | 验奖（七乐彩含 `prize`，快乐 8 返回命中个数） |

小彩种在上游不可用时会自动降级读 D1 缓存，响应中标记 `degraded: true`。

### 旋转矩阵

`GET /api/rotation?n=12&pick=6&hit=4`

返回覆盖设计 `C(n, pick, hit)`：从 n 个自选号中每注选 pick 个，**保证**若开奖号命中自选号中任意 hit 个，至少有一注同时包含这 hit 个号。

实测（贪心构造，非最优但保证覆盖）：

| n / pick / 保中 | 注数 | 理论下界 |
|---|---|---|
| 8 / 6 / 3 | 4 | 3 |
| 10 / 6 / 3 | 10 | 6 |
| 12 / 6 / 4 | 53 | 33 |
| 14 / 6 / 4 | 107 | 67 |
| 16 / 6 / 4 | 192 | 122 |

组合规模过大（t 子集数 > 60000）时返回 `error` 而非空转；候选过多时改用随机采样，并在 `note` 与 `guaranteed=false` 中如实标注**未达 100% 覆盖**。缩水只降低投注成本，不提高中奖概率。

## 部署

```bash
# 1. 建库
npx wrangler d1 create lottery
npx wrangler d1 execute lottery --file=db/schema.sql

# 2. 本地部署配置（含真实 database_id，已在 .gitignore 中）
cp worker/wrangler.toml worker/wrangler.local.toml
#    编辑 wrangler.local.toml 填入 database_id

# 3. 可选：设置鉴权 Token
npx wrangler secret put API_TOKEN    # 不设置则接口完全公开
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID

# 4. 部署（deploy 脚本会自动先构建前端，无需单独执行 build:ui）
npm --prefix worker run deploy -- --config worker/wrangler.local.toml
```

> `worker/src/ui.js` 是构建产物，已在 `.gitignore` 中。克隆后必须先构建再部署，
> 直接 `wrangler deploy` 会因缺少 `ui.js` 而失败——请始终用 `npm run deploy`。

鉴权模型：**开奖数据是公开信息，读接口一律免鉴权**；只有写操作与个人数据（`/api/favs` 的全部方法、`/api/admin/sync`）要求 `Authorization: Bearer <API_TOKEN>`。未设置 `API_TOKEN` 时写接口一律拒绝（fail-closed），不会「忘了配就裸奔」。

### 定时落库

`.github/workflows/sync.yml` 在 CI 通过后按开奖日触发 `/api/admin/sync`，把 8 个彩种写入 D1。需在仓库 Settings → Secrets 配置：

- `WORKER_URL`：如 `https://lottery-web.xxx.workers.dev`
- `API_TOKEN`：与 Worker 的 secret 一致

## 本地开发

```bash
cd worker
npm run build:ui     # 从 frontend/ 生成 src/ui.js
npm test             # 单元测试（零依赖，离线可跑）
npm run test:live    # 真实数据源连通性测试（需联网）
npm run dev          # wrangler dev
```

## 结构

```
worker/src/index.js   路由 / 缓存 / CORS / 鉴权 / 落库调度
worker/src/predict.js 统一预测引擎：8 彩种共用的分析 / 杀号 / 定胆 / 推荐 / 结构打分
worker/src/calc.js    注数 / 金额 / 追号计算，快乐8 奖金表，3D 直选组三组六判定
worker/src/ssq.js     双色球：500 + cwl + 17500、校验、趋势、验奖
worker/src/dlt.js     大乐透：500 + 17500、验奖
worker/src/small.js   6 小彩种解析、奖级规则、旋转矩阵（覆盖设计）
worker/src/db.js      D1 读写（draws / dlt_draws / small_draws / favs / sync_log）
worker/src/ui.js      构建产物，由 scripts/build-ui.mjs 从 frontend/ 生成
worker/test/          单元测试 + 真实数据源测试
frontend/             前端唯一事实源（index.html / sw.js / manifest.json / icon.svg）
db/schema.sql         D1 建表
scripts/build-ui.mjs  前端打包进 Worker
```

**前端只有 `frontend/` 一份源码**，Worker 通过构建脚本内联，避免两份 HTML 长期漂移。

## v0.9.0 变更

新增：

- **回测拉到 600 期跨度**：`/api/backtest?periods=≤600`，深度取数 `drawsDeep`（17500 全量 650 期，双色球/大乐透/小彩种全覆盖）。免费版 Workers 单请求 CPU 限 10ms，跨度 >60 期自动按步长抽样（实测点数封顶 ≈60），返回 `tested/stride`，前端标注「近 600 期跨度 · 抽样 60 点 · 步长 10」。杀号回测的历史统计窗口封顶 100 期，保证 CPU 有界
- **遗漏走势图**：统一入口 `/api/trend?kind=`（号码池型通用，含双色球/大乐透），前端 ECharts 折线渲染，默认画当前遗漏最深 4 个号，可自选号码（≤8 个），带缩放条
- **胆拖单一键保存/导出**：生成胆拖单后可直接「保存到收藏」（写入 D1）/「复制文本」/「导出 TXT」
- **同步后自动预热校准缓存**：`/api/kill-calibrated` 结果真正进入边缘缓存（`caches.default`，TTL 6h，命中直接返回）；`/api/admin/sync` 完成后自 fetch 8 个彩种的校准端点（各自独立请求，CPU 预算独立），GitHub Actions 每日同步即完成预热
- `freqStats` 当前遗漏改为由 `lastSeen` O(1) 推导（语义等价），消除 O(pool×draws) 次重复取号——全部统计接口受益

修正：

- 多处并行编辑同文件导致改动丢失（开发过程问题，逐处复验落盘后修复）

## v0.8.0 变更

新增：

- **校准杀号 `/api/kill-calibrated`**：10 类杀号公式带稳定 key，回测逐公式统计真实命中率（如双色球实测：邻号 15.3%、和值尾 12.8% 低于基线有效；上期出号 19.4% 无信息），据此生成 [0.2, 2] 动态权重——无效公式自动降权，投票重新计算。前端杀号区默认展示校准版
- **胆拖投注单 `/api/ticket`**（ssq/dlt/qlc）：胆 = 校准评分最高 D 个（剔除杀号），拖 = 次高 T 个，副区取胆码前 pick 个，直接输出注数与金额——打通「预测 → 可购买清单」链路。前端预测页一键生成。快乐8/数字型明确拒绝并给替代玩法指引
- **蓝球/后区转移矩阵**：`analyze` 输出 `auxTransition`（上期副区号 → 下期副区号的历史转移频次 Top6；七乐彩同池跳过；上期号无样本时退回全窗口高频转移并标注）
- **推荐带形态指标**：`picks[]` 新增 `sum`（和值）/ `span`（跨度）；`predict?filter=1` 开启形态过滤（和值落理想区 ±1.3tol、跨度在区间 50%~98%，最多重抽 12 次）
- **小彩种遗漏走势** `/api/{qlc|kl8}/trend`：逐期各号当期遗漏（旧→新）
- 测试增至 53 项

修正（均为本轮自测发现）：

- 回测校准后 reasons 仍计入零权重公式——改为只列实际计票的公式
- 胆拖单缺省拖数被参数钳位成 1——显式传参才生效
- 转移矩阵变量遮蔽（转移字典 `tc` 被期数常量 `cnt` 遮蔽）导致恒为空——修正并加非空断言

## v0.7.0 变更

新增：

- **历史回测引擎 `/api/backtest`**：逐期用「当期之前」的数据生成预测再与真实开奖比对（杜绝未来函数），输出热号/冷号/胆码/杀号的真实命中率与随机基线对照，并给出「有效 / 无信息」结论。前端分析页直接展示回测摘要与当前遗漏 Top10
- 小彩种样本从 60 期扩到 150 期，遗漏（当前/均值/最大）统计更有意义
- 测试增至 46 项（新增回测结构/取值范围与「恒定开奖 100% 命中」确定性校验）

回测的真实结论（2026-09-08 实测，随数据滚动变化）：

- 双色球：热号策略单号命中 21.7% > 基线 18.2%（有微弱信息）；杀号 20.2% ≥ 基线，如实标注「无信息」
- 快乐8：杀号 22.4% < 基线 25%；七星彩：首位杀号 7.6% < 基线 10%
- 结论会随开奖滚动，接口里没有任何写死的「必中」话术

## v0.6.0 变更

新增：

- **统一预测引擎 `worker/src/predict.js`**：8 个彩种共用同一套分析 / 杀号 / 定胆 / 推荐逻辑，返回结构完全一致。此前只有双色球有推荐、大乐透只有简单统计、其余 6 种完全没有分析与预测
- **杀号**（10 类公式加权投票，给出票数与命中原因）、**定胆**（频率 + 遗漏回归 + 邻号 + 重号）
- **6 套策略**对每个彩种统一输出：稳健·热号 / 进取·遗漏 / 均衡 / 区间覆盖 / 杀号缩水 / 随机基准，均带结构分（和值 / 奇偶 / 大小 / 区间 / 跨度 / AC）
- **注数与金额计算器** `/api/calc`：复式、胆拖、追号计划（倍数序列逐期金额）
- **中奖计算器** `/api/prize`：快乐 8 官方奖金表（选一~选十）、3D / 排列 3 直选 1040 / 组三 346 / 组六 173
- 数字型彩种按位分析（`perPos`），含近 N 期组三 / 组六 / 豹子形态统计
- 前端新增「工具」页（注数 / 追号 / 中奖计算），杀号与定胆直接在预测页展示
- 44 个单元测试（新增 10 个覆盖预测引擎的 8 彩种一致性与边界）

修正：

- 快乐 8 结构分误用「开奖 20 个号」作基准，选 8~10 个号时分数恒偏低——改为按实际选号个数评估
- 七乐彩特别号可能与基本号重复（两者同池）——副区候选现在排除主区已选号
- 推荐抽样「先切 N 个再去重」，候选池含重复项时会返回不足 N 个号

## v0.5.0 变更

修复：

- 双色球 17500 备用源漏掉日期列，红球/蓝球整体错位一列，且从文件头取数拿到 2003 年数据——**双源都失败时会静默返回 2003 年开奖号**
- 期号格式不统一（500 为 5 位 `26103`，cwl/17500 为 7 位 `2026103`），导致双源一致性永远为 false、按期号验奖命中不到
- 验奖未归一化号码，输入 `1` 匹配不到 `01`
- 缺少 CORS `OPTIONS` 预检，跨域调用 `/api/favs` 的 POST/DELETE 必然失败
- 大乐透奖级错误（如 `4+2` 被判为三等，实际为四等）
- 旋转矩阵的 `minHit` 参数从未参与计算，无任何覆盖保证
- 蓝球评分中两个维度是写死的 `1.0` 占位值

新增：

- 旋转矩阵改为真正的覆盖设计贪心构造，并自带覆盖校验
- 大乐透 / 小彩种落库（`dlt_draws` / `small_draws` 此前建表但无代码写入）
- 小彩种验奖接口、上游故障自动降级读 D1
- 统计维度：AC 值、012 路、质合比、尾数、连号、重号、遗漏（当前/均值/最大）
- 七乐彩奖级、快乐 8 命中统计
- 34 个单元测试 + 12 个真实数据源测试，含双源交叉验证
- 前端重写为 8 彩种全功能版，含 PWA 与 Service Worker 离线兜底
- GitHub Actions：单元测试 + 真实落库（此前只 curl 看一眼）

## 声明

自研代码 MIT。数据归属原站（500 / cwl / 17500）。详见 `/licenses` 与 `LICENSE`。
