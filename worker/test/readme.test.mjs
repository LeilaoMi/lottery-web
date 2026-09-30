// README 事实核对：README 写的版本 / 目录结构 / 命令口径必须与仓库实际一致。
//
// README 是这个项目唯一对外的门面，它一旦开始说谎，读者就按错的预期用站点。
// 历史上它落后过好几轮（测试数、目录结构、交叉校验的对等源都写着旧值），而这类腐烂没有任何
// 测试会发现 —— 所以补这一层。
//
// 用例数/版本号这类**数字**不在这里核对，而是由 scripts/check-readme.mjs 真跑一次
// node --test 拿权威件数再对账：正则数 `test(` 靠不住（live.network.mjs 在 describe+for 里
// 生成用例，源码 7 处实际 12 个），而在用例里再跑 node --test 会把自己递归进去。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const README = () => read("README.md");
const pkg = JSON.parse(read("worker/package.json"));

test("README：版本徽章必须与 package.json / wrangler.toml / /health 兜底一致", () => {
  const md = README();
  const v = /version-(\d+\.\d+\.\d+)-blue/.exec(md);
  assert.ok(v, "README 缺 version 徽章");
  assert.equal(v[1], pkg.version, `README 徽章 ${v[1]} ≠ package.json ${pkg.version}`);
  const toml = /VERSION\s*=\s*"([\d.]+)"/.exec(read("worker/wrangler.toml"));
  assert.ok(toml, "wrangler.toml 缺 VERSION");
  assert.equal(toml[1], pkg.version, `wrangler.toml ${toml[1]} ≠ package.json ${pkg.version}`);
  const health = /env\.VERSION \|\| "([\d.]+)"/.exec(read("worker/src/index.js"));
  assert.ok(health, "index.js 的 /health 缺版本兜底");
  assert.equal(health[1], pkg.version, `/health 兜底 ${health[1]} ≠ package.json ${pkg.version}`);
  // CI 的两处版本门禁也要跟着走，否则部署验证会拿旧值当期望
  const gates = [...read(".github/workflows/sync.yml").matchAll(/EXPECT_VERSION:\s*([\d.]+)/g)].map(m => m[1]);
  assert.equal(gates.length, 2, `CI 应有 2 处 EXPECT_VERSION，实际 ${gates.length}`);
  for (const g of gates) assert.equal(g, pkg.version, `CI 门禁 ${g} ≠ package.json ${pkg.version}`);
});

test("README：目录结构列出的测试文件必须与实际一致（既不许漏也不许列不存在的）", () => {
  const md = README();
  const tree = md.slice(md.indexOf("## 📁 目录结构"), md.indexOf("## 📚 文档地图"));
  // 只取目录树里作为「文件名条目」出现的 .mjs。四个坑（都实测踩过，别简化）：
//  · 要写 [\w-]+(?:\.[\w-]+)* 而不是 [\w-]+：文件名本身带点（analyze-contract.test.mjs），
//    后者只能匹配到尾巴 "test.mjs"，报错就变成莫名其妙的「漏了 analyze-contract.test.mjs」
//  · \w 不含连字符，别写成 [\w.] 或 [\w]+
//  · `test/*.test.mjs` 这类 glob 里的 "*.test.mjs" 不是文件名：要求前面是行首或空白
//  · 目录树的注释紧跟文件名（`unit.test.mjs   # 基础单元测试`），后面要允许空白/行尾/注释
  const listed = new Set([...tree.matchAll(/(?:^|\s)((?![\d*-])[\w-]+(?:\.[\w-]+)*\.mjs)(?=\s|#|$)/gm)].map(m => m[1]));
  for (const f of fs.readdirSync(path.join(ROOT, "worker/test"))) {
    assert.ok(listed.has(f), `README 目录结构漏了 worker/test/${f}`);
  }
  for (const f of listed) {
    const exists = ["worker/test", "scripts", "worker/src"].some(d => fs.existsSync(path.join(ROOT, d, f)));
    assert.ok(exists, `README 列出了不存在的文件 ${f}`);
  }
});

test("README：目录结构列出的 worker/src 文件必须与实际一致", () => {
  const md = README();
  const tree = md.slice(md.indexOf("## 📁 目录结构"), md.indexOf("## 📚 文档地图"));
  for (const f of fs.readdirSync(path.join(ROOT, "worker/src")).filter(x => x.endsWith(".js"))) {
    assert.ok(tree.includes(f), `README 目录结构漏了 worker/src/${f}`);
  }
});

test("README：离线套件走 glob，联网测试不得混进离线套件", () => {
  const md = README();
  assert.match(pkg.scripts.test, /test\/\*\.test\.mjs/,
    "package.json 的 test 应走 glob（逐个列文件会让新测试被静默漏掉）");
  assert.match(pkg.scripts["test:live"], /live\.network\.mjs/, "test:live 应指向 live.network.mjs");
  assert.doesNotMatch(pkg.scripts.test, /live\.network/, "联网测试不得混进离线套件");
  assert.ok(md.includes("glob"), "README 应说明离线套件走 glob 及原因");
});

test("README：不得声称已废止的口径（ssq 对等源已换成 17500、数字型无号码池）", () => {
  const md = README();
  assert.doesNotMatch(md, /双色球（500 \+ cwl）最近 30 期/,
    "README 仍把 cwl 写成 ssq 交叉校验的对等源，实际已换成 17500（cwl 从 CF 边缘长期不通）");
  assert.match(md, /对等源 17500/, "README 应写明 ssq 的对等源是 17500");
  assert.match(md, /数字型/, "README 应说明数字型彩种没有号码池导致的字段差异");
});

test("README：应写明单源不显示成绿灯（这是 v0.15.2 假绿事故的对外承诺）", () => {
  const md = README();
  assert.match(md, /warn/, "README 应说明单一源应答时 sync_health 判 warn 而非 pass");
  assert.match(md, /交叉校验/, "README 应说明交叉校验的实际覆盖口径");
});