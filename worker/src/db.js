export async function dbGet(db, sql, args = []) {
  if (!db) return null;
  try { return await db.prepare(sql).bind(...args).all(); } catch { return null; }
}
// 批量写：逐行 await 在 880 行/次的同步里要 2~3 分钟（实测 GitHub Actions 端 curl 等到 Connection reset），
// 改用 D1 batch 按块提交，往返从 ~900 次降到 ~20 次。
// 逐行先在 JS 侧构造语句（字段缺失会在这里抛、只丢这一行），整块提交失败再退回逐行，保持「坏一行不连坐」的旧语义。
const CHUNK = 50;
async function writeRows(db, rows, build) {
  const stmts = [];
  for (const d of rows) { try { const st = build(d); if (st) stmts.push(st); } catch {} }
  let n = 0;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    const part = stmts.slice(i, i + CHUNK);
    try {
      if (typeof db.batch === "function") { await db.batch(part); n += part.length; continue; }
    } catch {}
    for (const st of part) { try { await st.run(); n++; } catch {} }
  }
  return n;
}
export async function saveSSQ(db, draws) {
  if (!db || !draws?.length) return 0;
  // src=mock 是 getDraws 三源全挂时的读路径占位（index.js），不是真实开奖。
  // 落库会让 D1 多出一条假期号（2025091），/api/ssq/history、复盘对账、验奖都会命中它——
  // 宁可这次 0 落库（D1 旧值仍是好的），也不能让假数据进事实源。
  return writeRows(db, draws.slice(0, 120), d => (!d || d.src === "mock") ? null :
    db.prepare("INSERT OR REPLACE INTO draws(code,red,blue,draw_date,src) VALUES(?,?,?,?,?)").bind(d.code, d.red.join(","), d.blue, d.date || "", d.src || ""));
}
export async function loadSSQ(db, limit = 30) {
  const r = await dbGet(db, "SELECT code,red,blue,draw_date,src FROM draws ORDER BY code DESC LIMIT ?", [limit]);
  const rows = r?.results || [];
  return rows.map(x => ({ code: x.code, red: String(x.red).split(","), blue: String(x.blue), date: x.draw_date || "", src: x.src || "d1" }));
}
export async function saveDLT(db, draws) {
  if (!db || !draws?.length) return 0;
  return writeRows(db, draws.slice(0, 120), d =>
    db.prepare("INSERT OR REPLACE INTO dlt_draws(code,front,back,draw_date,src) VALUES(?,?,?,?,?)")
      .bind(d.code, d.front.join(","), d.back.join(","), d.date || "", d.src || ""));
}

export async function loadDLT(db, limit = 30) {
  const r = await dbGet(db, "SELECT code,front,back,draw_date,src FROM dlt_draws ORDER BY code DESC LIMIT ?", [limit]);
  return (r?.results || []).map(x => ({
    code: x.code,
    front: String(x.front).split(","),
    back: String(x.back).split(","),
    date: x.draw_date || "",
    src: x.src || "d1"
  }));
}

// 小彩种统一以 JSON 存 payload，避免为 6 种玩法各建一张表
export async function saveSmall(db, kind, draws, max = 120) {
  if (!db || !draws?.length) return 0;
  return writeRows(db, draws.slice(0, max), d =>
    db.prepare("INSERT OR REPLACE INTO small_draws(kind,code,payload,draw_date,src) VALUES(?,?,?,?,?)")
      .bind(kind, d.code, JSON.stringify({ digits: d.digits, main: d.main, special: d.special, nums: d.nums }), d.date || "", d.src || ""));
}

export async function loadSmall(db, kind, limit = 30) {
  const r = await dbGet(db, "SELECT code,payload,draw_date,src FROM small_draws WHERE kind=? ORDER BY code DESC LIMIT ?", [kind, limit]);
  return (r?.results || []).map(x => {
    let p = {};
    try { p = JSON.parse(x.payload || "{}"); } catch {}
    return { code: x.code, date: x.draw_date || "", src: x.src || "d1", ...p };
  });
}

export async function saveKind(db, table, draws, map) {
  if (!db || !draws?.length) return 0;
  let n = 0;
  for (const d of draws.slice(0, 120)) {
    try { await map(d); n++; } catch {}
  }
  return n;
}
export async function logSync(db, sources, fetched, inserted, consistent, note = "") {
  try { await db.prepare("INSERT INTO sync_log(sources,fetched,inserted,consistent,note) VALUES(?,?,?,?,?)").bind(sources, fetched, inserted, consistent ? 1 : 0, note).run(); } catch {}
}
// 同步健康时序：最近 limit 次 adminSync 的拉取量/落库量/交叉校验结果。
// 表不存在时返回 null（未部署 schema 的环境不得渲染成「故障」，与 /api/meta 的 predlog 同约定）
export async function loadSyncLog(db, limit = 50) {
  const r = await dbGet(db, "SELECT ran_at, sources, fetched, inserted, consistent, note FROM sync_log ORDER BY id DESC LIMIT ?", [limit]);
  if (!r) return null;
  return (r.results || []).map(x => ({
    ranAt: x.ran_at || "",
    sources: String(x.sources || "").split(",").filter(Boolean),
    fetched: Number(x.fetched) || 0,
    inserted: Number(x.inserted) || 0,
    consistent: x.consistent === 1 || x.consistent === true,
    note: x.note || ""
  }));
}