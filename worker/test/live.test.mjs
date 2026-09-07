// 真实数据源连通性测试（需要联网，默认不跑：`npm run test:live`）
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchSmall } from "../src/small.js";
import { fetch500, fetch17500, valid, norm } from "../src/ssq.js";
import { fetchDLT, fetch17500DLT, validDLT, normDLT } from "../src/dlt.js";

const T = { timeout: 60000 };

describe("小彩种数据源 17500", () => {
  for (const kind of ["fc3d", "pl3", "pl5", "qlc", "qxc", "kl8"]) {
    test(`${kind} 可拉取且结构正确`, T, async () => {
      const d = await fetchSmall(kind, 5);
      assert.ok(d.length > 0, `${kind} 应至少返回 1 条`);
      const x = d[0];
      assert.match(x.code, /^\d{4,8}$/);
      if (["fc3d", "pl3", "pl5", "qxc"].includes(kind)) {
        assert.ok(Array.isArray(x.digits) && x.digits.length > 0, `${kind} 应有 digits`);
      } else if (kind === "qlc") {
        assert.equal(x.main.length, 7, "七乐彩应为 7 个基本号");
        assert.match(x.special, /^\d{2}$/);
        assert.ok(!x.main.includes(x.special), "特别号不应与基本号重复");
      } else {
        assert.equal(x.nums.length, 20, "快乐8 应为 20 个号");
      }
    });
  }
});

describe("双色球数据源", () => {
  test("500.com 可拉取且校验通过", T, async () => {
    const d = await fetch500(10);
    assert.ok(d.length > 0);
    assert.ok(d.every(valid), "500 返回应全部通过校验");
  });
  test("17500 备用源可拉取且校验通过", T, async () => {
    const d = await fetch17500();
    assert.ok(d.length > 0);
    assert.ok(d.every(valid), "17500 返回应全部通过校验");
  });
  test("双源最新一期一致（交叉验证列解析是否正确）", T, async () => {
    const a = (await fetch500(3)).map(norm);
    const b = (await fetch17500(3)).map(norm);
    assert.ok(a.length && b.length);
    assert.equal(a[0].code, b[0].code, "两源最新期号应一致");
    assert.deepEqual(a[0].red, b[0].red, "两源最新红球应一致");
    assert.equal(a[0].blue, b[0].blue, "两源最新蓝球应一致");
  });
});

describe("大乐透数据源", () => {
  test("500.com 可拉取且校验通过", T, async () => {
    const d = await fetchDLT(10);
    assert.ok(d.length > 0);
    assert.ok(d.every(validDLT));
  });
  test("17500 备用源可拉取且校验通过", T, async () => {
    const d = await fetch17500DLT();
    assert.ok(d.length > 0);
    assert.ok(d.every(validDLT));
  });
  test("双源最新一期一致", T, async () => {
    const a = (await fetchDLT(3)).map(normDLT);
    const b = (await fetch17500DLT()).slice(0, 3).map(normDLT);
    assert.ok(a.length && b.length);
    assert.equal(a[0].code, b[0].code, "两源最新期号应一致");
    assert.deepEqual(a[0].front, b[0].front, "两源前区应一致");
    assert.deepEqual(a[0].back, b[0].back, "两源后区应一致");
  });
});
