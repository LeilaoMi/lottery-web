// notify 单元测试：payload 形状 / 播报正文 / 真发一次到本地 http server。
// send() 用真 HTTP（本地起服务），不 mock —— 「看着发了其实没发」是这类功能最容易出的事故。
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildPayload, drawLine, renderBroadcast, send, runNotify, FORMATS } from "./notify.mjs";

test("buildPayload：五种家的 body 形状与各家文档一致", () => {
  assert.deepEqual(buildPayload("dingtalk", "T", "正文"), { msgtype: "markdown", markdown: { title: "T", text: "正文" } });
  assert.deepEqual(buildPayload("feishu", "T", "正文"), { msg_type: "text", content: { text: "正文" } });
  assert.deepEqual(buildPayload("slack", "T", "正文"), { text: "正文" });
  assert.deepEqual(buildPayload("telegram", "T", "正文", { chat_id: "42" }),
    { chat_id: "42", text: "正文", parse_mode: "HTML", disable_web_page_preview: true });
  assert.deepEqual(buildPayload("generic", "T", "正文"), { title: "T", text: "正文", markdown: "正文" });
  assert.throws(() => buildPayload("wechat", "T", "x"), /未知 NOTIFY_FORMAT/);
  // telegram 没给 chat_id 不能编一个
  assert.equal(buildPayload("telegram", "T", "x").chat_id, null);
});

test("drawLine：8 彩种字段名不同，都要收敛成一行；缺期号返回 null 而不是 undefined", () => {
  assert.match(drawLine("双色球", { code: "2026104", red: ["01", "05"], blue: "04", date: "2026-09-08" }), /2026104.*01 05 \+ 04/);
  assert.match(drawLine("大乐透", { code: "26103", front: ["03", "16"], back: ["02", "12"] }), /03 16 \+ 02 12/);
  assert.match(drawLine("七乐彩", { code: "2026104", main: ["09", "16"], special: "27" }), /09 16 \+ 27/);
  assert.match(drawLine("福彩3D", { code: "2026242", digits: ["5", "5", "5"] }), /5 5 5/);
  assert.match(drawLine("快乐8", { code: "2026242", nums: ["04", "20"] }), /04 20/);
  assert.equal(drawLine("双色球", {}), null);
  assert.equal(drawLine("双色球", null), null);
});

test("renderBroadcast：job 失败时标题必须是异常，不能继续报喜", () => {
  const ok = renderBroadcast({
    date: "2026-09-10",
    draws: [{ code: "2026104", red: ["01", "05", "12", "22", "28", "30"], blue: "04", name: "双色球" }],
    predlog: [{ name: "福彩3D", latestSnapshot: "2026243", latestChecked: null, unreconciled: 1, days: 0 }],
    results: { test: "success", sync: "success", review: "success" },
    broken: [{ name: "七星彩", kind: "qxc", latest: "26103", date: "2026-09-06", days: 4 }],
  });
  assert.ok(ok.includes("开奖播报"), "全绿时是开奖播报");
  assert.ok(ok.includes("01 05 12 22 28 30 + 04"));
  assert.ok(ok.includes("已对账 无") && ok.includes("待对账 1 条"), "闭环状态要如实写出，包括从未对账");
  assert.ok(ok.includes("数据新鲜度") && ok.includes("距今 4 天"), "偏旧的彩种要单列");
  assert.ok(ok.includes("期望回报为负"), "免责句跟着发出去");

  const bad = renderBroadcast({ date: "2026-09-10", draws: [], predlog: [], results: { test: "success", review: "failure" } });
  assert.ok(bad.includes("❌") && bad.includes("运行异常"), "有 job 失败就不是喜报");
  assert.ok(bad.includes("review(failure)"));
  assert.ok(!bad.includes("今日开奖"), "失败时不硬凑一段空开奖");

  const empty = renderBroadcast({ date: "2026-09-10", draws: [], predlog: [], results: {} });
  assert.ok(empty.includes("今天没有已入库的开奖"), "今天没数据就说没数据");
});

test("send：真发一次本地 http server，非 2xx 与「200 但业务失败」都要抛错", async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c); req.on("end", () => {
      seen.push({ method: req.method, ct: req.headers["content-type"], body: b });
      res.statusCode = Number(new URL(req.url, "http://x").searchParams.get("code") || 200);
      res.end(new URL(req.url, "http://x").searchParams.get("body") || "ok");
    });
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const out = await send(`${base}/hook`, buildPayload("slack", "T", "hello"));
    assert.equal(out, "ok");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "POST");
    assert.match(seen[0].ct, /application\/json/);
    assert.deepEqual(JSON.parse(seen[0].body), { text: "hello" }, "发出去的字节要和 buildPayload 一致");

    await assert.rejects(() => send(`${base}/hook?code=500&body=boom`, { text: "x" }), /HTTP 500.*boom/s);
    // 钉钉/飞书即使 HTTP 200 也把业务错误放在 body 里
    await assert.rejects(() => send(`${base}/hook?body=${encodeURIComponent('{"errcode":310000,"errmsg":"sign not match"}')}`, { text: "x" }),
      /webhook 业务失败/);
    await assert.rejects(() => send(`${base}/hook?body=${encodeURIComponent('{"ok":false}')}`, { text: "x" }), /webhook 业务失败/);
    await assert.doesNotReject(() => send(`${base}/hook?body=${encodeURIComponent('{"errcode":0,"errmsg":"ok"}')}`, { text: "x" }));
  } finally { srv.close(); }
});

test("runNotify：默认不发；配了 webhook 才取数并发送", async () => {
  assert.match((await runNotify({ env: {} })).skipped, /未配置 NOTIFY_WEBHOOK_URL/);
  await assert.rejects(() => runNotify({ env: { NOTIFY_WEBHOOK_URL: "http://127.0.0.1:1/x", WORKER_URL: "" } }), /WORKER_URL/);

  const calls = [];
  const fetchImpl = async (u, opt) => {
    calls.push({ u, body: opt && opt.body });
    if (u.endsWith("/api/meta")) return { ok: true, json: async () => ({
      stale: [{ kind: "ssq", name: "双色球", latest: "2026104", date: "2026-09-08", days: 0 }, { kind: "qxc", name: "七星彩", latest: "26103", date: "2026-09-06", days: 4 }],
      predlog: [{ kind: "fc3d", name: "福彩3D", latestSnapshot: "2026243", latestChecked: null, unreconciled: 1, days: 0 }] }) };
    if (u.includes("/api/ssq/latest")) return { ok: true, json: async () => ({ code: "2026104", red: ["01", "05", "12", "22", "28", "30"], blue: "04", date: "2026-09-08" }) };
    return { ok: true, text: async () => "ok", json: async () => ({}) };
  };
  const r = await runNotify({
    env: { NOTIFY_WEBHOOK_URL: "http://example.invalid/hook", NOTIFY_FORMAT: "dingtalk", WORKER_URL: "https://w.example/", NOTIFY_DATE: "2026-09-08" },
    results: { sync: "success" }, fetchImpl,
  });
  assert.equal(r.sent, true);
  assert.deepEqual(r.kinds, ["2026104"], "只播 days=0 的彩种，days=4 的走新鲜度告警");
  assert.equal(r.fetchFailed, 0);
  const hook = calls[calls.length - 1];
  assert.equal(hook.u, "http://example.invalid/hook");
  const payload = JSON.parse(hook.body);
  assert.equal(payload.msgtype, "markdown");
  assert.ok(payload.markdown.text.includes("01 05 12 22 28 30 + 04"), "webhook 收到的正文里有开奖号");
  assert.ok(payload.markdown.text.includes("七星彩"), "偏旧彩种的告警也在正文里");
  assert.ok(!calls.some(c => c.u.includes("/api/qxc/latest")), "days>0 的彩种不该被逐个拉取（省请求）");

  // 全部取数失败 → 抛错，不发「今天没开奖」的假播报
  await assert.rejects(() => runNotify({
    env: { NOTIFY_WEBHOOK_URL: "http://example.invalid/hook", WORKER_URL: "https://w.example", NOTIFY_DATE: "2026-09-08" },
    fetchImpl: async (u) => { if (u.endsWith("/api/meta")) return { ok: true, json: async () => ({ stale: [{ kind: "ssq", name: "双色球", days: 0, latest: "2026104" }] }) }; throw new Error("down"); },
  }), /取数全部失败/);
});
