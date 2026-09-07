// 把 frontend/ 下的前端资源打包成 worker/src/ui.js，供 Worker 直接内联返回。
// 目的：消除「Worker 内联版」与「独立版」两份 HTML 长期漂移的问题——
// frontend/ 是唯一事实源，Worker 只是构建产物。
// 用法：npm run build:ui（部署前必须执行）
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => {
  const f = join(root, p);
  if (!existsSync(f)) throw new Error("缺少文件：" + p);
  return readFileSync(f, "utf8");
};

const html = read("frontend/index.html");
const sw = read("frontend/sw.js");
const manifest = read("frontend/manifest.json");
const icon = read("frontend/icon.svg");

const out =
  "// 自动生成，请勿手改 —— 由 scripts/build-ui.mjs 从 frontend/ 打包生成\n" +
  "// 修改前端请改 frontend/ 下的源文件后执行：npm run build:ui\n" +
  "export const HTML = " + JSON.stringify(html) + ";\n" +
  "export const SW = " + JSON.stringify(sw) + ";\n" +
  "export const MANIFEST = " + JSON.stringify(manifest) + ";\n" +
  "export const ICON = " + JSON.stringify(icon) + ";\n";

writeFileSync(join(root, "worker/src/ui.js"), out);
console.log("worker/src/ui.js 已生成：" + (out.length / 1024).toFixed(1) + " KB");
