// crossCheck 是落库前的唯一防线：它判出来的冲突期号会被直接拒绝写入 D1。
// 换成 17500 对等源之后这条防线第一次真正起作用（此前快层常年只剩 1 个源，压根没跑过），
// 所以必须证明「它判出的冲突集」与暴力逐期比对完全一致 —— 判错的后果是好数据被丢、或坏数据被放行。
import { test } from "node:test";
import assert from "node:assert/strict";
import { crossCheck } from "../src/index.js";
import { normCode } from "../src/ssq.js";

const pair = d => [d.red || d.front || d.main || d.digits, d.blue || d.back || d.special || d.nums];
const ssq = (code, reds, blue) => ({ code, red: reds, blue });

// 暴力实现：不做 Map 对齐、不截 b 的窗口，只按「a 的前 n 期」逐个线性找
function brute(a, b, n) {
  const out = [];
  for (const d of a.slice(0, n)) {
    const o = b.find(x => String(x.code) === String(d.code));
    if (!o) continue;
    if (JSON.stringify(pair(d)) !== JSON.stringify(pair(o))) out.push(String(d.code));
  }
  return out;
}

test("crossCheck ≡ 暴力逐期比对（随机数据，冲突集必须逐项相同）", () => {
  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const mk = (n, mutate) => Array.from({ length: n }, (_, i) => {
    const reds = Array.from({ length: 6 }, () => String(1 + Math.floor(rnd() * 33)).padStart(2, "0")).sort();
    return ssq("2026" + (1000 + i), reds, String(1 + Math.floor(rnd() * 16)).padStart(2, "0"));
  });
  for (let trial = 0; trial < 40; trial++) {
    const a = mk(40);
    const b = mk(40);
    // 随机把 b 的若干期改成与 a 冲突 / 一致，制造真实的冲突与缺期
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(rnd() * 40);
      if (!b[i]) continue;
      if (rnd() < 0.6) b[i] = { ...b[i], red: a[i].red.slice(), blue: a[i].blue }; // 改成一致
      else b[i] = { ...b[i], blue: String(1 + Math.floor(rnd() * 16)).padStart(2, "0") }; // 改成冲突
    }
    for (let n of [5, 30]) {
      const got = crossCheck(a, b, n).mismatch;
      const want = brute(a, b, n);
      assert.deepEqual(got, want, `n=${n} 第 ${trial} 组不一致：crossCheck=${JSON.stringify(got)} 暴力=${JSON.stringify(want)}`);
    }
  }
});

test("crossCheck：红球或蓝球任一不同都算冲突；完全相同不算", () => {
  const a = [
    ssq("2026003", ["01", "02", "03", "04", "05", "06"], "07"),
    ssq("2026002", ["02", "04", "06", "08", "10", "12"], "01"),
    ssq("2026001", ["03", "06", "09", "12", "15", "18"], "02")
  ];
  const b = [
    ssq("2026003", ["01", "02", "03", "04", "05", "06"], "07"),
    ssq("2026002", ["02", "04", "06", "08", "10", "13"], "01"),
    ssq("2026001", ["03", "06", "09", "12", "15", "18"], "05")
  ];
  const r = crossCheck(a, b, 30);
  assert.equal(r.checked, 3, "三期都能对上");
  assert.deepEqual(r.mismatch, ["2026002", "2026001"], "红球不同与蓝球不同都要算冲突");
  assert.deepEqual(brute(a, b, 30), r.mismatch);
});

test("crossCheck：对端缺期不算冲突（缺期不是矛盾，把好数据当坏数据丢才是事故）", () => {
  const a = Array.from({ length: 40 }, (_, i) => ssq("2026" + (1000 + i), ["01", "02", "03", "04", "05", "06"], "07"));
  const b = a.slice(0, 20);
  const r = crossCheck(a, b, 30);
  assert.deepEqual(r.mismatch, [], "对端没有的期号必须 continue，不能判成冲突");
  assert.equal(r.checked, 20, "只比对双方都有的 20 期");
  assert.deepEqual(brute(a, b, 30), r.mismatch);
});

test("crossCheck：窗口外的期号不参与比对（只看最近 n 期）", () => {
  const a = Array.from({ length: 10 }, (_, i) => ssq("2026" + (1000 + i), ["01", "02", "03", "04", "05", "06"], "07"));
  const b = a.map(x => ({ ...x }));
  b[9] = ssq(a[9].code, ["11", "12", "13", "14", "15", "16"], "08"); // 冲突在最旧的一期（a 的下标 9）
  assert.deepEqual(crossCheck(a, b, 30).mismatch, [a[9].code], "n=30 覆盖全部 10 期，冲突被查出");
  assert.deepEqual(crossCheck(a, b, 3).mismatch, [], "n=3 只看 a 的前 3 期（下标 0..2），冲突在下标 9，窗外不参与");
  assert.equal(crossCheck(a, b, 3).checked, 3);
});

test("crossCheck：号型不同型的彩种不得互判（drawPair 归一的是字段名，不是值形状）", () => {
  // dlt 的 back 是数组 ["01","02"]，ssq 的 blue 是标量 "01" —— 同一个期号下形状不同，
  // crossCheck 判成冲突是正确的：它们本来就是不同彩种，拿错源对账时应当拦住。
  const a = [{ code: "26101", front: ["01", "02", "03", "04", "05"], back: ["01", "02"] }];
  const b = [{ code: "26101", red: ["01", "02", "03", "04", "05"], blue: "01" }];
  assert.deepEqual(crossCheck(a, b, 30).mismatch, ["26101"], "号型不同型必须判冲突，不能静默放行");
});

test("crossCheck：期号形态依赖调用方归一（crossCheck 自身按字符串比对期号）", () => {
  // 500.com 给 5 位（26103）、17500 给 7 位（2026103）；两边都经 norm() 归一后才交给 crossCheck。
  // 这条锁住那个前置条件：若哪天有人绕过 norm 直接丢原始期号进来，crossCheck 会静默 checked=0。
  const a = [{ code: normCode("26103"), red: ["01", "02", "03", "04", "05", "06"], blue: "07" }];
  const b = [{ code: normCode("2026103"), red: ["01", "02", "03", "04", "05", "06"], blue: "07" }];
  assert.equal(crossCheck(a, b, 30).checked, 1, "归一后能对上");
  const unnormalized = crossCheck([{ code: "26103", red: a[0].red, blue: "07" }], b, 30);
  assert.equal(unnormalized.checked, 0, "未归一的期号对不上 ⇒ checked=0（静默失效的形态）");
});
