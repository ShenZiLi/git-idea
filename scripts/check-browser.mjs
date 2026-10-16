import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const fixtureProcess = spawnSync(
  process.execPath,
  ["scripts/create-playground.mjs"],
  { stdio: "inherit" },
);
if (fixtureProcess.status !== 0) process.exit(1);
const fixture = JSON.parse(
  await readFile(".test-output/playground.json", "utf8"),
);
const program =
  `const fixture = ${JSON.stringify(fixture)};\n` +
  (await readFile("tests/browser-workflow.js", "utf8"));
const launcher =
  process.env.TABBIT_CLI ||
  (process.platform === "win32"
    ? path.join(
        process.env.LOCALAPPDATA,
        "Tabbit/LocalAgent/bin/tabbit-cli.exe",
      )
    : path.join(process.env.HOME, ".local/bin/tabbit-cli"));
const result = spawnSync(
  launcher,
  [
    "nodejs",
    "--task",
    "git-idea",
    "--request-id",
    `workflows-${Date.now()}`,
    "--timeout-ms",
    "90000",
  ],
  { input: program, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
);
await mkdir(".test-output", { recursive: true });
await writeFile(
  ".test-output/browser-result.json",
  result.stdout || result.stderr || String(result.error),
);
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.exitCode =
  result.status === 0 && result.stdout.includes('"status":"succeeded"') ? 0 : 1;
