import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const base = await fs.mkdtemp(path.join(tmpdir(), "git-idea-playground-"));
const repo = path.join(base, "git-playground");
await fs.mkdir(repo);
const run = (...args) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
run("init", "-b", "main");
run("config", "user.name", "Demo Developer");
run("config", "user.email", "demo@example.com");
run("config", "core.autocrlf", "false");
run("config", "commit.gpgsign", "false");
await fs.mkdir(path.join(repo, "src/git"), { recursive: true });
await fs.writeFile(
  path.join(repo, "README.md"),
  "# Git Playground\n\n用于验证 Git IDEA 桌面工作流的真实本地仓库。\n",
);
await fs.writeFile(path.join(repo, ".gitignore"), "node_modules/\ndist/\n");
await fs.writeFile(
  path.join(repo, "package.json"),
  '{\n  "name": "git-playground",\n  "version": "1.0.0"\n}\n',
);
const commit = (message) => {
  run("add", ".");
  run("commit", "-m", message);
};
commit("chore: initialize project workspace");
await fs.writeFile(
  path.join(repo, "src/main.ts"),
  'import { getStatus } from "./git/status";\n\nexport async function main() {\n  const status = await getStatus();\n  return status;\n}\n',
);
await fs.writeFile(
  path.join(repo, "src/git/status.ts"),
  'export async function getStatus() {\n  return { branch: "main", changes: [] };\n}\n',
);
commit("feat: add repository status service");
run("tag", "v1.0.0");
run("switch", "-c", "feature/commit-panel");
await fs.writeFile(
  path.join(repo, "src/commit.ts"),
  'export function commit(message: string) {\n  if (!message.trim()) throw new Error("请输入提交信息");\n  return { message, committed: true };\n}\n',
);
commit("feat: implement commit panel validation");
await fs.writeFile(
  path.join(repo, "src/git/diff.ts"),
  "export function diff(before: string, after: string) {\n  return { before, after, changed: before !== after };\n}\n",
);
commit("feat: support side-by-side file comparisons");
run("switch", "main");
await fs.appendFile(
  path.join(repo, "README.md"),
  "\n## 工作流\n\n暂存、提交、分支和差异查看。\n",
);
commit("docs: document repository workflows");
run("merge", "--no-ff", "--no-edit", "feature/commit-panel");
run("tag", "v1.1.0");
run("switch", "-c", "dev");
await fs.writeFile(
  path.join(repo, "src/layout.ts"),
  "export const panels = {\n  project: 252,\n  commit: 328,\n  log: 0.45,\n};\n",
);
commit("feat: add resizable IDEA-style workspace");
await fs.appendFile(
  path.join(repo, "README.md"),
  "\n## 快捷键\n\nCtrl+K 提交，Ctrl+9 打开日志。\n",
);
commit("docs: add keyboard shortcut reference");
const remote = path.join(base, "remote.git");
execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], {
  encoding: "utf8",
  windowsHide: true,
});
run("remote", "add", "origin", remote);
run("push", "--all", "origin");
run("push", "--tags", "origin");
run("branch", "--set-upstream-to=origin/dev");
await fs.writeFile(
  path.join(repo, "src/git/status.ts"),
  'export async function getStatus() {\n  const branch = "dev";\n  const changes = await readWorktree();\n  return { branch, changes, refreshedAt: Date.now() };\n}\n\nasync function readWorktree() {\n  return [];\n}\n',
);
await fs.writeFile(
  path.join(repo, "notes.md"),
  "# 待办\n\n- 完成工作区状态刷新\n",
);
await fs.mkdir(".test-output", { recursive: true });
await fs.writeFile(
  ".test-output/playground.json",
  JSON.stringify({ base, repo, remote }, null, 2),
);
console.log(JSON.stringify({ base, repo, remote }));
