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

## 不发什么

- 不发任何 Token / Account ID
- 不收录第三方源码：逻辑为自研实现，参考过的项目已在 `/licenses` 声明
