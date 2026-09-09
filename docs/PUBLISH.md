# PUBLISH · 发布前清单

## 现状：可公开发布

- 仓库已无账号相关信息：`worker/wrangler.toml` 的 `database_id` 为 `REPLACE_ME`
- 真实 D1 ID 只存在于 `worker/wrangler.local.toml`，该文件已在 `.gitignore` 中
- 代码中无任何 Token / Account 字面量（无 `cfut_` 等前缀）

## 发布前自检

```bash
# 1. 确认无敏感文件会被提交
git status --porcelain | grep -E "wrangler.local|dev.vars|credential" # 应无输出

# 2. 单元测试 + 前端构建
npm --prefix worker test
node scripts/build-ui.mjs

# 3. 扫一遍是否出现疑似密钥
grep -rInE "cfut_|CLOUDFLARE_API_TOKEN *[:=] *[\"'][A-Za-z0-9_-]{20,}" . --exclude-dir=node_modules
```

## 自建部署指引（给拿到仓库的人）

见 README「🚀 快速开始」章节，核心三步：

1. `npx wrangler d1 create lottery` 并记下 `database_id`，`npx wrangler d1 execute lottery --file=db/schema.sql` 建表
2. `cp worker/wrangler.toml worker/wrangler.local.toml`，填入 ID
3. `npm --prefix worker run deploy -- --config worker/wrangler.local.toml`（自动先构建前端）

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
| 月度随机性审计 + 冷门度重验（`randomness.yml`） | 无需配置（不打任何私有接口） | — |
| D1 备份（`backup.yml`） | `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `D1_DATABASE`；可选 `vars.R2_BUCKET`、`vars.BACKUP_INCLUDE_FAVS` | 打印「跳过」并绿，不产生红叉 |
| 开奖推送（`sync.yml` 的 `notify`） | `secrets.NOTIFY_WEBHOOK_URL`（+ `vars.NOTIFY_FORMAT` / `secrets.NOTIFY_CHAT_ID`） | 打印「推送保持关闭」并退出 |

详见 [BACKUP.md](BACKUP.md) 与 [NOTIFY.md](NOTIFY.md)。

## 已知坑：`wrangler.toml` 里带着作者的域名

仓库模板 `worker/wrangler.toml` 顶部有一段：

```toml
routes = [
  { pattern = "cp.leilaomi.cc.cd/*", zone_name = "leilaomi.cc.cd" }
]
```

这是作者自用的自定义域名。**fork 的人不持有这个 zone，`wrangler deploy` 会在这里失败**——整段删掉，或换成你自己的域名（需该域名已作为 zone 接入你的 Cloudflare 账号）。

作者没有把它默认注释掉，是因为 routes 是**同步语义**：删掉后再部署会真的把线上域名解绑，那是站点所有者需要确认的变更，而不是一个适合顺手改掉的默认值。

## 不发什么

- 不发任何 Token / Account ID
- 不收录第三方源码：逻辑为自研实现，参考过的项目已在 `/licenses` 声明
