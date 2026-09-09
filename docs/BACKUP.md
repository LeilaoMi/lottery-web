# D1 备份与恢复（可选，`.github/workflows/backup.yml`）

**结论先行**：不配 secrets 时这个 workflow 直接跳过并打印原因，fork 本项目不会莫名多一个红叉。配好后每天 UTC 16:00（北京 00:00）导出一份整库 SQL，**并且真的还原一次验证可用**——没验证过的备份等于没有备份。

## 开启方式

Settings → Secrets and variables → Actions：

| 名称 | 类型 | 说明 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | 导出只需读，但**作者是用可编辑 Token 跑通的，没单独验证只读 Token 是否足够**。建议先按最小权限建一张试，报错再放宽 |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare 账号 ID |
| `D1_DATABASE` | Secret | D1 库名（`wrangler.toml` 里 `d1_databases` 的 `database_name`，例如 `lottery`） |
| `R2_BUCKET` | Variable | 可选。设了就推到私有 R2（`d1-backup/backup-<时间戳>.sql`），此时**不再**上传 Actions 产物 |
| `BACKUP_INCLUDE_FAVS` | Variable | 可选。**设 `1` 才会**把个人收藏表 `favs` 一起备份，默认不含 |

也可手动 `workflow_dispatch` 触发，运行表单里能临时选是否包含 `favs`。

## 产物放在哪儿，以及为什么默认不含 favs

本仓库实测是 **PUBLIC**（`gh repo view --json visibility` → `PUBLIC`），而 GitHub 公开仓库的 Actions 产物**不需要登录就能下载**（保留 90 天）。开奖数据本身是公开信息，`favs`（你存的自选号与备注）不是——所以默认值取保守的一边：**备份不含 `favs`，并且这件事会写在 Job Summary 里**（剔除不能是个安静的决定）。

想要完整备份，两条正路：

1. **配 `vars.R2_BUCKET`** —— 文件进你的私有 R2，只有拿得到 Token 的人能取；此时不再上传 Actions 产物。推荐长期这样跑。
2. **设 `vars.BACKUP_INCLUDE_FAVS=1`** —— 明确接受「产物可被任何人下载」，或先把仓库转私有。

## 日志里那条预签名链接（已处理，但要知道为什么）

`wrangler d1 export` 除了写文件，还会往 stdout 打一条**预签名 R2 下载链接**，里面含 `X-Amz-Credential` 与 `X-Amz-Signature`，**一小时内任何拿到它的人都能直接下载你的整库**。Actions 日志在公开仓库里是任何人可读的，所以 workflow 把 wrangler 的输出重定向到文件、过滤掉 `r2.cloudflarestorage.com` 那一行再打印。

> 别在别处（终端录屏、issue 粘贴、CI 日志）把这条链接原样发出去。

## 备份里有什么：一次真实导出的读数

**本机手动导出**：`wrangler d1 export lottery --remote` → 173 KB / 1007 条 `INSERT`，还原到内存 sqlite 后 `small_draws 729 / draws 120 / dlt_draws 120 / predlog 12 / sync_log 23 / favs 0`（合计 1004）。

**CI 首跑**（`workflow_dispatch`，job success）：`backup-20260909-2228.sql` **1053 行 / 172K** → 还原后 `draws 120 / sync_log 25 / dlt_draws 120 / small_draws 729 / favs 0 / predlog 12`，**总计 1006 行**。（`sync_log` 从 23 涨到 25 是两次运行之间又同步过一轮，不是对不上。）

workflow 的「还原验证」步骤会把这些数字打印进 Job Summary；全为 0 时给 `::warning::`（新部署的库确实可能还没落库），但**还原本身失败一定让 job 变红**。

首跑还顺带暴露三件事，都已处理：

- wrangler 弹了确认「此过程可能让你的 D1 暂时无法服务查询，Ok to proceed?」，CI 里靠 `Using fallback value in non-interactive context: yes` 过关。**依赖兜底不如显式传参**（尤其这是个会影响生产的确认），命令现在带 `-y`。
- 日志里会出现 wrangler 自己打印的 **D1 数据库 UUID**（`Executing on remote database lottery (<uuid>)`）。UUID 不是凭证（没有 Token 什么也做不了），但公开仓库的日志人人可读——别把它当秘密，也别把整段日志往 issue / 群里贴。
- **真撞上过一次**：备份导出的那 25 秒与 push 触发的 CI 冒烟并发，`/api/review` 返回 **HTTP 500**（冒烟因此红），备份跑完后同一端点立刻 200。wrangler 那句「during which your D1 database will be unavailable to serve queries」不是客套话。处置：`backup.yml` 与 `sync.yml` 现在共用 concurrency 组 `lottery-prod` 串行执行，`cancel-in-progress: false`（落库跑到一半被掐掉比排队更糟）。定时上它们本来也不重叠（备份在北京 00:00，落库在 21:20–21:40），这条主要是防手动 dispatch 撞车。

## 恢复

导出的是完整 DDL + 数据，且 `CREATE TABLE` **不带 `IF NOT EXISTS`**（实测：往已有同名表的库里再导一次直接报 `table draws already exists`）。所以：

**A. 恢复到新库（最省事，也最安全——先验证再切流量）**

```bash
npx wrangler d1 create lottery-restored
npx wrangler d1 execute lottery-restored --file=backup-20260910-0000.sql --remote -y
npx wrangler d1 execute lottery-restored --remote --command "SELECT COUNT(*) FROM draws"
```

确认数据没问题后，再把 Worker 的 D1 绑定指向新库（改 `wrangler.toml` 里的 `database_id` 并部署）。

**B. 只往现有库里灌数据（表结构已经一样）**

导出时加 `--no-schema`，恢复时就只剩 `INSERT`：

```bash
npx wrangler d1 export lottery --remote --output data-only.sql --no-schema
```

注意这不会清空现有行，重复期号会因主键/唯一约束报错——先想清楚要的是「整库回滚」（用 A）还是「补数据」（用 B，或直接让 `sync` job 重新落库）。

**C. 本地演练**（不碰生产）

```bash
sqlite3 /tmp/restore.db ".read backup-20260910-0000.sql"
sqlite3 /tmp/restore.db "SELECT name FROM sqlite_master WHERE type='table'"
```

没有 sqlite3 的话，Node 22 也能当校验器：

```bash
node --experimental-sqlite -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(":memory:");db.exec(require("fs").readFileSync("backup.sql","utf8"));console.log(db.prepare("SELECT COUNT(*) c FROM draws").get())'
```

## 没做的事（以及为什么）

- **不做增量备份**：整库现在才 173 KB，全量最简单也最容易验证。等库大到分钟级导出成为负担再说。
- **不默认推到 R2**：不是每个人都需要再开一个桶；产物兜底 + 明确警告是更合适的默认值。
- **不加密备份文件**：密钥管理一旦进来，误操作空间比它解决的问题大。要做的是别把敏感东西放进这个库。
