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
| `BACKUP_INCLUDE_FAVS` | Variable | 可选。设 `0` 则备份剔除个人收藏表 `favs`（公开仓库建议设 0） |

也可手动 `workflow_dispatch` 触发，运行表单里能临时选是否包含 `favs`。

## 产物放在哪儿，以及为什么这是唯一需要你判断的风险

- **配了 `R2_BUCKET`**：文件进你的私有 R2，只有拿得到 Token 的人能取。推荐长期这样跑。
- **只配了 CF 三个 secrets**：文件进 GitHub Actions 产物（保留 90 天）。⚠️ **公开仓库的 Actions 产物不需要登录就能下载**——谁能看仓库，谁就能拖走你的整库 SQL。开奖数据本身是公开信息，真正的私人内容只有 `favs`（你存的自选号与备注）。三条应对，按稳妥程度排序：① 配 R2；② 仓库转私有；③ 至少设 `BACKUP_INCLUDE_FAVS=0`。

## 日志里那条预签名链接（已处理，但要知道为什么）

`wrangler d1 export` 除了写文件，还会往 stdout 打一条**预签名 R2 下载链接**，里面含 `X-Amz-Credential` 与 `X-Amz-Signature`，**一小时内任何拿到它的人都能直接下载你的整库**。Actions 日志在公开仓库里是任何人可读的，所以 workflow 把 wrangler 的输出重定向到文件、过滤掉 `r2.cloudflarestorage.com` 那一行再打印。

> 别在别处（终端录屏、issue 粘贴、CI 日志）把这条链接原样发出去。

## 备份里有什么：一次真实导出的读数

对当前生产库跑一次 `wrangler d1 export lottery --remote` 得到 173 KB / 1007 条 `INSERT`，还原后逐表行数：

| 表 | 行数 |
|---|---|
| `small_draws` | 729 |
| `draws` | 120 |
| `dlt_draws` | 120 |
| `predlog` | 12 |
| `sync_log` | 23 |
| `favs` | 0 |

workflow 的「还原验证」步骤会把这些数字打印进 Job Summary；全为 0 时给 `::warning::`（新部署的库确实可能还没落库），但**还原本身失败一定让 job 变红**。

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
