import { test } from "node:test";
import assert from "node:assert/strict";
import { pad2 } from "../src/small.js";
import { SPECS, specOf, mainOf, auxOf, analyzeAll, killList, danList, recommendAll, structScore, acValue } from "../src/predict.js";

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
