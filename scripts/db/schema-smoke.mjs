// scripts/db/schema-smoke.mjs —— schema.sql 真执行冒烟（node:sqlite）
// unit.test 只比字符串；这里抓「测试漏掉的 SQL 语法错误」。
// Node <22.5 无 node:sqlite：如实 skip（exit 0），不伪装成已验证。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  console.log("skip: node:sqlite 不可用（Node <22.5）—— schema≡migrations 已由 unit.test 字符串锁死");
  process.exit(0);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(join(ROOT, "db", "schema.sql"), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(sql);
const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all("table");
const names = rows.map(r => r.name);
console.log("tables:", names.join(", "));
for (const t of ["draws", "dlt_draws", "small_draws", "favs", "predlog", "sync_log"]) {
  if (!names.includes(t)) {
    console.error("missing table:", t);
    process.exit(1);
  }
}
console.log("schema.sql 在 node:sqlite 下可执行，6 张表齐全");
