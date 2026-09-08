-- D1 sqlite，自用最小
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