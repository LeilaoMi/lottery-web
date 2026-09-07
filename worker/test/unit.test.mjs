import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normNums, pad2, prizeSSQ, prizeDLT, prizeQLC, rotation, verifyCoverage } from "../src/small.js";
import { valid, norm, normCode, analyze, blueScores, verify, trend, parse17500 } from "../src/ssq.js";
import { validDLT, normDLT, verifyDLT, analyzeDLT } from "../src/dlt.js";

// 构造确定性样本：index 0 为最新一期
function mkDraws(n = 40) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const red = new Set();
    let seed = i * 7919 + 13;
    while (red.size < 6) { seed = (seed * 1103515245 + 12345) % 2147483648; red.add((seed % 33) + 1); }
    out.push({
      code: String(2026000 + n - i),
      red: [...red].sort((a, b) => a - b).map(pad2),
      blue: pad2((i % 16) + 1),
      date: "2026-01-01",
      src: "test"
    });
  }
  return out;
}

describe("号码归一化", () => {
  test("补零并去空格", () => {
    assert.deepEqual(normNums(["1", "02", " 3 ", ""]), ["01", "02", "03"]);
    assert.equal(pad2(7), "07");
  });
});

describe("双色球数据校验", () => {
  const ok = { code: "2026103", red: ["01", "02", "03", "04", "05", "06"], blue: "16" };
  test("合法样本通过", () => assert.equal(valid(ok), true));
  test("红球重复被拒", () => assert.equal(valid({ ...ok, red: ["01", "01", "03", "04", "05", "06"] }), false));
  test("红球越界被拒", () => assert.equal(valid({ ...ok, red: ["01", "02", "03", "04", "05", "34"] }), false));
  test("蓝球越界被拒", () => assert.equal(valid({ ...ok, blue: "17" }), false));
  test("期号格式非法被拒", () => assert.equal(valid({ ...ok, code: "123" }), false));
  test("norm 统一补零", () => assert.deepEqual(norm({ code: "2026103", red: [1, 2, 3, 4, 5, 6], blue: 7 }).red, ["01", "02", "03", "04", "05", "06"]));
  test("期号归一化：500 的 5 位期号补全为 7 位", () => {
    assert.equal(normCode("26103"), "2026103");
    assert.equal(normCode("2026103"), "2026103");
    assert.equal(norm({ code: "26103", red: [1, 2, 3, 4, 5, 6], blue: 7 }).code, "2026103");
  });
  test("验奖可用 5 位或 7 位期号", () => {
    const draws = [{ code: "2026103", red: ["01", "02", "03", "04", "05", "06"], blue: "07", date: "", src: "t" }];
    assert.equal(verify(draws, "26103", ["01"], "07").hit, true);
    assert.equal(verify(draws, "2026103", ["01"], "07").hit, true);
  });
});

describe("17500 文本解析（回归：旧实现漏掉日期列，红蓝整体错位一列且取到 2003 年老数据）", () => {
  const fixture = [
    "2003001 2003-02-23 10 11 12 13 26 28 11 26 28 11 13 10 12 0 0 0 0 0",
    "2026102 2026-09-03 03 04 10 13 16 25 09 16 10 04 13 25 03 335960988 782244968",
    "2026103 2026-09-06 04 11 20 27 28 30 15 11 04 20 30 27 28 362416068 805259723"
  ].join("\n");
  test("红球/蓝球/日期列定位正确", () => {
    const d = parse17500(fixture, 10);
    assert.equal(d.length, 3);
    const top = d[0];
    assert.equal(top.code, "2026103", "应取到最新一期而非 2003 年数据");
    assert.deepEqual(top.red, ["04", "11", "20", "27", "28", "30"]);
    assert.equal(top.blue, "15");
    assert.equal(top.date, "2026-09-06");
  });
  test("结果按最新在前排序", () => {
    const d = parse17500(fixture, 10);
    assert.deepEqual(d.map(x => x.code), ["2026103", "2026102", "2003001"]);
  });
});

describe("大乐透数据校验", () => {
  const ok = { code: "26101", front: ["01", "02", "03", "04", "05"], back: ["01", "12"] };
  test("合法样本通过", () => assert.equal(validDLT(ok), true));
  test("前区越界被拒", () => assert.equal(validDLT({ ...ok, front: ["01", "02", "03", "04", "36"] }), false));
  test("后区越界被拒", () => assert.equal(validDLT({ ...ok, back: ["01", "13"] }), false));
  test("normDLT 统一补零", () => assert.equal(normDLT({ code: "26101", front: [1, 2, 3, 4, 5], back: [1, 12] }).back[0], "01"));
});

describe("奖级规则", () => {
  test("双色球六档", () => {
    assert.equal(prizeSSQ(6, true), "一等");
    assert.equal(prizeSSQ(6, false), "二等");
    assert.equal(prizeSSQ(5, true), "三等");
    assert.equal(prizeSSQ(5, false), "四等");
    assert.equal(prizeSSQ(4, true), "四等");
    assert.equal(prizeSSQ(4, false), "五等");
    assert.equal(prizeSSQ(3, true), "五等");
    assert.equal(prizeSSQ(2, true), "六等");
    assert.equal(prizeSSQ(0, true), "六等");
    assert.equal(prizeSSQ(0, false), "未中");
  });
  test("大乐透九档（回归：旧代码把 4+2 错判为三等）", () => {
    assert.equal(prizeDLT(5, 2), "一等");
    assert.equal(prizeDLT(5, 1), "二等");
    assert.equal(prizeDLT(5, 0), "三等");
    assert.equal(prizeDLT(4, 2), "四等");
    assert.equal(prizeDLT(4, 1), "五等");
    assert.equal(prizeDLT(3, 2), "六等");
    assert.equal(prizeDLT(4, 0), "七等");
    assert.equal(prizeDLT(3, 1), "八等");
    assert.equal(prizeDLT(2, 2), "八等");
    assert.equal(prizeDLT(0, 2), "九等");
    assert.equal(prizeDLT(1, 2), "九等");
    assert.equal(prizeDLT(0, 0), "未中");
  });
  test("七乐彩七档", () => {
    assert.equal(prizeQLC(7, false), "一等");
    assert.equal(prizeQLC(6, true), "二等");
    assert.equal(prizeQLC(6, false), "三等");
    assert.equal(prizeQLC(4, true), "六等");
    assert.equal(prizeQLC(4, false), "七等");
    assert.equal(prizeQLC(3, false), "未中");
  });
});

describe("验奖输入归一化（回归：旧代码输入 1 匹配不到 01）", () => {
  const draws = [{ code: "2026103", red: ["01", "02", "03", "04", "05", "06"], blue: "07", date: "", src: "test" }];
  test("双色球：短写号码可以命中", () => {
    const r = verify(draws, "2026103", ["1", "2", "3", "4", "5", "6"], "7");
    assert.equal(r.hit, true);
    assert.equal(r.hitRed, 6);
    assert.equal(r.hitBlue, true);
  });
  test("双色球：期号不存在时给出提示", () => assert.equal(verify(draws, "9999999", ["01"], "01").hit, false));
  test("大乐透：短写号码可以命中", () => {
    const d = [{ code: "26101", front: ["01", "02", "03", "04", "05"], back: ["06", "07"], date: "", src: "test" }];
    const r = verifyDLT(d, "26101", ["1", "2", "3", "4", "5"], ["6", "7"]);
    assert.equal(r.hitFront, 5);
    assert.equal(r.hitBack, 2);
  });
});

describe("统计分析", () => {
  const draws = mkDraws(40);
  const an = analyze(draws, 30);
  test("基础字段齐备", () => {
    assert.equal(an.count, 30);
    assert.equal(an.hotRed.length, 6);
    assert.equal(an.coldRed.length, 6);
    assert.equal(Object.keys(an.redFreq).length, 33, "红球频次应覆盖全部 33 个号");
    assert.equal(typeof an.avgSum, "number");
  });
  test("新增维度可用（AC / 012路 / 质合 / 尾数 / 连号 / 重号）", () => {
    assert.equal(typeof an.avgAC, "number");
    assert.equal(an.road012["0"] + an.road012["1"] + an.road012["2"], 30 * 6);
    assert.match(an.primeRatio, /^\d+:\d+$/);
    assert.equal(typeof an.avgConsec, "number");
    assert.equal(typeof an.avgRepeat, "number");
    assert.ok(Object.keys(an.tail).length > 0);
  });
  test("遗漏统计覆盖 33 个红球", () => {
    assert.equal(Object.keys(an.omission.cur).length, 33);
    assert.equal(Object.keys(an.omission.avg).length, 33);
    assert.equal(Object.keys(an.omission.max).length, 33);
  });
  test("冷热号按频次排序且互不相同", () => {
    const f = an.redFreq;
    assert.ok(f[an.hotRed[0]] >= f[an.coldRed[0]]);
    assert.equal(new Set([...an.hotRed, ...an.coldRed]).size, 12);
  });
  test("蓝球评分无 NaN 且覆盖 16 个号", () => {
    const bl = blueScores(draws);
    assert.equal(Object.keys(bl.scores).length, 16);
    assert.ok(Object.values(bl.scores).every(v => Number.isFinite(v)), "不应出现 NaN");
    assert.match(bl.top1, /^\d{2}$/);
    assert.equal(bl.ranked.length, 16);
  });
  test("趋势遗漏表结构正确", () => {
    const t = trend(draws, 10);
    assert.equal(t.length, 10);
    assert.equal(Object.keys(t[0].miss).length, 33);
  });
  test("大乐透分析可用", () => {
    const d = [
      { code: "26101", front: ["01", "02", "03", "04", "05"], back: ["01", "02"], date: "", src: "t" },
      { code: "26100", front: ["01", "06", "07", "08", "09"], back: ["03", "04"], date: "", src: "t" }
    ];
    const a = analyzeDLT(d, 30);
    assert.equal(a.hotFront[0], "01");
    assert.equal(a.count, 2);
  });
});

describe("旋转矩阵（覆盖设计）", () => {
  test("C(10,6,3) 达到 100% 覆盖", () => {
    const r = rotation(10, 6, 3);
    assert.equal(r.minHit, 3);
    assert.equal(r.guaranteed, true, "应覆盖全部 3 号组合");
    assert.equal(verifyCoverage(10, 3, r.combos).ok, true);
  });
  test("C(12,6,4) 达到 100% 覆盖", () => {
    const r = rotation(12, 6, 4);
    assert.equal(r.guaranteed, true);
    assert.equal(verifyCoverage(12, 4, r.combos).ok, true);
    assert.ok(r.blocks <= 200);
  });
  test("minHit 真正参与计算（回归：旧实现该参数被忽略）", () => {
    const a = rotation(10, 6, 3), b = rotation(10, 6, 4);
    assert.equal(a.totalT, 120, "C(10,3)=120");
    assert.equal(b.totalT, 210, "C(10,4)=210");
    assert.notEqual(a.combos.length, b.combos.length);
  });
  test("每注号码合法且互不重复", () => {
    const r = rotation(12, 6, 4);
    const seen = new Set();
    for (const c of r.combos) {
      assert.equal(c.length, 6);
      assert.equal(new Set(c).size, 6);
      seen.add(c.join(","));
    }
    assert.equal(seen.size, r.combos.length, "不应产生重复注");
  });
  test("大 n 走随机采样且不崩", () => {
    const r = rotation(33, 6, 4, 20);
    assert.equal(r.sampled, true);
    assert.ok(r.blocks <= 20);
    assert.ok(r.note.includes("贪心近似") || r.note.includes("覆盖设计"));
  });
  test("规模过大时返回错误而非卡死", () => {
    const r = rotation(33, 6, 5);
    assert.ok(r.error, "C(33,5) 超过上限应报错");
  });
});
