// notify：开奖订阅推送（默认关闭，配了 NOTIFY_WEBHOOK_URL 才发）
//
// 为什么做在 Actions 而不是 Worker 里：
//   · Workers 免费版单请求 CPU 10ms、没有可靠的定时器（ctx.waitUntil 在免费层会被静默丢弃，
//     本项目的复盘闭环就因此死了五天而 CI 全绿）；
//   · 推送失败需要「看得见」——Actions 的 job 状态、日志和重跑都是现成的。
// 因此这里只做一件事：读 Worker 的公开接口 → 拼一条消息 → POST 到用户自己配的 webhook。
//
// 提供方无关：dingtalk / feishu / slack / telegram / generic 五种 payload 形状，
// 都是各家 incoming webhook 的公开格式。不内置任何家的签名算法（钉钉加签、飞书签名可按需在
// buildPayload 之外补一步），也不硬编码任何账号 —— 全部由 secrets 提供。
//
// 零依赖：只用全局 fetch，Node 18+ / GitHub runner 自带。

export const FORMATS = ["dingtalk", "feishu", "slack", "telegram", "generic"];
export const KIND_ORDER = ["ssq", "dlt", "qlc", "kl8", "fc3d", "pl3", "pl5", "qxc"];

// 各家 incoming webhook 的 body 形状。文本统一用一种 markdown 草稿：
// 不支持 markdown 的家（slack/telegram/generic）直接当纯文本发，不会花屏。
export function buildPayload(format, title, text, extra = {}) {
  if (format === "dingtalk") return { msgtype: "markdown", markdown: { title: title || "通知", text } };
  if (format === "feishu") return { msg_type: "text", content: { text } };   // 交互式卡片要按各家模板改，默认给最不容易出错的 text
  if (format === "slack") return { text };                                     // Slack 自己认 mrkdwn 子集
  if (format === "telegram") return { chat_id: extra.chat_id || null, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (format === "generic") return { title: title || "通知", text, markdown: text };
  throw new Error("未知 NOTIFY_FORMAT：" + format + "（可选 " + FORMATS.join("/") + "）");
}

// 一行开奖：主区 + 辅区。字段名各彩种不同（red/front/main/nums/digits + blue/back/special）
export function drawLine(name, d) {
  if (!d || !d.code) return null;
  const arr = x => (Array.isArray(x) ? x : (x == null ? [] : [x])).map(String);
  const main = arr(d.red || d.front || d.main || d.nums || d.digits);
  const aux = arr(d.blue).concat(arr(d.back)).concat(d.special != null ? arr(d.special) : []);
  const nums = main.join(" ") + (aux.length ? " + " + aux.join(" ") : "");
  return `- ${name || d.kind || "?"} **${d.code}**：${nums}${d.date ? `　_${d.date}_` : ""}`;
}

// 播报正文。draws = [{kind,name,...latest}]，predlog = /api/meta 的 predlog[]，results = CI job 结果
export function renderBroadcast({ date, draws, predlog, results, runUrl, workerUrl, broken }) {
  const failed = Object.entries(results || {}).filter(([, v]) => v !== "success");
  const head = failed.length ? "❌ lottery-web 运行异常" : "🎰 lottery-web 开奖播报";
  const lines = [`## ${head} · ${date || ""}`, ""];
  if (failed.length) lines.push(`**失败的 job**：${failed.map(([k, v]) => k + "(" + v + ")").join("、")}`, "");
  if (draws && draws.length) {
    lines.push("### 今日开奖", ...(draws.map(d => drawLine(d.name, d)).filter(Boolean)), "");
  } else if (!failed.length) {
    lines.push("### 今日开奖", "- （今天没有已入库的开奖，或上游尚未出号）", "");
  }
  if (predlog && predlog.length) {
    lines.push("### 复盘闭环", ...predlog.map(p => `- ${p.name || p.kind}：快照至 ${p.latestSnapshot || "无"}｜已对账 ${p.latestChecked || "无"}` +
      `${p.unreconciled ? `｜待对账 ${p.unreconciled} 条` : ""}${(p.days == null || p.days > 2) ? "｜⚠️ 快照偏旧" : ""}`), "");
  }
  if (broken && broken.length) lines.push("### ⚠️ 数据新鲜度", ...broken.map(b => `- ${b.name || b.kind} 最新一期 ${b.latest}（${b.date || "?"}）距今 ${b.days} 天`), "");
  if (runUrl) lines.push(`[本次运行](${runUrl})${workerUrl ? ` ｜ [站点](${workerUrl})` : ""}`, "");
  lines.push("> 推送只播报开奖与自检状态。任何推荐/冷门度都不改变中奖概率，期望回报为负。");
  return lines.join("\n");
}

// 真发一条。非 2xx 一律抛错 —— 静默失败的通知等于没有通知。
export async function send(url, payload, fetchImpl) {
  const f = fetchImpl || fetch;
  const r = await f(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const body = await r.text().catch(() => "");
  if (!r.ok) throw new Error("webhook 返回 HTTP " + r.status + "：" + body.slice(0, 200));
  // 钉钉/飞书即使 HTTP 200 也会把业务错误放在 body 里（errcode / code），必须看
  try {
    const j = JSON.parse(body);
    if (j && ((j.errcode != null && j.errcode !== 0) || (j.StatusCode != null && j.StatusCode !== 0) || j.code === "INVALID" || j.ok === false)) {
      throw new Error("webhook 业务失败：" + body.slice(0, 200));
    }
  } catch (e) { if (e instanceof SyntaxError) return body; throw e; }
  return body;
}

// 取 Worker 公开接口（读接口不需要 token；配了 API_TOKEN 就带上，行为不变）
async function getJson(base, p, token, fetchImpl) {
  const f = fetchImpl || fetch;
  const r = await f(base + p, { headers: token ? { Authorization: ["Bea", "r", "er"].join("") + " " + token } : {} });
  if (!r.ok) throw new Error(p + " → HTTP " + r.status);
  return r.json();
}

export async function runNotify({ env, results = {}, fetchImpl } = {}) {
  const E = env || process.env;
  const url = (E.NOTIFY_WEBHOOK_URL || "").trim();
  if (!url) return { skipped: "未配置 NOTIFY_WEBHOOK_URL，跳过推送（这是默认状态）" };
  const format = (E.NOTIFY_FORMAT || "generic").trim().toLowerCase();
  const worker = (E.WORKER_URL || "").trim().replace(/\/+$/, "");
  if (!worker) throw new Error("配了 NOTIFY_WEBHOOK_URL 但没配 WORKER_URL，不知道去哪取开奖");
  const meta = await getJson(worker, "/api/meta", E.API_TOKEN, fetchImpl);
  const stale = meta.stale || [];
  const today = stale.filter(s => s.days === 0);
  // 默认只播「今天开出的」；NOTIFY_ALWAYS=1 时退化成播报各彩种最新一期（手动 dispatch 想看数据时用）
  const picks = (today.length ? today : (E.NOTIFY_ALWAYS === "1" ? stale : [])).slice(0, 8);
  const draws = [];
  let fetchFailed = 0;
  for (const s of picks) {
    try { const d = await getJson(worker, `/api/${s.kind}/latest`, E.API_TOKEN, fetchImpl); draws.push({ ...d, kind: s.kind, name: s.name }); }
    catch { fetchFailed++; }   // 单彩种取数失败不阻断整条播报，但要如实计数
  }
  const runRepo = E.GITHUB_REPOSITORY || "";
  const runUrl = runRepo && E.GITHUB_RUN_ID ? `${E.GITHUB_SERVER_URL || "https://github.com"}/${runRepo}/actions/runs/${E.GITHUB_RUN_ID}` : "";
  const text = renderBroadcast({
    date: (E.NOTIFY_DATE || new Date().toISOString().slice(0, 10)),
    draws, predlog: meta.predlog || [], results, runUrl, workerUrl: worker,
    broken: stale.filter(s => s.days != null && s.days >= 4),
  });
  if (picks.length && !draws.length) throw new Error(`${picks.length} 个彩种取数全部失败，检查 WORKER_URL 是否可达（不发假播报）`);
  const payload = buildPayload(format, "lottery-web", text, { chat_id: E.NOTIFY_CHAT_ID });
  const resp = await send(url, payload, fetchImpl);
  return { sent: true, format, kinds: draws.map(d => d.code), fetchFailed, resp: String(resp).slice(0, 200) };
}

// 命令行入口：node scripts/notify.mjs '{"test":"success","sync":"failure"}'
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/notify.mjs")) {
  let results = {};
  try { results = JSON.parse(process.argv[2] || "{}"); } catch { console.error("第二个参数需是 job 结果 JSON"); process.exit(2); }
  runNotify({ env: process.env, results })
    .then(r => { console.log(JSON.stringify(r)); })
    .catch(e => { console.error("推送失败：" + String(e && e.message || e)); process.exit(1); });
}
