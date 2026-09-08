<div align="center">

# 🎱 lottery-web · 自用彩票分析站

**8 个彩种 · 统一预测引擎 · 统计诚实性优先**

[![CI](https://github.com/LeilaoMi/lottery-web/actions/workflows/sync.yml/badge.svg)](https://github.com/LeilaoMi/lottery-web/actions/workflows/sync.yml)
![version](https://img.shields.io/badge/version-0.11.0-blue)
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
- **杀号**：10 类公式加权投票（票数 + 命中原因），支持按分公式回测结果自动校准权重；`/api/kill-tune` 可检验「杀票数前 30%」这一默认阈值是否真的最优
- **定胆**：频率 + 遗漏回归 + 邻号 + 重号
- **胆拖投注单**：一键生成注数金额，可保存收藏 / 复制 / 导出 TXT

### 📊 统计诚实性（本项目的灵魂）

- **历史回测**：逐期用「当期之前」的数据预测再与真实开奖比对（杜绝未来函数），600 期跨度自动抽样，全部结论对照**随机基线**
- **显著性检验**：回测与复盘输出二项检验 p 值（正态近似），样本不足如实返回 null——杜绝把噪音当规律
- **外推检验（holdout）**：校准权重只用旧 70% 数据拟合、新 30% 验证——检验「同一段数据既调权又报成绩」的过拟合
- **分年稳定性**：回测按年分桶，策略是长期有效还是最近退化一眼可见（附柱状图）
- **形态转移**：和值 / 奇偶 / 大小 / 012路 一阶转移矩阵（拉普拉斯平滑），下期形态 Top3

### 🔁 预测复盘闭环

每日同步自动**快照**下一期推荐 → 开奖后自动**对账** → `/api/review` 公开滚动命中率（推荐 / 定胆 / 杀错率 + 显著性）。预测从「说完就忘」变成可回看的记录。

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
| 测试 | `node --test` | 60 项单元测试（零依赖离线可跑）+ 真实数据源连通性测试 |

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

## 💻 本地开发

```bash
cd worker
npm run build:ui     # 从 frontend/ 生成 src/ui.js（ui.js 是构建产物，不进仓库）
npm test             # 单元测试（60 项，零依赖，离线可跑）
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
| **验奖·矩阵** | 按期号验奖、旋转矩阵（覆盖设计） |
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

### 查询与工具

| 路径 | 参数 | 说明 |
|---|---|---|
| `/api/{kind}/latest` / `history?limit=` | — | 最新一期 / 历史 |
| `/api/{kind}/verify` | ssq: `code&red&blue` · dlt: `code&front&back` · 其余: `code&nums` | 验奖 |
| `/api/meta` | — | 彩种元数据 + `stale[]` 数据新鲜度 |
| `/api/records` | — | 破纪录遗漏预警（当前遗漏 vs 样本内历史最大遗漏） |
| `/api/calc` | `kind=` + 复式/胆拖/追号参数 | 注数 / 金额 / 追号计划 |
| `/api/prize` | `kind=` + 命中参数 | 奖级与固定奖金额 |
| `/api/rotation` | `n=&pick=&hit=` | 旋转矩阵（覆盖设计，注数约理论下界 1.5 倍） |
| `/api/favs` | GET/POST/DELETE | 收藏（需鉴权） |
| `/api/admin/sync` | POST | 触发 8 彩种落库（需鉴权），响应含各彩种 `crosscheck` 报告 |
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
│   │   ├── ssq.js          # 双色球取数（500 + cwl + 17500）与验奖
│   │   ├── dlt.js          # 大乐透取数与验奖
│   │   ├── small.js        # 6 小彩种解析 / 奖级 / 旋转矩阵
│   │   ├── calc.js         # 注数 / 金额 / 追号 / 快乐8 奖金表
│   │   ├── db.js           # D1 读写
│   │   └── ui.js           # ⚠️ 构建产物（不进仓库，先 build:ui）
│   ├── test/
│   │   ├── unit.test.mjs   # 基础单元测试
│   │   ├── predict.test.mjs # 预测引擎测试（含 8 彩种一致性）
│   │   └── live.test.mjs   # 真实数据源连通性（需联网）
│   └── wrangler.toml       # 部署模板（database_id 已脱敏为 REPLACE_ME）
├── scripts/build-ui.mjs    # frontend/ → worker/src/ui.js 打包脚本
├── db/schema.sql           # D1 建表（6 张：draws / dlt_draws / small_draws / predlog / favs / sync_log）
├── docs/
│   ├── CHANGELOG.md        # 全部版本变更记录
│   ├── PUBLISH.md          # 发布前自检清单
│   └── research.md         # 调研笔记
└── .github/workflows/sync.yml   # CI：测试 → 线上冒烟 → 定时落库
```

## 🧭 设计原则

1. **统计诚实**：任何「有效」结论必须对照随机基线 + 显著性检验；工具的第一句话可能是「别调」（阈值寻优的实测结论）
2. **杜绝未来函数**：回测只用当期之前的数据
3. **数据宁缺毋滥**：多源不一致的期号拒绝落库，D1 旧值仍是好的
4. **免费版友好**：CPU 10ms 限制下自动抽样、三级缓存（isolate 内存 → edge cache → 现算）、重计算走独立请求
5. **一份事实源**：前端只有 `frontend/` 一份源码，Worker 内联构建产物，杜绝两份 HTML 漂移

## 📜 版本演进

`v0.5` 数据正确性大修 → `v0.6` 统一预测引擎 → `v0.7` 历史回测 → `v0.8` 校准杀号+胆拖单 → `v0.9` 600 期回测+走势图 → `v0.10` 统计诚实性+复盘闭环 → `v0.11` 工程韧性+今日日报

完整变更记录见 **[docs/CHANGELOG.md](docs/CHANGELOG.md)**。

## 📄 声明

- 自研代码以 MIT 许可发布（见 [LICENSE](LICENSE)）
- 开奖数据归属原站（500.com / 中彩联 cwl.gov.cn / 17500），本项目仅做统计与缓存
- 逻辑借鉴（均为自写实现）：sinyu1012/Double-Color-Ball-AI、oahzxd/lottery、BEWINDOWEB/lotterygrabber、longgeyyds/ssq-fusion、Konata/chinese-lottery-predict、zxz0119/lottery-ai-simulator 等 MIT 项目，TheMelody/LotteryTrend（Apache-2.0，保留声明）；完整清单见站内 `/licenses`
- 随机游戏，统计仅供娱乐，不保证中奖
