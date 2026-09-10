# PUBLISH · 发布前清单

## 现状：可公开发布

- 仓库已无账号相关信息：`worker/wrangler.toml` 的 `database_id` 为 `REPLACE_ME`
- 真实 D1 ID 只存在于 `worker/wrangler.local.toml`，该文件已在 `.gitignore` 中
- 代码中无任何 Token / Account 字面量（无 `cfut_` 等前缀）
- 源码与 workflow 里不写死任何人的站点地址：随机性审计的交叉校验目标由 `--api-base` /
  `LOTTERY_API_BASE`（本地）或 `vars.PUBLIC_API_BASE`（CI）提供
- 内部工作记录（`progress.md`、`docs/continue-*.md`）不进仓库——它们会写到本机路径与自建域名，已在 `.gitignore` 中列出

## 发布前自检

```bash
# 1. 确认无敏感文件会被提交
git status --porcelain | grep -E "wrangler.local|dev.vars|credential" # 应无输出

# 2. 单元测试 + 前端构建
cd worker && npm test && npm run build:ui && cd ..

# 3. 扫一遍是否出现疑似密钥
grep -rInE "cfut_|CLOUDFLARE_API_TOKEN *[:=] *[\"'][A-Za-z0-9_-]{20,}" . --exclude-dir=node_modules

# 4. 扫一遍是否混进只对本机/本账号有意义的信息：绝对路径、本地代理端口、自建域名、邮箱
#    （命中就先确认是不是该删；测试里连 127.0.0.1 的临时 server 属正常）
grep -rInE "[A-Za-z]:[\\\\/]Users/|/home/[a-z]{3,}|127\.0\.0\.1:[0-9]{4,}|@users\.noreply|\.workers\.dev" \
  --exclude-dir=node_modules --exclude-dir=.git . 
```

## 自建部署指引（给拿到仓库的人）

见 README「🚀 快速开始」章节，核心三步：

1. `npx wrangler d1 create lottery` 并记下 `database_id`，再 `npx wrangler d1 execute lottery --remote --file=db/schema.sql -y` 建表
   （**`--remote` 不能省**：实测不加时 wrangler 输出 `Resource location: local`，表只建在你本机的 miniflare 里，部署后的站点照样没有表）
2. `cp worker/wrangler.toml worker/wrangler.local.toml`，填入 ID（要绑自定义域名就顺手取消 `routes` 的注释——模板默认不带）
3. 部署（在 `worker/` 目录内执行，`--config` 用相对路径）：

```bash
cd worker
npm run build:ui
npx wrangler deploy --config wrangler.local.toml
```

## 前端单独发布（可选）

`frontend/` 是纯静态目录，可直接发 Cloudflare Pages 或 Vercel：

- Pages：构建命令留空，输出目录 `frontend`
- 发布后需在页面顶部「Worker 地址」填入 Worker 域名（会存 localStorage）
- `frontend/vercel.json` 已带基础安全响应头

若由 Worker 提供页面（默认），不需要单独发布，Worker 已内联构建产物。

## CI 能力与所需配置（一张表看全）

| 能力 | 开关 | 不配会怎样 |
|---|---|---|
| 单元测试 + 统计内核 + 前后端契约 | 无需配置 | — |
| 定时落库 / 复盘对账（`sync.yml` 的 `sync` / `review`） | `secrets.WORKER_URL` + `secrets.API_TOKEN` | job **直接失败**——这两项是站点主链路，静默跳过会重演「闭环死了五天而 CI 全绿」 |
| 线上冒烟（`smoke`） | `secrets.WORKER_URL` | 警告并跳过 |
| 月度随机性审计 + 冷门度重验（`randomness.yml`） | 无需 secrets；号码交叉校验需 `vars.PUBLIC_API_BASE`（指向某个已部署实例的公共接口，普通变量非密钥） | 审计照跑，但 7 彩种的号码交叉校验被显式跳过 → VERIFIED 闸门如实失败 |
| D1 备份（`backup.yml`） | `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `D1_DATABASE`；可选 `vars.R2_BUCKET`、`vars.BACKUP_INCLUDE_FAVS=1`（默认**不含**个人收藏表） | 打印「跳过」并绿，不产生红叉 |
| 开奖推送（`sync.yml` 的 `notify`） | `secrets.NOTIFY_WEBHOOK_URL`（+ `vars.NOTIFY_FORMAT` / `secrets.NOTIFY_CHAT_ID`） | 打印「推送保持关闭」并退出 |

详见 [BACKUP.md](BACKUP.md) 与 [NOTIFY.md](NOTIFY.md)。

## 自定义域名（routes）

模板 `worker/wrangler.toml` **默认不带 `routes`**，只留一段注释掉的示例。这是刻意的：

- `routes` 是**同步语义** —— `wrangler deploy` 会把配置里没有的 route 从 Worker 上解绑；
- 模板里若写死某个人的 zone，fork 的人不持有它，部署时会直接失败。

要绑定自己的域名：取消 `wrangler.toml`（或你自己的 `wrangler.local.toml`）里那段 `routes` 的注释，换成你的域名，且该域名需已作为 zone 接入你的 Cloudflare 账号。

自己的部署建议走 gitignore 的 `worker/wrangler.local.toml`，那份里**可以保留** route —— 所以「模板不含 route」不会让已经绑好的自定义域名掉绑定。部署命令（在 `worker/` 目录内执行）：

```bash
cd worker
npm run build:ui                                    # 先构建前端产物
npx wrangler deploy --config wrangler.local.toml    # 用自己的 D1 ID 与 route
```

⚠️ 别用不带 `--config` 的 `npm run deploy` 部署自己的站点：那读的是模板，`database_id` 还是 `REPLACE_ME`、也没有 route。

## 不发什么

- 不发任何 Token / Account ID
- 不收录第三方源码：逻辑为自研实现，参考过的项目已在 `/licenses` 声明
