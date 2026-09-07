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
export async function saveDLT(db, draws) {
  if (!db || !draws?.length) return 0;
  let n = 0;
  for (const d of draws.slice(0, 120)) {
    try {
      await db.prepare("INSERT OR REPLACE INTO dlt_draws(code,front,back,draw_date,src) VALUES(?,?,?,?,?)")
        .bind(d.code, d.front.join(","), d.back.join(","), d.date || "", d.src || "").run();
      n++;
    } catch {}
  }
  return n;
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
export async function saveSmall(db, kind, draws) {
  if (!db || !draws?.length) return 0;
  let n = 0;
  for (const d of draws.slice(0, 120)) {
    const payload = JSON.stringify({ digits: d.digits, main: d.main, special: d.special, nums: d.nums });
    try {
      await db.prepare("INSERT OR REPLACE INTO small_draws(kind,code,payload,draw_date,src) VALUES(?,?,?,?,?)")
        .bind(kind, d.code, payload, d.date || "", d.src || "").run();
      n++;
    } catch {}
  }
  return n;
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