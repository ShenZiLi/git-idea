import { promises as fs } from "node:fs";
import path from "node:path";
import { diffLines } from "diff";
import type { BranchCompareResult } from "../shared/branch-compare.ts";
import type { ChangedFile, Commit, DiffData } from "../shared/types.ts";
import { git, relativeFile, resolveCommit } from "./git.ts";

const MAX_TEXT = 2 * 1024 * 1024;
const PAGE_SIZE = 300;
const MAX_COMMITS = 5000;
interface TextContent {
  text: string;
  binary: boolean;
  truncated: boolean;
}
const empty = (): TextContent => ({
  text: "",
  binary: false,
  truncated: false,
});
const content = (text: string): TextContent => ({
  text: text.includes("\0") || text.includes("\ufffd") ? "" : text,
  binary: text.includes("\0") || text.includes("\ufffd"),
  truncated: false,
});

function modeOf(params: Record<string, unknown>) {
  if (params.mode !== "branches" && params.mode !== "worktree")
    throw new Error("请选择分支比较或工作树比较");
  return params.mode;
}
function parseFiles(names: string, stats: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const parts = names.split("\0");
  for (let i = 0; i < parts.length && parts[i]; i++) {
    const status = parts[i];
    const first = parts[++i];
    const rename = /^[RC]/.test(status);
    files.push({
      path: rename ? parts[++i] : first,
      oldPath: rename ? first : undefined,
      status: status[0],
      additions: 0,
      deletions: 0,
    });
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  const counts = stats.split("\0");
  for (let i = 0; i < counts.length && counts[i]; i++) {
    const match = /^([^\t]+)\t([^\t]+)\t([\s\S]*)$/.exec(counts[i]);
    if (!match) continue;
    let file = match[3];
    if (!file) {
      i++;
      file = counts[++i];
    }
    const entry = byPath.get(file);
    if (entry) {
      entry.additions = Number(match[1]) || 0;
      entry.deletions = Number(match[2]) || 0;
    }
  }
  return files;
}
async function blob(
  repo: string,
  hash: string,
  file: string,
): Promise<TextContent> {
  const raw = await git(repo, ["ls-tree", "-z", hash, "--", file]);
  const entry = raw
    .split("\0")
    .find((row) => row.slice(row.indexOf("\t") + 1) === file);
  if (!entry) return empty();
  const match = /^(\d+) (\w+) ([a-f0-9]+)\t/.exec(entry);
  if (!match || match[2] !== "blob")
    throw new Error("子模块或目录不支持文本比较");
  const size = Number((await git(repo, ["cat-file", "-s", match[3]])).trim());
  if (size > MAX_TEXT) return { ...empty(), truncated: true };
  return content(await git(repo, ["cat-file", "blob", match[3]]));
}
async function disk(repo: string, file: string): Promise<TextContent> {
  const absolute = path.join(repo, relativeFile(repo, file));
  let stat;
  try {
    stat = await fs.lstat(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  }
  const [realRoot, realFile] = await Promise.all([
    fs.realpath(repo),
    fs.realpath(absolute),
  ]);
  const relative = path.relative(realRoot, realFile);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("不读取仓库外部的符号链接");
  if (relative.split(path.sep).some((part) => part.toLowerCase() === ".git"))
    throw new Error("不读取 Git 内部元数据");
  // Git compares a symlink's target text, without following the target's contents.
  if (stat.isSymbolicLink()) return content(await fs.readlink(absolute));
  if (!stat.isFile()) throw new Error("子模块或目录不支持文本比较");
  if (stat.size > MAX_TEXT) return { ...empty(), truncated: true };
  const handle = await fs.open(realFile, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error("请选择普通文件");
    if (opened.size > MAX_TEXT) return { ...empty(), truncated: true };
    const buffer = Buffer.alloc(MAX_TEXT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_TEXT) return { ...empty(), truncated: true };
    return content(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await handle.close();
  }
}
async function branchTip(repo: string, ref: unknown) {
  if (
    typeof ref !== "string" ||
    !/^refs\/(heads|remotes)\/.+/.test(ref) ||
    ref.includes("\0")
  )
    throw new Error("请选择有效的本地或远程分支");
  await git(repo, ["show-ref", "--verify", "--", ref]);
  const symbolic = (
    await git(repo, ["symbolic-ref", "--quiet", ref], undefined, [0, 1])
  ).trim();
  if (symbolic) throw new Error("请选择实际分支，不能比较远程 HEAD 指针");
  return {
    label: ref.replace(/^refs\/(heads|remotes)\//, ""),
    hash: await resolveCommit(repo, ref),
  };
}
function parseCommits(raw: string): Commit[] {
  return raw
    .split("\x1e")
    .map((row) => row.replace(/^\s+/, ""))
    .filter(Boolean)
    .map((row) => {
      const [hash, parents, author, email, date, subject, refs, body] =
        row.split("\0");
      return {
        hash,
        parents: parents ? parents.split(" ") : [],
        author,
        email,
        date,
        subject,
        refs,
        body: (body ?? "").trim(),
      };
    });
}
export async function branchCompare(
  repo: string,
  params: Record<string, unknown>,
): Promise<BranchCompareResult> {
  const mode = modeOf(params),
    reverse = params.reverse === true;
  const limit = Math.max(
    PAGE_SIZE,
    Math.min(
      MAX_COMMITS,
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.floor(params.limit)
        : PAGE_SIZE,
    ),
  );
  const selected = await branchTip(repo, params.ref);
  const current =
    mode === "branches"
      ? {
          label:
            (
              await git(
                repo,
                ["symbolic-ref", "--quiet", "--short", "HEAD"],
                undefined,
                [0, 1],
              )
            ).trim() || "HEAD（游离）",
          hash: await resolveCommit(repo, "HEAD"),
        }
      : { label: "工作树", hash: "" };
  let base = mode === "branches" ? current : selected;
  let target = mode === "branches" ? selected : current;
  if (reverse) [base, target] = [target, base];
  const args =
    mode === "branches"
      ? [base.hash, target.hash]
      : [...(reverse ? ["-R"] : []), selected.hash];
  const diffArgs = ["diff", "--no-ext-diff", "--no-textconv", "-M"];
  const [names, stats, log, untracked] = await Promise.all([
    git(repo, [...diffArgs, "--name-status", "-z", ...args, "--"]),
    git(repo, [...diffArgs, "--numstat", "-z", ...args, "--"]),
    mode === "branches"
      ? git(repo, [
          "log",
          `--max-count=${limit + 1}`,
          "--date=iso-strict",
          "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D%x00%b%x1e",
          `${base.hash}..${target.hash}`,
          "--",
        ])
      : "",
    mode === "worktree"
      ? git(repo, ["ls-files", "--others", "--exclude-standard", "-z"])
      : "",
  ]);
  let files = parseFiles(names, stats);
  for (const file of untracked.split("\0").filter(Boolean)) {
    const safe = relativeFile(repo, file);
    const existed = Boolean(
      (await git(repo, ["ls-tree", "-z", selected.hash, "--", safe])).trim(),
    );
    const before = await blob(repo, selected.hash, safe);
    let after: TextContent;
    try {
      after = await disk(repo, safe);
    } catch {
      after = { ...empty(), binary: true };
    }
    files = files.filter((entry) => entry.path !== safe);
    if (
      existed &&
      !before.binary &&
      !after.binary &&
      !before.truncated &&
      !after.truncated &&
      before.text === after.text
    )
      continue;
    let additions = 0,
      deletions = 0;
    if (
      !before.binary &&
      !after.binary &&
      !before.truncated &&
      !after.truncated
    ) {
      for (const part of diffLines(before.text, after.text)) {
        if (part.added) additions += part.count ?? 0;
        if (part.removed) deletions += part.count ?? 0;
      }
    }
    files.push({
      path: safe,
      status: existed ? "M" : reverse ? "D" : "A",
      additions: reverse ? deletions : additions,
      deletions: reverse ? additions : deletions,
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const commits = parseCommits(log);
  return {
    mode,
    reverse,
    base,
    target,
    commits: commits.slice(0, limit),
    hasMore: commits.length > limit && limit < MAX_COMMITS,
    files,
  };
}
async function endpoint(repo: string, value: unknown) {
  if (!value || typeof value !== "object")
    throw new Error("比较上下文失效，请刷新");
  const { hash, label } = value as Record<string, unknown>;
  if (typeof hash !== "string" || typeof label !== "string")
    throw new Error("比较上下文失效，请刷新");
  if (
    hash &&
    (!/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(hash) ||
      (await resolveCommit(repo, hash)) !== hash)
  )
    throw new Error("比较提交无效，请刷新");
  return { hash, label };
}
export async function branchCompareFile(
  repo: string,
  params: Record<string, unknown>,
): Promise<DiffData> {
  const mode = modeOf(params),
    reverse = params.reverse === true;
  const file = relativeFile(
    repo,
    typeof params.path === "string" ? params.path : "",
  );
  const oldFile =
    params.oldPath === undefined
      ? file
      : relativeFile(
          repo,
          typeof params.oldPath === "string" ? params.oldPath : "",
        );
  const [base, target] = await Promise.all([
    endpoint(repo, params.base),
    endpoint(repo, params.target),
  ]);
  if (
    mode === "branches"
      ? !base.hash || !target.hash
      : reverse
        ? !!base.hash || !target.hash
        : !base.hash || !!target.hash
  )
    throw new Error("比较方向或提交失效，请刷新");
  const [before, after] = await Promise.all([
    base.hash ? blob(repo, base.hash, oldFile) : disk(repo, oldFile),
    target.hash ? blob(repo, target.hash, file) : disk(repo, file),
  ]);
  return {
    path: file,
    before: before.text,
    after: after.text,
    raw: "",
    binary: before.binary || after.binary,
    truncated: before.truncated || after.truncated,
    beforeLabel: base.label,
    afterLabel: target.label,
    readOnly: true,
  };
}
