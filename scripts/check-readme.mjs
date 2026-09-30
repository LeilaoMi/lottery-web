// README 数字核对：真跑一次 node --test 拿到权威件数，再跟 README 里的数字对账。
//
// 为什么是独立脚本而不是测试用例：
//   用例里再跑 `node --test` 会把本文件自己也拉进去执行 → 无限递归。
//   而纯正则数 `test(` 也不可靠：像 live.network.mjs 那样在 describe/for 里生成用例的，
//   源码 7 处 `test(` 实际是 12 个用例（4 个彩种 × 循环）。
//   唯一可信的基准是 node --test 自己的输出，所以这里起子进程跑一次。
//
// 用法：node scripts/check-readme.mjs      （CI 的「文档核对」步骤会跑）
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const md = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const problems = [];

// ---- 1. 权威件数：跑一次离线套件 ----
// 注意不要用 shell:true —— 仓库路径可能带空格（cmd 会把 "C:\Program Files\..." 拆开）。
// glob 交给 node 自己展开（要求 Node ≥ 22；本仓库 CI 的测试 job 是 Node 20，
// 但那一步只跑测试、不跑本脚本，本地/CI 核对步骤用 Node 22+）。
console.log("运行离线测试套件以取得权威件数…");
const r = spawnSync(process.execPath,
  ["--test", "worker/test/*.test.mjs", "scripts/randomness/stats.test.mjs", "scripts/notify.test.mjs"],
  { cwd: ROOT, encoding: "utf8" });
const out = (r.stdout || "") + (r.stderr || "");
const m = /# tests (\d+)/.exec(out) || /ℹ tests (\d+)/.exec(out);
if (!m) { console.error("无法从 node --test 输出解析用例总数：\n" + out.slice(-1500)); process.exit(2); }
const total = Number(m[1]);
const failed = Number((/# fail (\d+)/.exec(out) || /ℹ fail (\d+)/.exec(out) || [, "0"])[1]);
console.log(`  权威总数 = ${total}${failed ? `（其中失败 ${failed}）` : ""}`);

// ---- 2. README 里声明的件数 ----
const badge = /unit%20tests-(\d+)-brightgreen/.exec(md);
if (!badge) problems.push("README 缺 unit tests 徽章");
else if (Number(badge[1]) !== total) problems.push(`徽章写 ${badge[1]} 项，实际 ${total} 项`);

for (const mm of md.matchAll(/(\d+) 项离线单元测试/g)) {
  if (Number(mm[1]) !== total) problems.push(`正文写「${mm[1]} 项离线单元测试」，实际 ${total} 项`);
}
const npmLine = /npm test\s+# 单元测试（(\d+) 项/.exec(md);
if (!npmLine) problems.push("README 的 npm test 注释未声明用例数");
else if (Number(npmLine[1]) !== total) problems.push(`npm test 注释写 ${npmLine[1]} 项，实际 ${total} 项`);

// 拆分式：N 项离线单元测试（A worker + B 统计内核 + C 推送）
const split = /(\d+) 项离线单元测试（(\d+) worker \+ (\d+) 统计内核 \+ (\d+) 推送/.exec(md);
if (!split) problems.push("README 未按 worker/统计内核/推送 拆分测试数");
else {
  const [, t, w, s, n] = split.map(Number);
  if (t !== w + s + n) problems.push(`拆分对不上：${t} ≠ ${w}+${s}+${n}`);
  if (t !== total) problems.push(`拆分里的总数 ${t} 与权威件数 ${total} 不符`);
}

// 联网测试件数：单独跑那个文件
const lr = spawnSync(process.execPath, ["--test", "worker/test/live.network.mjs"],
  { cwd: ROOT, encoding: "utf8" });
const lm = /# tests (\d+)/.exec(lr.stdout + lr.stderr) || /ℹ tests (\d+)/.exec(lr.stdout + lr.stderr);
if (lm) {
  const live = Number(lm[1]);
  const liveMd = /(\d+) 项真实数据源连通性测试/.exec(md);
  if (!liveMd) problems.push("README 未声明联网测试件数");
  else if (Number(liveMd[1]) !== live) problems.push(`联网测试写 ${liveMd[1]} 项，实际 ${live} 项`);
  console.log(`  联网测试 = ${live}`);
}

if (failed) problems.push(`离线套件本身有 ${failed} 项失败，先修测试`);

console.log(problems.length ? "\n发现问题：" : "\nREADME 数字与实际一致");
problems.forEach(p => console.log("  ✗ " + p));
process.exit(problems.length ? 1 : 0);