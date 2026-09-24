-- 0001_baseline —— D1 基线 schema（截至 v0.14.0 的全部表）
-- 迁移纪律：
--   1. 已发布的迁移文件禁止改内容，改动用新的 00NN_*.sql；
--   2. db/schema.sql = 按序拼接的全部迁移（bootstrap 一条命令），由测试锁死两者一致；
--   3. Worker 侧自建表（predlog 的 CREATE IF NOT EXISTS）只作运行时兜底，事实源是这里的迁移。
CREATE TABLE IF NOT EXISTS draws (
  code TEXT PRIMARY KEY,
  red TEXT NOT NULL,
  blue TEXT NOT NULL,
  draw_date TEXT,
  src TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT DEFAULT (datetime('now')),
  sources TEXT,
  fetched INTEGER,
  inserted INTEGER,
  consistent INTEGER,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_draws_code ON draws(code DESC);
CREATE TABLE IF NOT EXISTS dlt_draws (
  code TEXT PRIMARY KEY,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  draw_date TEXT,
  src TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS small_draws (
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  payload TEXT NOT NULL,
  draw_date TEXT,
  src TEXT,
  PRIMARY KEY (kind, code)
);
CREATE TABLE IF NOT EXISTS favs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  numbers TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
-- 预测复盘：每日同步快照下一期推荐，开奖后对账（Worker 会在首次使用时自建，此处预建保证 schema 完整）
CREATE TABLE IF NOT EXISTS predlog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  payload TEXT NOT NULL,
  hit TEXT,
  checked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind, code)
);
