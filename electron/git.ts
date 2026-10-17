import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { lineChanges } from "../shared/line-changes.ts";
import { LOG_MAX_COUNT, LOG_PAGE_SIZE } from "../shared/log.ts";
import type { LogLocation, LogPerson } from "../shared/log.ts";
import type {
  Branch,
  Change,
  ChangedFile,
  CommandLog,
  Commit,
  CommitDetail,
  DiffData,
  RepoSnapshot,
  TreeEntry,
} from "../shared/types.ts";

const MAX_TEXT = 2 * 1024 * 1024;
const logs: CommandLog[] = [];
const operationLogs: CommandLog[] = [];
let sequence = 0;
const locks = new Map<string, Promise<unknown>>();
export const commandLogs = () =>
  [...logs, ...operationLogs].sort((a, b) => a.id - b.id);
function redact(value: string) {
  return value.replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, "$1***@");
}

export async function git(
  cwd: string,
  args: string[],
  input?: string,
  acceptedExitCodes: readonly number[] = [0],
  extraEnv: Record<string, string> = {},
): Promise<string> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    // stash invokes clean internally; a global literal-pathspec flag breaks its cleanup.
    const literalPaths = [
      "add",
      "rm",
      "reset",
      "restore",
      "clean",
      "diff",
      "log",
      "ls-files",
      "ls-tree",
    ].includes(args[0]);
    const child = spawn(
      "git",
      [
        "--no-pager",
        ...(literalPaths ? ["--literal-pathspecs"] : []),
        "-c",
        "core.quotepath=false",
        ...args,
      ],
      {
        cwd,
        windowsHide: true,
        shell: false,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C.UTF-8",
          ...extraEnv,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const out: Buffer[] = [],
      err: Buffer[] = [];
    let bytes = 0,
      killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill();
    }, 120_000);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 16 * MAX_TEXT) {
        killed = true;
        child.kill();
      } else out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (err.reduce((n, b) => n + b.length, 0) < MAX_TEXT) err.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          error.message.includes("ENOENT")
            ? "找不到 Git。请安装 Git 并确保它位于系统 PATH 中。"
            : error.message,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      const output = killed
        ? "Git 操作超时或输出超过限制，请在控制台检查仓库。"
        : stderr || stdout;
      const entry: CommandLog = {
        id: ++sequence,
        date: new Date().toISOString(),
        command: redact(
          `git ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`,
        ),
        output: redact(output.slice(0, 12000)),
        success: code !== null && acceptedExitCodes.includes(code) && !killed,
        duration: Date.now() - start,
      };
      const readOnly =
        [
          "status",
          "rev-parse",
          "symbolic-ref",
          "for-each-ref",
          "log",
          "show",
          "cat-file",
          "diff",
          "rev-list",
          "hash-object",
          "check-ref-format",
          "check-ignore",
          "show-ref",
          "ls-files",
          "ls-tree",
          "--version",
        ].includes(args[0]) ||
        (args[0] === "config" && args.includes("--get")) ||
        (args[0] === "remote" &&
          (args.length === 1 || args[1] === "get-url")) ||
        (args[0] === "stash" && args[1] === "list");
      const destination = readOnly ? logs : operationLogs;
      destination.push(entry);
      if (destination.length > (readOnly ? 150 : 300)) destination.shift();
      if (entry.success) resolve(stdout);
      else reject(new Error(redact(output.trim() || `Git 退出码 ${code}`)));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export async function repository(directory: string): Promise<string> {
  if (!directory || typeof directory !== "string")
    throw new Error("请选择仓库目录");
  return (
    await git(path.resolve(directory), ["rev-parse", "--show-toplevel"])
  ).trim();
}
export async function serialize<T>(
  repo: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(repo) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  locks.set(repo, current);
  try {
    return await current;
  } finally {
    if (locks.get(repo) === current) locks.delete(repo);
  }
}
export function relativeFile(repo: string, file: string): string {
  if (
    !file ||
    typeof file !== "string" ||
    file.includes("\0") ||
    path.isAbsolute(file) ||
    /^[A-Za-z]:/.test(file)
  )
    throw new Error("无效的仓库内路径");
  const result = path.resolve(repo, file);
  const relative = path.relative(repo, result);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).some((segment) => segment.toLowerCase() === ".git")
  )
    throw new Error("文件必须位于仓库目录内");
  return relative.split(path.sep).join("/");
}
async function safeDiskPath(repo: string, file: string) {
  const relative = relativeFile(repo, file);
  const diskPath = await fs.realpath(path.join(repo, relative));
  const realRoot = await fs.realpath(repo);
  const check = path.relative(realRoot, diskPath);
  if (
    check === ".." ||
    check.startsWith(`..${path.sep}`) ||
    path.isAbsolute(check)
  )
    throw new Error("不读取仓库外部的符号链接");
  if (check.split(path.sep).some((segment) => segment.toLowerCase() === ".git"))
    throw new Error("不读取 Git 内部元数据");
  return diskPath;
}
async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
async function hasHead(repo: string) {
  return Boolean(
    (
      await git(
        repo,
        ["rev-parse", "--verify", "--quiet", "HEAD"],
        undefined,
        [0, 1],
      )
    ).trim(),
  );
}
async function config(repo: string, key: string) {
  return (await git(repo, ["config", "--get", key], undefined, [0, 1])).trim();
}
export async function resolveCommit(repo: string, ref: string) {
  if (
    typeof ref !== "string" ||
    !ref ||
    ref.startsWith("-") ||
    ref.includes("\0") ||
    ref.length > 500
  )
    throw new Error("无效的 Git 引用");
  return (
    await git(repo, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ])
  ).trim();
}
export function parseStatus(raw: string): Change[] {
  const parts = raw.split("\0");
  const changes: Change[] = [];
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (line.length < 4) continue;
    const index = line[0],
      worktree = line[1],
      file = line.slice(3);
    const oldPath = /[RC]/.test(index + worktree) ? parts[++i] : undefined;
    changes.push({
      path: file,
      oldPath,
      index,
      worktree,
      conflict: ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(
        index + worktree,
      ),
    });
  }
  return changes;
}
function parseLog(raw: string): Commit[] {
  return raw
    .split("\x1e")
    .map((row) => row.replace(/^\s+/, ""))
    .filter(Boolean)
    .map((row) => {
      const [
        hash,
        parents,
        author,
        email,
        date,
        committer,
        committerEmail,
        commitDate,
        subject,
        refs,
        body,
      ] = row.split("\0");
      return {
        hash,
        parents: parents ? parents.split(" ") : [],
        author,
        email,
        date,
        committer,
        committerEmail,
        commitDate,
        subject,
        refs,
        body: (body ?? "").trim(),
      };
    });
}
const logFormat =
  "%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%D%x00%b%x1e";

function logText(params: Record<string, unknown>, key: string, max = 4096) {
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw new Error("无效的日志筛选");
  const value = params[key];
  if (value === undefined) return "";
  if (typeof value !== "string" || value.includes("\0") || value.length > max)
    throw new Error(`无效的日志筛选 ${key}`);
  return value;
}

function logList(
  params: Record<string, unknown>,
  key: string,
  maxLength: number,
) {
  const values = params[key];
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 100)
    throw new Error(`日志筛选 ${key} 最多允许 100 项`);
  return [
    ...new Set(
      values.map((value) => {
        if (
          typeof value !== "string" ||
          !value ||
          value.includes("\0") ||
          value.length > maxLength
        )
          throw new Error(`无效的日志筛选 ${key}`);
        return value;
      }),
    ),
  ];
}

function logLimit(params: Record<string, unknown>) {
  if (params.limit === undefined) return LOG_PAGE_SIZE;
  if (
    typeof params.limit !== "number" ||
    !Number.isFinite(params.limit) ||
    params.limit < 1
  )
    throw new Error("日志加载数量必须是正数");
  return Math.min(Math.floor(params.limit), LOG_MAX_COUNT);
}

function logDay(value: string, end: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("日期格式必须是 YYYY-MM-DD");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    throw new Error(`无效的日期：${value}`);
  if (end) {
    date.setDate(date.getDate() + 1);
    date.setSeconds(date.getSeconds() - 1);
  }
  return date.toISOString();
}

function escapeLogRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function logRevisions(repo: string, refs: string[]): Promise<string[]> {
  const headExists = await hasHead(repo);
  if (refs.length) {
    const revisions: string[] = [];
    for (const ref of refs) {
      if (ref.startsWith("-") || ref.length > 500)
        throw new Error("无效的 Git 引用");
      if (ref === "HEAD" && !headExists) continue;
      // A branch can disappear between the tree refresh and its history request.
      if (/^refs\/(heads|remotes|tags)\//.test(ref)) {
        const existing = await git(
          repo,
          ["rev-parse", "--verify", "--quiet", "--end-of-options", ref],
          undefined,
          [0, 1],
        );
        if (!existing.trim()) continue;
      }
      revisions.push(await resolveCommit(repo, ref));
    }
    return [...new Set(revisions)];
  }
  if (
    !headExists &&
    !(
      await git(repo, [
        "for-each-ref",
        "--count=1",
        "--format=%(refname)",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
      ])
    ).trim()
  )
    return [];
  // Stashes and private application refs are not branch history.
  return ["--branches", "--remotes", "--tags", ...(headExists ? ["HEAD"] : [])];
}

async function logQuery(repo: string, params: Record<string, unknown>) {
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw new Error("无效的日志筛选");
  const search = logText(params, "search");
  const ref = logText(params, "ref", 500);
  const author = logText(params, "author", 512);
  const file = logText(params, "file");
  const refs = [
    ...new Set([...logList(params, "refs", 500), ...(ref ? [ref] : [])]),
  ];
  const authors = logList(params, "authors", 512);
  const paths = [
    ...new Set([...logList(params, "paths", 4096), ...(file ? [file] : [])]),
  ];
  if (
    refs.length > 100 ||
    authors.length + Number(Boolean(author)) > 100 ||
    paths.length > 100
  )
    throw new Error("每类日志筛选最多允许 100 项");
  for (const key of ["regex", "matchCase", "firstParent", "noMerges"])
    if (params[key] !== undefined && typeof params[key] !== "boolean")
      throw new Error(`无效的日志选项 ${key}`);
  if (
    params.order !== undefined &&
    params.order !== "date" &&
    params.order !== "topo"
  )
    throw new Error("不支持的日志排序");
  const since = logText(params, "since", 10);
  const until = logText(params, "until", 10);
  const sinceDate = since ? logDay(since, false) : "";
  const untilDate = until ? logDay(until, true) : "";
  if (sinceDate && untilDate && Date.parse(sinceDate) > Date.parse(untilDate))
    throw new Error("开始日期不能晚于结束日期");
  const literal = (value: string) =>
    params.regex ? escapeLogRegex(value) : value;
  const args = [
    params.order === "topo" ? "--topo-order" : "--date-order",
    params.regex ? "--extended-regexp" : "--fixed-strings",
    ...(params.matchCase ? [] : ["--regexp-ignore-case"]),
    ...(params.firstParent ? ["--first-parent"] : []),
    ...(params.noMerges ? ["--no-merges"] : []),
    ...(author ? [`--author=${literal(author)}`] : []),
    ...authors.map((email) => `--author=${literal(`<${email}>`)}`),
    ...(sinceDate ? [`--since-as-filter=${sinceDate}`] : []),
    ...(untilDate ? [`--until=${untilDate}`] : []),
  ];
  const pathspecs = paths.map((file) => {
    if (file.split(/[\\/]/).includes(".."))
      throw new Error("日志路径不能包含上级目录 ..");
    return relativeFile(repo, file) || ".";
  });
  const revisions = await logRevisions(repo, refs);
  return { args, revisions, pathspecs, search, limit: logLimit(params) };
}

async function historyPage(repo: string, params: Record<string, unknown>) {
  const { args, revisions, pathspecs, search, limit } = await logQuery(
    repo,
    params,
  );
  if (!revisions.length) return { commits: [], hasMore: false };
  const paths = pathspecs.length ? ["--", ...pathspecs] : [];
  let hash = "";
  if (search && /^[a-f0-9]{4,64}$/i.test(search)) {
    try {
      hash = await resolveCommit(repo, search);
    } catch {
      // A hexadecimal subject can also be ordinary message text.
    }
  }
  if (hash) {
    // Keep the same Git walk and every filter for hash searches, including first-parent.
    const matches = await git(repo, [
      "log",
      ...args,
      "--format=%H",
      ...revisions,
      ...paths,
    ]);
    const found = matches.split(/\r?\n/).includes(hash);
    return {
      commits: found ? [await logResolve(repo, { ref: hash })] : [],
      hasMore: false,
    };
  }
  const commits = parseLog(
    await git(repo, [
      "log",
      ...args,
      `--format=${logFormat}`,
      `--max-count=${limit + 1}`,
      ...(search ? [`--grep=${search}`] : []),
      ...revisions,
      ...paths,
    ]),
  );
  return {
    commits: commits.slice(0, limit),
    hasMore: limit < LOG_MAX_COUNT && commits.length > limit,
  };
}

export async function history(
  repo: string,
  params: Record<string, unknown> = {},
): Promise<Commit[]> {
  return (await historyPage(repo, params)).commits;
}

export async function logPeople(repo: string): Promise<LogPerson[]> {
  const revisions = await logRevisions(repo, []);
  if (!revisions.length) return [];
  const raw = await git(repo, ["log", "--format=%an%x00%ae", ...revisions]);
  const people = new Map<string, LogPerson>();
  for (const row of raw.split(/\r?\n/).filter(Boolean)) {
    const [name, email] = row.split("\0");
    if (name !== undefined && email !== undefined)
      people.set(`${name}\0${email}`, { name, email });
  }
  return [...people.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email),
  );
}

export async function logResolve(
  repo: string,
  params: Record<string, unknown>,
): Promise<Commit> {
  const hash = await resolveCommit(repo, logText(params, "ref", 500));
  const commit = parseLog(
    await git(repo, ["show", "-s", `--format=${logFormat}`, hash]),
  )[0];
  if (!commit) throw new Error("无法读取目标提交");
  return commit;
}

export async function logLocate(
  repo: string,
  params: Record<string, unknown>,
): Promise<LogLocation> {
  const hash = await resolveCommit(repo, logText(params, "ref", 500));
  const revisions = await logRevisions(repo, []);
  if (!revisions.length) return { hash, limit: LOG_PAGE_SIZE, anchor: true };
  const hashes = (
    await git(repo, [
      "log",
      "--date-order",
      `--max-count=${LOG_MAX_COUNT}`,
      "--format=%H",
      ...revisions,
    ])
  )
    .trim()
    .split(/\r?\n/);
  const index = hashes.indexOf(hash);
  return index < 0
    ? { hash, limit: LOG_PAGE_SIZE, anchor: true }
    : {
        hash,
        limit: Math.min(
          LOG_MAX_COUNT,
          Math.ceil((index + 1) / LOG_PAGE_SIZE) * LOG_PAGE_SIZE,
        ),
        anchor: false,
      };
}
export async function snapshot(
  repo: string,
  params: Record<string, unknown> = {},
): Promise<RepoSnapshot> {
  const headExists = await hasHead(repo);
  const [
    status,
    branch,
    refRows,
    tagRows,
    remoteRows,
    stashRows,
    page,
    name,
    email,
    version,
    gitDir,
    headLog,
  ] = await Promise.all([
    git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(repo, ["symbolic-ref", "-q", "HEAD"]).catch(() =>
      git(repo, ["rev-parse", "--short", "HEAD"]),
    ),
    git(repo, [
      "for-each-ref",
      "--format=%(refname)%00%(HEAD)%00%(upstream)%00%(objectname)%00%(upstream:track)",
      "refs/heads",
      "refs/remotes",
    ]),
    git(repo, [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
      "refs/tags",
    ]),
    git(repo, ["remote"]),
    git(repo, ["stash", "list", "--format=%gd%x00%gs%x00%aI"]),
    historyPage(repo, params),
    config(repo, "user.name"),
    config(repo, "user.email"),
    git(repo, ["--version"]),
    git(repo, ["rev-parse", "--absolute-git-dir"]),
    headExists
      ? git(repo, ["show", "-s", `--format=${logFormat}`, "HEAD"])
      : Promise.resolve(""),
  ]);
  const branches: Branch[] = refRows
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [ref, head, upstream, hash, track] = row.split("\0");
      return {
        name: ref.replace(/^refs\/(heads|remotes)\//, ""),
        ref,
        current: head === "*",
        upstream: upstream.replace(/^refs\/(heads|remotes)\//, ""),
        hash,
        track,
        remote: ref.startsWith("refs/remotes/"),
      };
    })
    .filter((b) => !b.name.endsWith("/HEAD"));
  const current = branches.find((b) => b.current);
  let ahead = 0,
    behind = 0;
  // A pruned upstream has no commit to compare; keep its [gone] tracking state.
  if (current?.upstream && !current.track.includes("[gone]")) {
    const counts = (
      await git(repo, [
        "rev-list",
        "--left-right",
        "--count",
        "HEAD...@{upstream}",
      ])
    )
      .trim()
      .split(/\s+/);
    [ahead, behind] = counts.map(Number);
  }
  const operation =
    (await exists(path.join(gitDir.trim(), "rebase-merge"))) ||
    (await exists(path.join(gitDir.trim(), "rebase-apply")))
      ? "rebase"
      : (await exists(path.join(gitDir.trim(), "MERGE_HEAD")))
        ? "merge"
        : (await exists(path.join(gitDir.trim(), "CHERRY_PICK_HEAD")))
          ? "cherry-pick"
          : (await exists(path.join(gitDir.trim(), "REVERT_HEAD")))
            ? "revert"
            : null;
  return {
    root: repo,
    name: path.basename(repo),
    branch: branch.trim().replace(/^refs\/heads\//, ""),
    upstream: current?.upstream ?? "",
    ahead,
    behind,
    changes: parseStatus(status),
    branches,
    tags: tagRows
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((row) => {
        const [ref, hash] = row.split("\0");
        return { name: ref.slice("refs/tags/".length), hash };
      }),
    remotes: await Promise.all(
      remoteRows
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(async (name) => ({
          name,
          url: (await git(repo, ["remote", "get-url", name])).trim(),
        })),
    ),
    stashes: stashRows
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((row) => {
        const [ref, message, date] = row.split("\0");
        return { ref, message, date };
      }),
    commits: page.commits,
    head: parseLog(headLog)[0] || null,
    hasMore: page.hasMore,
    operation,
    identity: { name, email },
    gitVersion: version.trim(),
  };
}
export async function tree(repo: string, directory = ""): Promise<TreeEntry[]> {
  const diskPath = directory ? await safeDiskPath(repo, directory) : repo;
  const entries = (await fs.readdir(diskPath, { withFileTypes: true }))
    .filter((e) => e.name !== ".git")
    .map((e) => ({
      name: e.name,
      path: [directory, e.name].filter(Boolean).join("/"),
      directory: e.isDirectory(),
      symlink: e.isSymbolicLink(),
      ignored: false,
    }))
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    );
  if (!entries.length) return entries;
  const ignored = new Set(
    (
      await git(
        repo,
        ["check-ignore", "--stdin", "-z"],
        entries
          .map((entry) => entry.path + (entry.directory ? "/" : ""))
          .join("\0") + "\0",
        [0, 1],
      )
    )
      .split("\0")
      .filter(Boolean)
      .map((file) => file.replace(/\/$/, "")),
  );
  return entries.map((entry) => ({
    ...entry,
    ignored: ignored.has(entry.path),
  }));
}
export async function readFile(
  repo: string,
  file: string,
  withBaseline = false,
): Promise<{
  text: string;
  binary: boolean;
  truncated: boolean;
  baseline?: string;
}> {
  const diskPath = await safeDiskPath(repo, file);
  const handle = await fs.open(diskPath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("请选择普通文件");
    const data = Buffer.alloc(Math.min(stat.size, MAX_TEXT));
    await handle.read(data, 0, data.length, 0);
    const binary = data.subarray(0, 8192).includes(0);
    let baseline: string | undefined;
    if (withBaseline && !binary && stat.size <= MAX_TEXT) {
      const original = await blob(repo, "HEAD", relativeFile(repo, file));
      if (!original.binary && !original.truncated) baseline = original.text;
    }
    return {
      text: binary ? "" : data.toString("utf8"),
      binary,
      truncated: stat.size > MAX_TEXT,
      ...(baseline !== undefined ? { baseline } : {}),
    };
  } finally {
    await handle.close();
  }
}
async function blob(repo: string, rev: string, file: string) {
  const size = Number(
    (
      await git(repo, ["cat-file", "-s", `${rev}:${file}`]).catch(() => "0")
    ).trim(),
  );
  if (size > MAX_TEXT) return { text: "", truncated: true, binary: false };
  const text = await git(repo, ["show", `${rev}:${file}`]).catch(() => "");
  return {
    text: text.includes("\0") ? "" : text,
    binary: text.includes("\0"),
    truncated: false,
  };
}
async function emptyTree(repo: string) {
  return (await git(repo, ["hash-object", "-t", "tree", "--stdin"], "")).trim();
}
export async function diff(
  repo: string,
  params: Record<string, unknown>,
): Promise<DiffData> {
  const file = relativeFile(repo, String(params.path ?? ""));
  let before,
    after,
    readOnly = false,
    raw = "",
    beforeLabel = "HEAD",
    afterLabel = "工作区";
  if (params.commit) {
    const hash = await resolveCommit(repo, String(params.commit));
    const parents = (
      await git(repo, ["rev-list", "--parents", "-n", "1", hash])
    )
      .trim()
      .split(" ")
      .slice(1);
    const parent = parents[0] || (await emptyTree(repo));
    const oldFile = params.oldPath
      ? relativeFile(repo, String(params.oldPath))
      : file;
    [before, after, raw] = await Promise.all([
      blob(repo, parent, oldFile),
      blob(repo, hash, file),
      git(repo, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "-M",
        parent,
        hash,
        "--",
        ...new Set([oldFile, file]),
      ]),
    ]);
    beforeLabel = parents[0]?.slice(0, 8) || "空文件";
    afterLabel = hash.slice(0, 8);
  } else {
    const head = await hasHead(repo);
    const changes = parseStatus(
      await git(repo, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
    );
    const change = changes.find((c) => c.path === file);
    const oldFile = change?.oldPath || file;
    if (params.staged) {
      [before, after, raw] = await Promise.all([
        head
          ? blob(repo, "HEAD", oldFile)
          : Promise.resolve({ text: "", binary: false, truncated: false }),
        blob(repo, "", file),
        git(repo, [
          "diff",
          "--cached",
          "--no-ext-diff",
          "--no-textconv",
          "--",
          ...new Set([file, oldFile]),
        ]),
      ]);
      afterLabel = "暂存区";
    } else {
      before = await blob(repo, "", file);
      beforeLabel = "暂存区";
      try {
        after = await readFile(repo, file);
      } catch (error) {
        if (change?.worktree === "D") {
          after = { text: "", binary: false, truncated: false };
          readOnly = true;
        } else throw error;
      }
      raw = await git(repo, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--",
        file,
      ]);
      if (change?.index === "?" && change.worktree === "?")
        before = { text: "", binary: false, truncated: false };
    }
  }
  return {
    path: file,
    before: before.text,
    after: after.text,
    raw,
    beforeLabel,
    afterLabel,
    readOnly,
    binary: before.binary || after.binary,
    truncated: before.truncated || after.truncated,
  };
}
export async function commitDetail(
  repo: string,
  ref: string,
): Promise<CommitDetail> {
  const hash = await resolveCommit(repo, ref);
  const commit = parseLog(
    await git(repo, ["show", "-s", `--format=${logFormat}`, hash]),
  )[0];
  const parent = commit.parents[0] || (await emptyTree(repo));
  const [names, stats] = await Promise.all([
    git(repo, ["diff", "-M", "--name-status", "-z", parent, hash]),
    git(repo, ["diff", "-M", "--numstat", "-z", parent, hash]),
  ]);
  const files: ChangedFile[] = [];
  const parts = names.split("\0");
  for (let i = 0; i < parts.length && parts[i]; i++) {
    const status = parts[i],
      first = parts[++i],
      rename = /^[RC]/.test(status);
    files.push({
      path: rename ? parts[++i] : first,
      oldPath: rename ? first : undefined,
      status: status[0],
      additions: 0,
      deletions: 0,
    });
  }
  const counts = stats.split("\0");
  for (let i = 0; i < counts.length && counts[i]; i++) {
    const [add, del, file] = counts[i].split("\t");
    let target = file;
    if (!file) {
      i++;
      target = counts[++i];
    }
    const entry = files.find((f) => f.path === target);
    if (entry) {
      entry.additions = Number(add) || 0;
      entry.deletions = Number(del) || 0;
    }
  }
  return { commit, files };
}

function string(
  params: Record<string, unknown>,
  key: string,
  optional = false,
): string {
  const value = params[key];
  if (value === undefined && optional) return "";
  if (
    typeof value !== "string" ||
    (!optional && !value.trim()) ||
    value.includes("\0")
  )
    throw new Error(`请填写 ${key}`);
  return value;
}
async function branchName(repo: string, value: string) {
  if (value.startsWith("-")) throw new Error("分支名不能以 - 开头");
  await git(repo, ["check-ref-format", "--branch", value]);
  return value;
}

// Build a private index first; publish it only if the real index is unchanged.
// The worktree is never rewritten when excluding formatting-only changes.
async function prepareCommitIndex(repo: string, stagePaths?: string[]) {
  const indexPath = path.resolve(
    repo,
    (await git(repo, ["rev-parse", "--git-path", "index"])).trim(),
  );
  const readIndex = () =>
    fs.readFile(indexPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  const original = await readIndex();
  if (!original && stagePaths === undefined) return 0;
  const temporary = path.join(
    path.dirname(indexPath),
    `git-idea-${randomUUID()}.index`,
  );
  const env = { GIT_INDEX_FILE: temporary };
  const lockPath = `${indexPath}.lock`;
  let lock: Awaited<ReturnType<typeof fs.open>> | undefined;
  let ownsLock = false;
  try {
    if (original) await fs.writeFile(temporary, original, { flag: "wx" });
    if (stagePaths !== undefined)
      await git(
        repo,
        ["add", "--pathspec-from-file=-", "--pathspec-file-nul"],
        (stagePaths.length ? stagePaths : ["."]).join("\0") + "\0",
        [0],
        env,
      );
    const selected = stagePaths?.length ? stagePaths : [];
    // Large selections must not exceed Windows' process argument limit.
    const readAll =
      selected.reduce((size, file) => size + file.length + 3, 0) > 8000;
    const selectedSet = new Set(selected);
    const matchesSelection = (file: string) => {
      if (!readAll || selectedSet.has(".") || selectedSet.has(file))
        return true;
      let separator = file.lastIndexOf("/");
      while (separator > 0) {
        if (selectedSet.has(file.slice(0, separator))) return true;
        separator = file.lastIndexOf("/", separator - 1);
      }
      return false;
    };
    const pathArgs = readAll ? [] : selected;
    const head = await hasHead(repo);
    const [entries, tree] = await Promise.all([
      git(
        repo,
        ["ls-files", "--stage", "-z", "--", ...pathArgs],
        undefined,
        [0],
        env,
      ),
      head
        ? git(repo, ["ls-tree", "-r", "-z", "HEAD", "--", ...pathArgs])
        : Promise.resolve(""),
    ]);
    const originals = new Map<string, string>();
    for (const entry of tree.split("\0")) {
      const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
      if (match && matchesSelection(match[3]))
        originals.set(match[3], match[2]);
    }
    const replacements: string[] = [];
    for (const entry of entries.split("\0")) {
      const match = /^(100644|100755) ([a-f0-9]+) 0\t([\s\S]+)$/.exec(entry);
      if (!match) continue;
      const [, mode, hash, file] = match;
      if (!matchesSelection(file)) continue;
      const base = originals.get(file);
      if (!base || base === hash) continue;
      const sizes = await Promise.all(
        [base, hash].map((id) => git(repo, ["cat-file", "-s", id])),
      );
      if (sizes.some((size) => Number(size.trim()) > MAX_TEXT)) continue;
      const [before, after] = await Promise.all(
        [base, hash].map((id) => git(repo, ["cat-file", "blob", id])),
      );
      if (
        [before, after].some(
          (text) => text.includes("\0") || text.includes("\ufffd"),
        )
      )
        continue;
      const filtered = lineChanges(before, after).commitText;
      if (filtered === after) continue;
      const content = (
        await git(
          repo,
          ["hash-object", "-w", "--no-filters", "--stdin"],
          filtered,
        )
      ).trim();
      replacements.push(`${mode} ${content}\t${file}\0`);
    }
    if (replacements.length)
      await git(
        repo,
        ["update-index", "-z", "--index-info"],
        replacements.join(""),
        [0],
        env,
      );
    if (stagePaths === undefined && !replacements.length) return 0;
    try {
      lock = await fs.open(lockPath, "wx");
      ownsLock = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("Git 暂存区正被其他操作使用，请稍后重试。");
      throw error;
    }
    const current = await readIndex();
    if (original ? !current?.equals(original) : current !== null)
      throw new Error("暂存区已被其他程序修改，请刷新后重试。");
    await lock.writeFile(await fs.readFile(temporary));
    await lock.sync();
    await lock.close();
    lock = undefined;
    await fs.rename(lockPath, indexPath);
    ownsLock = false;
    return replacements.length;
  } finally {
    await lock?.close().catch(() => {});
    if (ownsLock) await fs.rm(lockPath, { force: true });
    await fs.rm(temporary, { force: true });
    await fs.rm(`${temporary}.lock`, { force: true });
  }
}
export async function mutate(
  repo: string,
  action: string,
  params: Record<string, unknown>,
): Promise<string> {
  return serialize(repo, async () => {
    const paths = Array.isArray(params.paths)
      ? params.paths.map((p) => relativeFile(repo, String(p)))
      : [];
    switch (action) {
      case "log.index":
        await git(repo, [
          "-c",
          "core.commitGraph=true",
          "commit-graph",
          "write",
          "--reachable",
          "--changed-paths",
        ]);
        return "Git 提交图与路径索引已更新";
      case "stage": {
        const filtered = await prepareCommitIndex(repo, paths);
        return filtered
          ? `暂存区已更新，${filtered} 个文件的纯格式差异保留在工作区。`
          : "文件已暂存。";
      }
      case "unstage":
        return (await hasHead(repo))
          ? git(
              repo,
              ["reset", "--pathspec-from-file=-", "--pathspec-file-nul"],
              (paths.length ? paths : ["."]).join("\0") + "\0",
            )
          : git(
              repo,
              [
                "rm",
                "--cached",
                "-r",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
              ],
              (paths.length ? paths : ["."]).join("\0") + "\0",
            );
      case "discard": {
        if (!paths.length) throw new Error("请选择要丢弃改动的文件");
        const changes = parseStatus(
          await git(repo, [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
          ]),
        );
        for (const file of paths) {
          const change = changes.find((c) => c.path === file);
          if (!change) continue;
          if (change.index === "?")
            await git(repo, ["clean", "-f", "--", file]);
          else await git(repo, ["restore", "--worktree", "--", file]);
        }
        return "工作区改动已丢弃";
      }
      case "commit": {
        const filtered = await prepareCommitIndex(repo);
        if (
          filtered &&
          !params.amend &&
          !(await git(repo, ["diff", "--cached", "--name-only", "-z"])).length
        ) {
          const mergeHead = path.resolve(
            repo,
            (await git(repo, ["rev-parse", "--git-path", "MERGE_HEAD"])).trim(),
          );
          if (!(await exists(mergeHead)))
            throw new Error(
              "只有纯格式变化，没有需要提交的内容改动。格式仍保留在工作区。",
            );
        }
        return git(repo, [
          "commit",
          ...(params.amend ? ["--amend"] : []),
          "-m",
          string(params, "message"),
        ]);
      }
      case "branch.create":
        return git(repo, [
          "switch",
          "-c",
          await branchName(repo, string(params, "name")),
          ...(params.start
            ? [await resolveCommit(repo, string(params, "start"))]
            : []),
        ]);
      case "branch.checkout": {
        const name = await branchName(repo, string(params, "name"));
        if (params.remote) {
          const branch = name.slice(name.indexOf("/") + 1);
          const localExists = await git(repo, [
            "show-ref",
            "--verify",
            `refs/heads/${branch}`,
          ]).then(
            () => true,
            () => false,
          );
          if (localExists) return git(repo, ["switch", branch]);
          return git(repo, ["switch", "--track", "-c", branch, name]);
        }
        return git(repo, ["switch", name]);
      }
      case "branch.rename":
        return git(repo, [
          "branch",
          "-m",
          await branchName(repo, string(params, "name")),
          await branchName(repo, string(params, "newName")),
        ]);
      case "branch.delete":
        return git(repo, [
          "branch",
          "-d",
          await branchName(repo, string(params, "name")),
        ]);
      case "merge":
        return git(repo, [
          "merge",
          "--no-edit",
          await resolveCommit(repo, string(params, "ref")),
        ]);
      case "rebase":
        return git(repo, [
          "rebase",
          await resolveCommit(repo, string(params, "ref")),
        ]);
      case "cherry-pick":
        return git(repo, [
          "cherry-pick",
          await resolveCommit(repo, string(params, "ref")),
        ]);
      case "revert":
        return git(repo, [
          "revert",
          "--no-edit",
          await resolveCommit(repo, string(params, "ref")),
        ]);
      case "tag.create": {
        const name = string(params, "name");
        await git(repo, ["check-ref-format", `refs/tags/${name}`]);
        return git(repo, [
          "tag",
          name,
          await resolveCommit(repo, String(params.ref || "HEAD")),
        ]);
      }
      case "tag.delete":
        return git(repo, ["tag", "-d", "--", string(params, "name")]);
      case "stash.save":
        return git(repo, [
          "stash",
          "push",
          "--include-untracked",
          "-m",
          string(params, "message", true) || "Git IDEA stash",
        ]);
      case "stash.apply":
      case "stash.pop":
      case "stash.drop": {
        const ref = string(params, "ref");
        if (!/^stash@\{\d+\}$/.test(ref)) throw new Error("无效的储藏引用");
        return git(repo, ["stash", action.split(".")[1], ref]);
      }
      case "fetch":
        return git(repo, ["fetch", "--all", "--prune"]);
      case "pull":
        return git(repo, ["pull", "--ff-only"]);
      case "push": {
        const args = ["push"];
        if (params.remote) {
          const remote = string(params, "remote");
          if (remote.startsWith("-")) throw new Error("无效的远程名称");
          args.push(
            "--set-upstream",
            remote,
            await branchName(repo, string(params, "branch")),
          );
        }
        return git(repo, args);
      }
      case "remote.add":
      case "remote.remove": {
        const name = string(params, "name");
        if (!/^[\w.-]+$/.test(name) || name.startsWith("-"))
          throw new Error("无效的远程名称");
        return git(repo, [
          "remote",
          action.endsWith("add") ? "add" : "remove",
          name,
          ...(action.endsWith("add") ? [string(params, "url")] : []),
        ]);
      }
      case "identity": {
        await git(repo, [
          "config",
          "--local",
          "user.name",
          string(params, "name"),
        ]);
        await git(repo, [
          "config",
          "--local",
          "user.email",
          string(params, "email"),
        ]);
        return "仓库提交身份已保存";
      }
      case "resolve": {
        if (!paths.length) throw new Error("请选择冲突文件");
        return git(repo, ["add", "--", ...paths]);
      }
      case "operation.abort":
      case "operation.continue": {
        const operation = string(params, "operation");
        if (!["merge", "rebase", "cherry-pick", "revert"].includes(operation))
          throw new Error("未知操作");
        return git(
          repo,
          [
            "-c",
            "core.editor=true",
            operation,
            action.endsWith("abort") ? "--abort" : "--continue",
          ],
          undefined,
        );
      }
      case "reset": {
        const mode = string(params, "mode");
        if (!["soft", "mixed", "hard"].includes(mode))
          throw new Error("未知重置模式");
        return git(repo, [
          "reset",
          `--${mode}`,
          await resolveCommit(repo, string(params, "ref")),
        ]);
      }
      default:
        throw new Error("不支持的 Git 操作");
    }
  });
}

export async function saveFile(
  repo: string,
  file: string,
  text: string,
  expectedText?: string,
) {
  if (Buffer.byteLength(text) > MAX_TEXT)
    throw new Error("文件过大，请使用外部编辑器");
  return serialize(repo, async () => {
    const diskPath = await safeDiskPath(repo, file);
    const stat = await fs.stat(diskPath);
    if (!stat.isFile()) throw new Error("只能保存普通文件");
    if (
      expectedText !== undefined &&
      (await fs.readFile(diskPath, "utf8")) !== expectedText
    )
      throw new Error(
        "磁盘文件已被其他程序修改，请先复制保留当前草稿，再重新打开文件进行合并",
      );
    await fs.writeFile(diskPath, text, "utf8");
    return "文件已保存";
  });
}
