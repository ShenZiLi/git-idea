import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electron from "electron";
const preferences = await mkdtemp(path.join(tmpdir(), "git-idea-smoke-"));
const target = process.env.GIT_IDEA_SMOKE_EXECUTABLE || electron;
const environment = {
  ...process.env,
  GIT_IDEA_SMOKE: "1",
  GIT_IDEA_REPO: process.cwd(),
  GIT_IDEA_PREFERENCES: path.join(preferences, "preferences.json"),
};
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(
  target,
  process.env.GIT_IDEA_SMOKE_EXECUTABLE ? [] : ["."],
  { env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
const timeout = setTimeout(() => {
  child.kill();
  console.error("Desktop smoke timed out");
  process.exitCode = 1;
}, 45000);
child.on("error", (error) => {
  console.error(error);
  clearTimeout(timeout);
  process.exitCode = 1;
});
child.on("close", async (code) => {
  clearTimeout(timeout);
  // Windows portable launchers forward the child exit code but may detach stdout.
  // The fresh preferences receipt is written by the renderer's real open-repo IPC.
  let rendererReceipt = false;
  if (process.env.GIT_IDEA_SMOKE_EXECUTABLE && code === 0) {
    try {
      const receipt = JSON.parse(
        await readFile(environment.GIT_IDEA_PREFERENCES, "utf8"),
      );
      rendererReceipt =
        path.resolve(receipt.lastRepo) === path.resolve(process.cwd());
    } catch {
      /* A failed renderer must not pass without its receipt. */
    }
  }
  if (code !== 0 || (!output.includes("SMOKE_RESULT=") && !rendererReceipt)) {
    process.exitCode = 1;
    console.error(
      `Desktop verification failed: exit=${code}, rendererReceipt=${rendererReceipt}`,
    );
  } else
    console.log("Desktop production renderer, sandbox and Git IPC verified.");
  await rm(preferences, { recursive: true, force: true });
});
