// smallRoute（/api/{fc3d,pl3,pl5,qlc,qxc,kl8}/…）的 act 分派回归锁。
//
// 为什么单独一个文件：v0.15.0 上线时这里出过一次真实回归——给 /kill /dan 加样本门槛时
// 把 `if (act === "kill" || …)` 写成了独立 if（没接成 else if），于是 latest/history 在前面
// 设好的 res 被末尾的 else（验奖）覆盖。线上表现是 /api/qxc/latest 返回
// {"hit":false,"note":"期号不存在"}，预测页头部整块空白。
//
// 它能溜上线是因为**当时没有任何测试碰过 smallRoute**，CI 的线上冒烟也只查 /api/ssq/latest。
// 这个文件补上那道缺口：逐个 act 断言「返回的是它自己的形状」，而不是只看 HTTP 200。
//
// 不依赖网络：把 globalThis.fetch 换成必定 reject，fetchSmall 抛错后按设计降级读 D1 桩，
// 于是纯离线可跑（与本项目其余测试一致）。
import { test } from "node:test";
import assert from "node:assert/strict";

// 6 个走 smallRoute 的数字/小彩种（ssq 走 ssqRoute、dlt 走 dltRoute，不在此列）
const KINDS = ["fc3d", "pl3", "pl5", "qlc", "qxc", "kl8"];

function drawsFor(kind) {
  if (kind === "qlc") return [{ code: "2026243", main: ["01", "05", "09", "14", "20", "26", "30"], special: "08", date: "2026-09-09" }];
  if (kind === "kl8") return [{ code: "2026243", nums: Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0")), date: "2026-09-09" }];
  const n = { fc3d: 3, pl3: 3, pl5: 5, qxc: 7 }[kind];
  return [{ code: "2026243", digits: Array.from({ length: n }, (_, i) => String(i)), date: "2026-09-09" }];
}

function makeDB() {
  const log = [];
  const exec = (sql, args) => {
    if (/small_draws/.test(sql)) {
      const kind = args[0];
      return drawsFor(kind).map(d => ({ code: d.code, draw_date: d.date, src: "d1", payload: JSON.stringify(d) }));
    }
    return [];
  };
  const stmt = sql => ({
    bind: (...a) => ({ all: async () => ({ results: exec(sql, a) }), run: async () => ({ results: exec(sql, a) }) }),
    all: async () => ({ results: exec(sql, []) }), run: async () => ({ results: exec(sql, []) })
  });
  return { log, prepare: sql => stmt(sql) };
}

// 全程离线：fetch 必抛 → smallRoute 按设计降级读 D1 桩。
// 还要补 caches 桩：caches.default 只存在于 Workers 运行时，Node 里没有，
// smallRoute 第一行就摸它（原先正因为无法在 Node 里跑，这个文件才一直不存在）。
async function withOfflineNetwork(fn) {
  const realFetch = globalThis.fetch, realCaches = globalThis.caches;
  const put = [];
  globalThis.fetch = () => Promise.reject(new Error("offline in test"));
  globalThis.caches = { default: { match: async () => undefined, put: async (k, r) => { put.push(String(k)); } } };
  try { return await fn(); } finally { globalThis.fetch = realFetch; globalThis.caches = realCaches; }
}

const call = (env, path) => worker.fetch(new Request("http://x" + path), env, {});

let worker;
test.before(async () => { worker = (await import("../src/index.js")).default; });

test("smallRoute：每个 act 都返回自己的形状（回归：独立 if 覆盖了 latest/history 的 res）", async () => {
  await withOfflineNetwork(async () => {
    const env = { DB: makeDB() };
    for (const kind of KINDS) {
      // latest：必须是开奖期本身，不能是验奖响应
      const latest = await (await call(env, `/api/${kind}/latest`)).json();
      assert.equal(latest.code, "2026243", `${kind}/latest 应返回期号，实际 ` + JSON.stringify(latest).slice(0, 120));
      assert.equal(latest.hit, undefined, `${kind}/latest 混进了验奖响应的 hit 字段`);
      assert.equal(latest.note, undefined, `${kind}/latest 混进了验奖响应的 note 字段`);
      assert.ok(latest.digits || latest.nums || latest.main, `${kind}/latest 应带号码字段`);

      // history：必须是数组
      const hist = await (await call(env, `/api/${kind}/history?limit=5`)).json();
      assert.ok(Array.isArray(hist), `${kind}/history 应返回数组，实际 ` + JSON.stringify(hist).slice(0, 120));
      assert.equal(hist[0] && hist[0].code, "2026243", `${kind}/history 首条应是最新期`);

      // verify：这一支才该有 hit / note
      const v = await (await call(env, `/api/${kind}/verify?code=2026243&nums=` + (latest.digits || latest.nums || latest.main).join(","))).json();
      assert.ok("hit" in v, `${kind}/verify 应返回 hit 字段`);
      assert.equal(v.hit, true, `${kind}/verify 命中应为 true`);
    }
  });
});

test("smallRoute：样本不足门槛只作用于 /kill /dan，latest /history 不受影响", async () => {
  await withOfflineNetwork(async () => {
    // 只有 2 期 —— 低于 MIN_DRAWS=5（造两期，断言 history 真能返回 2 条）
    const lowRows = kind => ["2026243", "2026242"].map((code, i) => {
      const d = drawsFor(kind)[0];
      return { code, draw_date: "2026-09-0" + (9 - i), src: "d1", payload: JSON.stringify(d) };
    });
    const env = { DB: { prepare: sql => ({ bind: (...a) => ({ all: async () => ({ results: /small_draws/.test(sql) ? lowRows(a[0]) : [] }), run: async () => ({ results: [] }) }), all: async () => ({ results: [] }) }) } };
    for (const kind of KINDS) {
      const kill = await (await call(env, `/api/${kind}/kill`)).json();
      const dan = await (await call(env, `/api/${kind}/dan`)).json();
      for (const [act, body] of [["kill", kill], ["dan", dan]]) {
        assert.equal(body.insufficient, true, `${kind}/${act} 样本不足应标 insufficient`);
        assert.match(body.note || "", /样本不足/, `${kind}/${act} 应写明样本不足`);
        assert.deepEqual(body.main, [], `${kind}/${act} 样本不足不得给号`);
        assert.deepEqual(body.perPos, [], `${kind}/${act} 样本不足不得给分位结果`);
      }
      // latest /history 与门槛无关，仍要有数据
      const latest = await (await call(env, `/api/${kind}/latest`)).json();
      assert.equal(latest.code, "2026243", `${kind}/latest 不该被样本门槛拦掉`);
      const hist = await (await call(env, `/api/${kind}/history`)).json();
      assert.ok(Array.isArray(hist) && hist.length === 2, `${kind}/history 不该被样本门槛拦掉`);
    }
  });
});

test("降级时数组仍是数组：元数据走 X-Degraded 头，不摊成对象", async () => {
  await withOfflineNetwork(async () => {
    const env = { DB: makeDB() };
    // 上面 withOfflineNetwork 让 fetch 必抛 ⇒ 必然走降级分支，正是这条要验的路径
    const h = await call(env, "/api/fc3d/history?limit=5");
    const body = await h.json();
    assert.ok(Array.isArray(body), "降级路径也不能把数组摊成 {" + '"0":…}');
    assert.equal(body[0].code, "2026243");
    assert.equal(h.headers.get("X-Degraded"), "1", "降级痕迹走响应头（JSON 数组带不了同级字段）");
    // 同一个降级批次里，对象型响应仍然用 body 字段标降级
    const a = await (await call(env, "/api/fc3d/analyze")).json();
    assert.equal(a.degraded, true, "对象型响应的 degraded 仍在 body 里");
  });
});

test("ssqRoute：history /trend 的来源元数据走响应头，且 body 仍是数组", async () => {
  // 旧实现 withMeta() 把 _sources 挂在数组上，而 JSON.stringify 只序列化索引 ⇒ 元数据从未进过响应体。
  // 线上实测：/api/ssq/latest（对象）有 sources/consistent，/api/ssq/history 与 /trend 却没有。
  // 现在元数据走 X-Sources / X-Consistent 头，body 保持数组（前端要的就是数组）。
  await withOfflineNetwork(async () => {
    const env = { DB: makeDB() };
    // getDraws 走 fetch（此处必抛）→ 回落 17500 也会抛 → 最后落 mock 单条；无论哪条都带 _sources
    for (const [p, isArr] of [["/api/ssq/history?limit=2", true], ["/api/ssq/trend?limit=5", true]]) {
      const r = await call(env, p);
      const body = await r.json();
      assert.equal(Array.isArray(body), isArr, p + " body 应是数组");
      // Headers 的键在内部映射里，必须用 has()/get()，`in` 查的是实例自有属性（永远 false）
      assert.ok(r.headers.has("x-sources"), p + " 应带 X-Sources 响应头");
      assert.ok(r.headers.has("x-consistent"), p + " 应带 X-Consistent 响应头");
      assert.match(r.headers.get("x-consistent"), /^[01]$/, "X-Consistent 只能是 0/1");
      assert.ok(!JSON.stringify(body).includes("_sources"), p + " body 里不该再有被 JSON 丢掉的 _sources");
    }
    // latest 是对象，元数据仍在 body（既有契约不变）
    const l = await (await call(env, "/api/ssq/latest")).json();
    assert.ok("sources" in l && "consistent" in l, "/api/ssq/latest 的 sources/consistent 应留在 body");
  });
});

test("推荐结果带口径说明：几套策略不是同一窗口的统计", async () => {
  const { recommendAll } = await import("../src/predict.js");
  const pad2 = v => String(v).padStart(2, "0");
  let seed = 24680; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const distinct = (hi, k) => { const s = new Set(); let g = 0; while (s.size < k && g++ < 500) s.add(pad2(1 + Math.floor(rnd() * hi))); return [...s]; };
  const draws = Array.from({ length: 60 }, (_, i) => ({ code: "2026" + (1000 + i), red: distinct(33, 6).sort(), blue: pad2(1 + Math.floor(rnd() * 16)) }));
  const rec = recommendAll("ssq", draws, { win: 30 });
  assert.ok(rec.caliber, "推荐结果必须带 caliber 说明");
  assert.match(rec.caliber, /全量历史/, "须写明热/冷是全量口径");
  assert.match(rec.caliber, /win=30/, "须写明胆码是 win 窗口");
  assert.match(rec.caliber, /并非同一窗口/, "须点明同一组内几套策略口径不同");
  // 混用了两种窗口的策略，note 本身也要说清
  const mix = rec.picks.find(x => x.name === "均衡");
  assert.ok(mix, "应有「均衡」策略");
  assert.match(mix.note, /全量/, "「均衡」note 须点出它混了全量与 win 窗口");
  // 数字型同样带 caliber，且「胆码优先」注明窗口
  const dg = recommendAll("qxc", draws.map((d, i) => ({ code: d.code, digits: Array.from({ length: 7 }, () => String(Math.floor(rnd() * 10))) })), { win: 30 });
  assert.ok(dg.caliber, "数字型推荐也要带 caliber");
  assert.match(dg.picks.find(x => x.name === "胆码优先").note, /win 窗口/);
});
