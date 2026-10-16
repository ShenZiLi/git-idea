import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const archive =
  process.argv[2] ||
  path.join("release", "win-unpacked", "resources", "app.asar");
let files = 0;

async function verify(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await verify(file);
    else {
      // ASAR's lookup API expects native separators for nested Windows paths.
      const packaged = asar.extractFile(archive, file);
      const built = await readFile(file);
      assert.ok(packaged.equals(built), `打包内容与当前构建不一致：${file}`);
      files++;
    }
  }
}

await verify("dist");
await verify("dist-electron");
console.log(`已核对 ${files} 个生产资源文件，安装包与当前构建完全一致。`);
