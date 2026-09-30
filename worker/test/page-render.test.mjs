// 页面渲染契约：用后端真实产出的响应形状，喂进前端真正的渲染函数，断言渲染得出来。
//
// 这一层抓的是「200 OK 但页面是空的」—— 对彩票工具是最坏的一类 bug：用户看到一排空标签、
// 一张白图，却没有任何报错。v0.15.5 的分析页事故（4 个数字型彩种整页空白）就是这类。
//
// 为什么不直接对着线上打：测试必须离线可跑。所以这里用 analyzeAll / SPECS 现场造出
// 与线上同构的响应（字段名一律取自 SPECS.fMain / fAux，不手写），再喂前端函数。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { SPECS, analyzeAll, shapeTrans, poolOf, posPool, mainOf } from "../src/predict.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const KINDS = Object.keys(SPECS);
const POOL = KINDS.filter(k => SPECS[k].type === "pool");
const DIGIT = KINDS.filter(k => SPECS[k].type === "digit");

function stubEl() {
  return new Proxy(function () {}, {
    get: (t, p) => (p === "value" ? "" : p === "toString" ? () => "" : stubEl()),
    apply: () => stubEl(), set: () => true,
  });
}
function loadFrontend() {
  const html = fs.readFileSync(path.join(ROOT, "frontend", "index.html"), "utf8");
  const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "frontend/index.html 里找不到内联脚本（结构变了要同步这个测试）");
  const ctx = vm.createContext({
    document: stubEl(), navigator: {}, location: { protocol: "http:", href: "http://localhost/" },
    localStorage: stubEl(), fetch: () => stubEl(), console, setTimeout, encodeURIComponent,
    JSON, Math, Date, RegExp, Number, Array, Object, String, parseInt, isNaN, addEventListener: () => {},
  });
  vm.runInContext(m[1] +
    "\n;globalThis.__fn = { renderNums, balls, analyzePoolText, analyzeDigitText, sourceBanner, tkText };", ctx);
  return ctx.__fn;
}
const FN = loadFrontend();

// 造 n 期，字段名全部来自 SPECS —— 手写字段名是这个测试最容易假绿的地方
function synthDraws(kind, n) {
  const s = SPECS[kind], out = [];
  for (let i = 0; i < n; i++) {
    const d = { code: String(2026000 + i), date: "2026-01-01" };
    if (s.type === "pool") {
      const mp = poolOf(s.main);
      d[s.fMain] = Array.from({ length: s.main.pick }, (_, j) => mp[(i * s.main.pick + j) % mp.length]);
      if (s.aux) { const ap = poolOf(s.aux); d[s.fAux] = Array.from({ length: s.aux.pick }, (_, j) => ap[(i * s.aux.pick + j) % ap.length]); }
    } else {
      d[s.fMain] = Array.from({ length: s.digits }, (_, p) => { const pl = posPool(kind, p); return pl[(i * 7 + p * 3) % pl.length]; });
    }
    out.push(d);
  }
  return out;
}
const analyzeResp = (kind, draws) => {
  const an = analyzeAll(kind, draws, 30);
  return { kind, ...an, shape: shapeTrans(kind, draws, { window: 40 }), sources: ["500"] };
};

test("历史页：8 个彩种的每一行都渲染出号码（renderNums 不得返回空串）", () => {
  for (const kind of KINDS) {
    const d = synthDraws(kind, 1)[0];
    const html = FN.renderNums(d);
    const s = SPECS[kind];
    assert.ok(html && html.trim().length > 0,
      `${kind} 历史页号码列渲染为空（行字段 = ${Object.keys(d).filter(x => x !== "date" && x !== "code").join(",")}）`);
    assert.match(html, /class="ball/, `${kind} 渲染结果里没有号码球元素`);
    const expect = s.type === "pool" ? s.main.pick : s.digits;
    // 只数主号码球：balls(arr) 产出 class="ball "（带尾空格），副区是 class="ball b"
    const balls = (html.match(/class="ball "/g) || []).length;
    assert.equal(balls, expect, `${kind} 应渲染 ${expect} 个主号码，实际 ${balls}`);
    // 有副区的彩种，副区也必须出现在页面上
    if (s.aux) {
      const auxBalls = s.fAux ? FN.balls(Array.isArray(d[s.fAux]) ? d[s.fAux] : [d[s.fAux]], "b") : "";
      assert.ok(auxBalls.length > 0, `${kind} 有副区但副区渲染为空`);
    }
  }
});

test("分析页：号码池型 4 个彩种渲染出的统计文字没有空字段", () => {
  for (const kind of POOL) {
    const an = analyzeResp(kind, synthDraws(kind, 40));
    const t = FN.analyzePoolText(an);
    assert.ok(t.length > 100, `${kind} 分析文字过短：${t.length} 字符`);
    // 逐项确认：标签后面必须有实际值，不能是「undefined」或「 NaN」或空
    for (const label of ["热号", "冷号", "奇偶比", "大小比", "质合比", "均和", "平均AC", "平均连号", "平均重号", "012路", "区间分布", "历史最大遗漏"]) {
      const i = t.indexOf(label);
      assert.ok(i >= 0, `${kind} 分析文字缺「${label}」`);
      const after = t.slice(i + label.length, i + label.length + 12).trim();
      assert.ok(after.length > 0, `${kind} 的「${label}」后面是空的`);
      assert.doesNotMatch(after, /undefined|NaN|\bnull\b/, `${kind} 的「${label}」渲染出 ${after.trim()}`);
    }
    assert.doesNotMatch(t, /undefined|NaN/, `${kind} 分析文字里出现 undefined/NaN`);
  }
});

test("分析页：数字型 4 个彩种每一位都渲染出内容（不得出现「第 N 位」后面空白）", () => {
  for (const kind of DIGIT) {
    const an = analyzeResp(kind, synthDraws(kind, 40));
    const t = FN.analyzeDigitText(an);
    assert.ok(t.length > 60, `${kind} 分析文字过短：${t.length} 字符`);
    assert.doesNotMatch(t, /undefined|NaN/, `${kind} 分析文字里出现 undefined/NaN`);
    for (const p of an.perPos) {
      // 先剥掉 HTML 标签再匹配：「第 N 位」与「热」之间隔着 </b>
      const plain = t.replace(/<[^>]*>/g, '');
      const re = new RegExp(`第 ${p.pos} 位\\s+热 \\S+\\s+冷 \\S+`);
      assert.match(plain, re, `${kind} 第 ${p.pos} 位的「热/冷」渲染为空`);
      const re2 = new RegExp(`第 ${p.pos} 位[\\s\\S]*?高频 \\S+`);
      assert.match(plain, re2, `${kind} 第 ${p.pos} 位的「高频」渲染为空`);
    }
    assert.match(t, /平均和值/, `${kind} 缺「平均和值」`);
    assert.match(t, /平均大数个数/, `${kind} 缺「平均大数个数」`);
    if (SPECS[kind].digits === 3) assert.match(t, /组三/, `fc3d/pl3 应显示组三/组六/豹子形态统计`);
    // 号码池专属字段不该出现在数字型文字里（v0.15.5 的事故就是渲染了这些却全是 undefined）
    for (const w of ["平均AC", "质合比", "区间分布", "012路"]) {
      assert.doesNotMatch(t, new RegExp(w), `数字型 ${kind} 文字里不该出现号码池字段「${w}」`);
    }
  }
});

test("分析页：数字型文字与号码池型文字不能互相串味（防止又用错字段）", () => {
  // 号码池响应喂给数字型渲染器 → 应该渲染出空/极少，而不是「看起来正常」
  const ssq = analyzeResp("ssq", synthDraws("ssq", 40));
  const poolText = FN.analyzePoolText(ssq);
  assert.match(poolText, /平均AC/, "号码池文字应含平均AC");
  assert.doesNotMatch(poolText, /第 1 位/, "号码池文字不该有按位标题");

  const fc3d = analyzeResp("fc3d", synthDraws("fc3d", 40));
  const digitText = FN.analyzeDigitText(fc3d);
  assert.match(digitText, /第 1 位/, "数字型文字应含按位标题");
  assert.doesNotMatch(digitText, /平均AC/, "数字型文字不该含平均AC");
});

test("数据来源横幅：mock 必须报警，单源必须说明未经交叉校验", () => {
  const mock = FN.sourceBanner({ count: 1, sources: ["mock"] });
  assert.match(mock, /当前不是真实开奖数据/, "mock 未报警");
  assert.match(mock, /不成立|勿据此/, "mock 报警文案应说明下面数字不成立");

  const single = FN.sourceBanner({ count: 30, sources: ["500"] });
  assert.match(single, /未经第二源交叉校验/, "单源未说明未经交叉校验");

  const dual = FN.sourceBanner({ count: 30, sources: ["500", "17500"] });
  assert.match(dual, /双源已交叉校验/, "双源应显示已交叉校验");
  assert.doesNotMatch(dual, /未经第二源/, "双源不该再显示未经交叉校验");

  // 数字型/降级彩种的来源标签也要能显示
  assert.match(FN.sourceBanner({ count: 30, sources: ["d1"] }), /d1/, "降级读 D1 的来源标签未显示");
});

test("胆拖单导出文本：8 个彩种都带免责声明与注数（分享出去脱离页面上下文）", () => {
  for (const kind of KINDS) {
    const s = SPECS[kind];
    const nums = s.type === "pool" ? poolOf(s.main).slice(0, s.main.pick) : Array.from({ length: s.digits }, (_, p) => posPool(kind, p)[0]);
    const r = { name: s.name, dan: [nums[0]], tuo: nums.slice(1), aux: s.aux ? (Array.isArray(s.aux) ? s.aux : [poolOf(s.aux)[0]]) : [], bets: 2, amount: 4 };
    const t = FN.tkText(r);
    assert.match(t, /仅供娱乐，不保证中奖/, `${kind} 导出文本缺免责声明`);
    assert.match(t, /注数: \d+ 注/, `${kind} 导出文本缺注数`);
  }
});

test("mainOf 与 SPECS 字段名一致（防用例自身写错而假绿）", () => {
  for (const kind of KINDS) {
    const d = synthDraws(kind, 1)[0];
    const got = mainOf(d, kind);
    assert.equal(got.length, SPECS[kind].type === "pool" ? SPECS[kind].main.pick : SPECS[kind].digits,
      `${kind} mainOf 读不出正确个数（字段名对不上 SPECS）`);
  }
});