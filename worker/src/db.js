export async function dbGet(db, sql, args = []) {
  if (!db) return null;
  try { return await db.prepare(sql).bind(...args).all(); } catch { return null; }
}
export async function saveSSQ(db, draws) {
  if (!db || !draws?.length) return 0;
  let n = 0;
  for (const d of draws.slice(0, 120)) {
    try { await db.prepare("INSERT OR REPLACE INTO draws(code,red,blue,draw_date,src) VALUES(?,?,?,?,?)").bind(d.code, d.red.join(","), d.blue, d.date || "", d.src || "").run(); n++; } catch {}
  }
  return n;
}
export async function loadSSQ(db, limit = 30) {
  const r = await dbGet(db, "SELECT code,red,blue,draw_date,src FROM draws ORDER BY code DESC LIMIT ?", [limit]);
  const rows = r?.results || [];
  return rows.map(x => ({ code: x.code, red: String(x.red).split(","), blue: String(x.blue), date: x.draw_date || "", src: x.src || "d1" }));
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