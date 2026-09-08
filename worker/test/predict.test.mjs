import { test } from "node:test";
import assert from "node:assert/strict";
import { pad2 } from "../src/small.js";
import { SPECS, specOf, mainOf, auxOf, analyzeAll, killList, danList, recommendAll, structScore, acValue, binomP, backtest, calibrate, shapeTrans } from "../src/predict.js";

// 构造合成历史：不依赖网络，保证测试可重复
function synth(kind, n = 60) {
  const s = specOf(kind), out = [];
  let seed = 20260908;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) {
    const code = String(2026000 + i);
    if (s.type === "digit") {
      const digits = Array.from({ length: s.digits }, () => Math.floor(rnd() * 10));
      out.push({ code, digits: digits.map(String), date: "", src: "synth" });
    } else {
      const pool = [];
      for (let v = s.main.min; v <= s.main.max; v++) pool.push(pad2(v));
      const main = [], used = new Set();
      while (main.length < s.main.pick) { const k = pool[Math.floor(rnd() * pool.length)]; if (!used.has(k)) { used.add(k); main.push(k); } }
      const o = { code, date: "", src: "synth" };
      o[s.fMain] = main.sort();
      if (s.aux) {
        const ap = [];
        for (let v = s.aux.min; v <= s.aux.max; v++) ap.push(pad2(v));
        const a = [], ua = new Set();
        while (a.length < s.aux.pick) { const k = ap[Math.floor(rnd() * ap.length)]; if (!ua.has(k)) { ua.add(k); a.push(k); } }
        o[s.fAux] = s.aux.pick === 1 ? a[0] : a.sort();
      }
      out.push(o);
    }
  }
  return out;
}

const KINDS = Object.keys(SPECS);

test("specOf 覆盖 8 个彩种且字段完整", () => {
  assert.equal(KINDS.length, 8);
  for (const k of KINDS) {
    const s = specOf(k);
    assert.ok(s.name && s.type, k + " 缺少 name/type");
    if (s.type === "pool") assert.ok(s.main.min > 0 && s.main.max >= s.main.min && s.main.pick > 0, k);
    else assert.ok(s.digits >= 3, k);
  }
  assert.throws(() => specOf("unknown"));
});

test("mainOf/auxOf 屏蔽各彩种字段差异", () => {
  assert.deepEqual(mainOf({ red: ["01", "02", "03", "04", "05", "06"] }, "ssq"), ["01", "02", "03", "04", "05", "06"]);
  assert.deepEqual(auxOf({ blue: "9" }, "ssq"), ["09"]);
  assert.deepEqual(mainOf({ front: ["01", "05"], back: ["03", "07"] }, "dlt"), ["01", "05"]);
  assert.deepEqual(auxOf({ front: ["01", "05"], back: ["03", "07"] }, "dlt"), ["03", "07"]);
  assert.deepEqual(mainOf({ main: ["01"], special: "12" }, "qlc"), ["01"]);
  assert.deepEqual(auxOf({ main: ["01"], special: "12" }, "qlc"), ["12"]);
  assert.deepEqual(mainOf({ digits: ["1", "2", "3"] }, "fc3d"), ["1", "2", "3"]);
  assert.deepEqual(mainOf({ nums: ["01", "80"] }, "kl8"), ["01", "80"]);
  assert.deepEqual(auxOf({ nums: ["01", "80"] }, "kl8"), []);
});

test("8 个彩种 analyzeAll 输出结构一致", () => {
  for (const k of KINDS) {
    const a = analyzeAll(k, synth(k), 30);
    assert.equal(a.count, 30, k + " count");
    if (specOf(k).type === "pool") {
      assert.ok(a.hot && a.cold && a.freq && a.omission, k + " 缺分析字段");
      assert.ok(a.omission.cur && a.omission.avg && a.omission.max, k + " 缺遗漏");
      assert.ok(Array.isArray(a.zoneDist) && a.zoneDist.length === 3, k + " 区间分布");
      assert.match(a.oddRatio, /^\d+:\d+$/, k + " 奇偶比");
    } else {
      assert.equal(a.perPos.length, specOf(k).digits, k + " 位数");
      assert.ok(a.perPos[0].freq && a.perPos[0].omission, k + " 缺分位遗漏");
    }
  }
});

test("杀号：返回排序后的票数，且不会把整个号池杀光", () => {
  for (const k of KINDS) {
    const d = synth(k), kl = killList(k, d);
    if (specOf(k).type === "pool") {
      assert.ok(kl.main.length > 0, k + " 无杀号");
      for (let i = 1; i < kl.main.length; i++) assert.ok(kl.main[i - 1].votes >= kl.main[i].votes, k + " 杀号未降序");
      assert.ok(kl.main[0].votes > 0, k + " 最高票应 >0");
      const s = specOf(k), poolSize = s.main.max - s.main.min + 1;
      assert.ok(kl.main.length <= poolSize, k + " 杀号数超出池");
      assert.ok(typeof kl.threshold === "number", k + " 缺阈值");
    } else {
      assert.equal(kl.perPos.length, specOf(k).digits, k);
      assert.ok(kl.perPos[0].kill.length > 0, k + " 分位无杀号");
    }
  }
});

test("定胆：分数降序且不重复", () => {
  for (const k of KINDS) {
    const d = synth(k), dl = danList(k, d, 30);
    if (specOf(k).type === "pool") {
      const arr = dl.main;
      assert.ok(arr.length > 0 && arr.length <= 8, k + " 胆码数量");
      for (let i = 1; i < arr.length; i++) assert.ok(arr[i - 1].score >= arr[i].score, k + " 胆码未降序");
      assert.equal(new Set(arr.map(x => x.n)).size, arr.length, k + " 胆码重复");
      if (specOf(k).aux) assert.ok(dl.aux.length >= specOf(k).aux.pick, k + " 副区胆码不足");
    } else {
      assert.equal(dl.perPos.length, specOf(k).digits, k);
      assert.ok(dl.perPos[0].dan.length > 0, k);
    }
  }
});

test("recommendAll：8 彩种均为 6 套策略，号码合法不重复", () => {
  for (const k of KINDS) {
    const d = synth(k), r = recommendAll(k, d, { win: 30 });
    assert.equal(r.kind, k);
    assert.equal(r.picks.length, 6, k + " 策略数量");
    assert.ok(r.disclaimer, k + " 缺免责声明");
    assert.ok(r.analysis && r.kill && r.dan, k + " 缺模块");
    for (const p of r.picks) {
      assert.ok(p.name, k + " 策略无名");
      if (specOf(k).type === "pool") {
        const s = specOf(k);
        assert.equal(p.main.length, Math.min(s.suggest, s.main.max - s.main.min + 1), k + " 主区数量");
        assert.equal(new Set(p.main).size, p.main.length, k + " 号码重复");
        for (const x of p.main) { const v = Number(x); assert.ok(v >= s.main.min && v <= s.main.max, k + " 越界 " + x); }
        if (s.aux) assert.equal(p.aux.length, s.aux.pick, k + " 副区数量");
        assert.ok(typeof p.score === "number", k + " 缺结构分");
      } else {
        assert.equal(p.digits.length, specOf(k).digits, k + " 位数不对");
        assert.equal(p.number.length, specOf(k).digits, k + " 号码长度不对");
        for (const dg of p.digits) assert.ok(/^[0-9]$/.test(dg), k + " 非数字位");
      }
    }
  }
});

test("杀号缩水策略确实剔除了高票杀号", () => {
  const d = synth("ssq");
  const r = recommendAll("ssq", d, { win: 30 });
  const kl = r.kill, th = kl.threshold;
  const killed = new Set(kl.main.filter(x => x.votes >= th).map(x => x.n));
  const shrunk = r.picks.find(p => p.name === "杀号缩水");
  for (const x of shrunk.main) assert.ok(!killed.has(x), "缩水后仍含杀号 " + x);
});

test("structScore 对结构合理的组合给更高分", () => {
  const zone = { min: 1, max: 33, pick: 6 };
  const good = structScore(["03", "09", "14", "21", "27", "32"], zone);
  const bad = structScore(["01", "02", "03", "04", "05", "06"], zone);
  assert.ok(good > bad, `分散组合(${good}) 应优于连号组合(${bad})`);
  assert.equal(acValue([1, 2, 3, 4, 5, 6]), 0);
});

test("副区与主区同池时（七乐彩）特别号不与基本号重复", () => {
  const d = synth("qlc");
  for (let i = 0; i < 20; i++) {
    for (const p of recommendAll("qlc", d, { win: 30 }).picks) {
      for (const a of p.aux) assert.ok(!p.main.includes(a), "特别号与基本号重复：" + a);
    }
  }
});

test("n 参数可控制推荐个数（快乐8 选号）", () => {
  const r = recommendAll("kl8", synth("kl8"), { win: 30, n: 5 });
  for (const p of r.picks) assert.equal(p.main.length, 5);
  const r2 = recommendAll("kl8", synth("kl8"), { win: 30, n: 12 });
  for (const p of r2.picks) assert.equal(p.main.length, 12);
});

test("回测：8 彩种结构与取值范围合法", async () => {
  const { backtest } = await import("../src/predict.js");
  for (const k of KINDS) {
    const d = synth(k, 60);
    const bt = backtest(k, d, { periods: 5, warmup: 10, win: 20 });
    assert.equal(bt.periods, 5, k + " 回测期数");
    assert.ok(bt.note && bt.disclaimer, k + " 缺声明");
    if (bt.strategies) {
      for (const key of ["hot", "cold", "dan"]) {
        const st = bt.strategies[key];
        assert.ok(st.hitRate >= 0 && st.hitRate <= 1, k + " " + key + " hitRate 越界");
        assert.ok(st.baseline > 0, k + " " + key + " baseline 异常");
        if (key !== "dan") assert.ok(st.baseline < 1, k + " " + key + " baseline 应为比率");
        assert.ok(st.avgHit >= 0, k + " " + key + " avgHit 负数");
      }
      assert.ok(bt.kill.hitRate >= 0 && bt.kill.hitRate <= 1, k + " killRate 越界");
      assert.ok(typeof bt.kill.verdict === "string" && bt.kill.verdict.length > 0, k + " 缺 kill verdict");
      if (bt.aux) assert.ok(bt.aux.hot.hitRate >= 0 && bt.aux.hot.hitRate <= 1, k + " aux 越界");
    } else {
      assert.equal(bt.perPos.length, specOf(k).digits, k + " 数字型分位数量");
      for (const r of bt.perPos) {
        for (const f of ["hotRate", "coldRate"]) assert.ok(r[f] >= 0 && r[f] <= 1, k + " " + f + " 越界");
        if (r.killRate !== null) assert.ok(r.killRate >= 0 && r.killRate <= 1, k + " killRate 越界");
      }
    }
  }
});

test("回测：恒定开奖的确定性校验（杜绝未来函数的烟雾测试）", async () => {
  const { backtest } = await import("../src/predict.js");
  // fc3d 恒出 1,2,3：窗口稳定后热号必为 1/2/3，各位 hotRate 应为 1
  const d = Array.from({ length: 30 }, (_, i) => ({ code: String(2026000 + i), digits: ["1", "2", "3"], date: "", src: "t" }));
  const bt = backtest("fc3d", d, { periods: 5, warmup: 10, win: 20 });
  for (const r of bt.perPos) assert.equal(r.hotRate, 1, "恒定开奖下热号应 100% 命中");
  // 样本不足时明确拒绝，而不是编造数字
  const short = backtest("ssq", synth("ssq", 8), { periods: 5 });
  assert.equal(short.periods, 0);
  assert.match(short.note, /样本不足/);
});

test("杀号权重：last 权重清零后其独占号不再出现，分公式名单可用", async () => {
  const { killList, FORMULAS } = await import("../src/predict.js");
  const d = synth("ssq");
  const base = killList("ssq", d);
  const cal = killList("ssq", d, { weights: { last: 0 } });
  for (const m of cal.main) assert.ok(!m.reasons.includes("上期出号"), "last 权重 0 后不应再有上期出号原因");
  const pf = killList("ssq", d, { perFormula: true });
  assert.deepEqual(Object.keys(pf.byFormula).sort(), Object.keys(FORMULAS).sort());
  for (const arr of Object.values(pf.byFormula)) assert.equal(new Set(arr).size, arr.length, "分公式名单重复");
});

test("回测分公式命中率：10 个公式全覆盖，rate 合法", async () => {
  const { backtest, FORMULAS } = await import("../src/predict.js");
  const bt = backtest("ssq", synth("ssq", 60), { periods: 5, warmup: 10, win: 20 });
  assert.equal(bt.kill.formulas.length, Object.keys(FORMULAS).length);
  for (const f of bt.kill.formulas) {
    assert.ok(f.killed >= 0 && f.hit >= 0 && f.hit <= f.killed, f.key + " killed/hit 非法");
    if (f.rate !== null) assert.ok(f.rate >= 0 && f.rate <= 1, f.key + " rate 越界");
    assert.ok(["有效", "无信息", "无样本"].includes(f.verdict), f.key + " verdict 异常");
  }
});

test("calibrate：权重全部落在 [0.2, 2]", async () => {
  const { calibrate } = await import("../src/predict.js");
  const c = calibrate("ssq", synth("ssq", 60), { periods: 5, warmup: 10, win: 20 });
  for (const [k, w] of Object.entries(c.weights)) {
    assert.ok(w >= 0.2 && w <= 2, k + " 权重越界: " + w);
  }
  assert.equal(Object.keys(c.weights).length, 10);
});

test("ticket：胆拖单结构合法，注数等于 C(拖, pick-胆)", async () => {
  const { ticket } = await import("../src/predict.js");
  for (const k of ["ssq", "dlt", "qlc"]) {
    const t = ticket(k, synth(k, 40), { dan: 2, tuo: 6 });
    assert.equal(t.dan.length, 2, k + " 胆数");
    assert.equal(t.tuo.length, 6, k + " 拖数");
    assert.ok(t.dan.every(x => !t.tuo.includes(x)), k + " 胆拖重叠");
    const pick = specOf(k).main.pick;
    const expect = t.tuo.length >= pick - 2 ? C2(t.tuo.length, pick - 2) : 0;
    assert.equal(t.bets, expect, k + " 注数");
    assert.ok(t.amount === t.bets * 2, k + " 金额");
    assert.ok(t.note.length > 0, k);
  }
  // kl8 / 数字型明确拒绝并给替代指引
  for (const k of ["kl8", "fc3d", "pl5", "qxc"]) {
    const t = ticket(k, synth(k, 40));
    assert.ok(/无标准胆拖/.test(t.note), k + " 应拒绝胆拖");
  }
});
function C2(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - i + 1)) / i; return Math.round(r); }

test("analyzeAll：双色球蓝球转移矩阵口径正确", async () => {
  const { analyzeAll } = await import("../src/predict.js");
  const d = synth("ssq", 40);
  const a = analyzeAll("ssq", d, 30);
  const tr = a.auxTransition;
  assert.ok(tr && tr.from !== null, "缺转移矩阵");
  assert.equal(tr.from, d[0].blue, "from 应为最新一期蓝球");
  assert.ok(tr.total === 29, "转移样本应为窗口期数-1");
  assert.ok(tr.top.length > 0, "转移矩阵不应为空（有 fallback 兜底）");
  for (const t of tr.top) { assert.ok(t.count >= 1 && t.count <= tr.total, "转移计数越界"); }
  assert.ok(tr.top.length <= 6);
});

test("ticket：缺省参数用引擎默认拖数（dlt=6），不被钳位", async () => {
  const { ticket } = await import("../src/predict.js");
  const t = ticket("dlt", synth("dlt", 40));
  assert.equal(t.danCount, 2);
  assert.equal(t.tuoCount, 6, "dlt 默认拖数应为 pick-胆+3=6");
  const t2 = ticket("qlc", synth("qlc", 40));
  assert.equal(t2.tuoCount, 8, "qlc 默认拖数应为 8");
});

test("filter=1：全部推荐的和值/跨度落在合理形态区", async () => {
  const { recommendAll, specOf } = await import("../src/predict.js");
  const r = recommendAll("ssq", synth("ssq", 60), { win: 30, filter: true });
  const s = specOf("ssq");
  const ideal = s.main.pick * (s.main.min + s.main.max) / 2;
  const tol = s.main.pick * (s.main.max - s.main.min) / 6;
  for (const p of r.picks) {
    assert.ok(typeof p.sum === "number" && typeof p.span === "number", "缺和值/跨度");
    assert.ok(Math.abs(p.sum - ideal) <= tol * 1.3, "和值越界: " + p.sum);
    assert.ok(p.span >= (s.main.max - s.main.min) * 0.5 && p.span <= (s.main.max - s.main.min) * 0.98, "跨度越界: " + p.span);
  }
});

// ---------- v0.10.0：统计显著性 / holdout 外推 / 分年稳定性 / 形态转移 ----------

test("binomP：样本不足返回 null，显著偏离给小 p，贴基线给大 p", () => {
  assert.equal(binomP(1, 10, 0.2), null, "n<20 应为 null");
  assert.equal(binomP(10, 20, 0), null, "p0 无效应为 null");
  const p1 = binomP(2, 100, 0.2);   // 2% vs 20%，强烈偏低
  const p2 = binomP(20, 100, 0.2);  // 正好等于基线
  assert.ok(p1 !== null && p1 < 0.01, "强偏离应显著: " + p1);
  assert.ok(p2 !== null && p2 > 0.5, "贴基线应不显著: " + p2);
});

test("backtest 输出 p 值与 eras 分年桶", () => {
  const draws = synth("ssq", 120);
  for (const d of draws) d.date = "2026-05-0" + (1 + (Number(d.code) % 9)); // 全部归 2026
  const bt = backtest("ssq", draws, { periods: 40, warmup: 30, win: 30 });
  assert.ok(bt.strategies && typeof bt.strategies.hot.p === "number", "hot 缺 p 值");
  assert.ok(typeof bt.kill.p === "number", "kill 缺 p 值");
  assert.ok(Array.isArray(bt.eras) && bt.eras.length >= 1, "缺 eras");
  const sumTested = bt.eras.reduce((a, b) => a + b.tested, 0);
  assert.equal(sumTested, bt.tested, "eras 测试点数应等于 tested");
  assert.ok(bt.eras.every(e => e.era === "2026"), "era 归桶错误");
  for (const e of bt.eras) {
    assert.ok(e.hotRate >= 0 && e.hotRate <= 1, "hotRate 越界");
    assert.ok(e.killRate === null || (e.killRate >= 0 && e.killRate <= 1), "killRate 越界");
  }
});

test("backtest 接受 weights 且不崩（加权杀号可被回测）", () => {
  const draws = synth("ssq", 80);
  const cal = calibrate("ssq", draws.slice(20), { periods: 10 });
  const bt = backtest("ssq", draws, { periods: 30, warmup: 30, win: 30, weights: cal.weights });
  assert.ok(bt.kill && typeof bt.kill.hitRate === "number", "加权回测缺 kill.hitRate");
  assert.ok(Object.keys(cal.weights).length > 0, "calibrate 未产出权重");
  for (const w of Object.values(cal.weights)) assert.ok(w >= 0.2 && w <= 2, "权重越界: " + w);
});

test("calibrate holdout：旧段拟合 / 新段外推，输出 calibrated vs raw", () => {
  const draws = synth("ssq", 200);
  const c = calibrate("ssq", draws, { periods: 12, holdout: 0.3 });
  assert.ok(c.holdout && c.holdout.calibrated && c.holdout.raw, "缺 holdout 块");
  assert.ok(c.holdout.evalN >= 20, "新段应 ≥20 期");
  assert.ok(c.holdout.calibrated.hitRate >= 0 && c.holdout.calibrated.hitRate <= 1, "calibrated.hitRate 越界");
  assert.ok(c.holdout.raw.hitRate >= 0 && c.holdout.raw.hitRate <= 1, "raw.hitRate 越界");
  assert.equal(c.holdout.calibrated.baseline, c.holdout.raw.baseline, "两段基线应一致");
  // 样本不足时的降级路径：给说明而非崩溃
  const small = calibrate("ssq", synth("ssq", 40), { periods: 12, holdout: 0.3 });
  assert.ok(small.holdout && small.holdout.note, "小样本应给说明");
  // 数字型：holdout 不适用，给说明
  const dg = calibrate("fc3d", synth("fc3d", 200), { holdout: 0.3 });
  assert.ok(dg.holdout && dg.holdout.note, "数字型应给说明");
});

test("shapeTrans：确定性交替数据的转移矩阵与 next 概率", () => {
  // 构造奇偶交替序列：上一期「偏奇」→ 下一期「偏偶」应 100% 出现（平滑后 <1 但必须是 top1）
  const draws = [];
  for (let i = 0; i < 60; i++) {
    const oddPick = i % 2 === 0 ? ["01", "03", "05", "07"] : ["02", "04", "06", "08"];
    draws.push({ code: String(2026000 + i), date: "", red: [...oddPick, "10", "12"], blue: "07", src: "synth" });
  }
  const st = shapeTrans("ssq", draws.slice().reverse()); // 引擎入参是新→旧
  assert.equal(st.kind, "ssq");
  assert.ok(st.odd && st.odd.matrix, "缺 odd 矩阵");
  assert.ok(st.odd.next.length >= 1 && st.odd.next[0].p > 0 && st.odd.next[0].p <= 1, "next 概率越界");
  // 最后一期 i=59 → 红球 02/04/06/08（0 奇）→「偏偶」；下一期 i=60 应是「偏奇」
  assert.equal(st.odd.last, "偏偶", "last 形态判错");
  assert.equal(st.odd.next[0].shape, "偏奇", "交替模式未学到");
  const psum = st.odd.next.reduce((a, b) => a + b.p, 0);
  assert.ok(psum <= 1.001, "next 概率和应 ≤1: " + psum);
  // 数字型降级：给说明
  const dg = shapeTrans("fc3d", synth("fc3d", 20));
  assert.ok(dg.note, "数字型应给说明");
});
