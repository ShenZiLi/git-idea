import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { git, relativeFile, serialize, parseStatus } from "./git.ts";
import type { Change } from "../shared/types.ts";

export const FILE_LIMIT = 64 * 1024 * 1024,
  RECORD_LIMIT = 256 * 1024 * 1024,
  TEXT_LIMIT = 2 * 1024 * 1024;
export const digest = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");
export const validId = (id: unknown) => {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new Error("无效的记录标识");
  return id;
};
export async function readOptional(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function atomicWrite(file: string, data: Buffer | string) {
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  let owned = false;
  try {
    handle = await fs.open(temp, "wx");
    owned = true;
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temp, file);
  } finally {
    await handle?.close();
    if (owned) await fs.rm(temp, { force: true });
  }
}
export async function writeJson(file: string, value: unknown) {
  await atomicWrite(file, JSON.stringify(value, null, 2));
}
export async function workspaceRoot(repo: string) {
  const gitDir = (await git(repo, ["rev-parse", "--absolute-git-dir"])).trim();
  const root = path.join(gitDir, "git-idea");
  try {
    if ((await fs.lstat(root)).isSymbolicLink())
      throw new Error("工作台元数据目录不能是链接");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await fs.mkdir(root, { recursive: true });
  return root;
}
export async function safeDirectory(root: string, relative: string) {
  const destination = path.resolve(root, relative),
    rel = path.relative(root, destination);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  )
    throw new Error("归档路径越界");
  let current = root;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error("归档目录不能是链接");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  await fs.mkdir(destination, { recursive: true });
  return destination;
}
export async function withWorkspace<T>(
  repo: string,
  action: (root: string) => Promise<T>,
): Promise<T> {
  return serialize(repo, async () => {
    const root = await workspaceRoot(repo),
      lockPath = path.join(root, "workspace.lock");
    let lock;
    const token = JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      id: randomUUID(),
    });
    try {
      lock = await fs.open(lockPath, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(
          "工作台正由另一实例使用。请等待；中断后请核对 workspace.lock 中的进程信息，不会自动删锁。",
        );
      throw e;
    }
    try {
      await lock.writeFile(token);
      await lock.sync();
      return await action(root);
    } finally {
      await lock.close();
      if ((await readOptional(lockPath))?.toString("utf8") === token)
        await fs.unlink(lockPath);
    }
  });
}
export async function headHash(repo: string) {
  return (
    await git(
      repo,
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      undefined,
      [0, 1],
    )
  ).trim();
}
export async function indexFile(repo: string) {
  return path.resolve(
    repo,
    (await git(repo, ["rev-parse", "--git-path", "index"])).trim(),
  );
}
export async function changes(repo: string): Promise<Change[]> {
  return parseStatus(
    await git(repo, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]),
  );
}
export async function assertOrdinary(
  repo: string,
  selected: string[],
  allowUntracked = false,
) {
  if (!selected.length || selected.length > 10000)
    throw new Error("请选择 1 至 10,000 个文件");
  const all = await changes(repo);
  if (all.some((item) => item.conflict)) throw new Error("请先解决仓库冲突");
  for (const marker of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
  ]) {
    const file = path.resolve(
      repo,
      (await git(repo, ["rev-parse", "--git-path", marker])).trim(),
    );
    if (
      await fs.stat(file).then(
        () => true,
        (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return false;
          throw e;
        },
      )
    )
      throw new Error("请先完成或中止当前 Git 操作");
  }
  if (
    (
      await git(
        repo,
        ["config", "--bool", "--get", "core.sparseCheckout"],
        undefined,
        [0, 1],
      )
    ).trim() === "true"
  )
    throw new Error("暂不支持稀疏检出仓库的归档或范围操作");
  for (const file of selected) {
    relativeFile(repo, file);
    const item = all.find(
      (change) => change.path === file || change.oldPath === file,
    );
    if (!item || (!allowUntracked && item.index === "?"))
      throw new Error(`文件已无变更或尚未托管：${file}`);
  }
  return all;
}
export function expandPaths(repo: string, selected: unknown, all: Change[]) {
  if (!Array.isArray(selected) || !selected.length || selected.length > 10000)
    throw new Error("请选择文件；空选择不会改为全部");
  const paths = new Set<string>();
  for (const value of selected) {
    if (typeof value !== "string") throw new Error("无效的文件路径");
    const file = relativeFile(repo, value),
      item = all.find(
        (change) => change.path === file || change.oldPath === file,
      );
    if (!item) throw new Error(`状态已变化，请刷新：${file}`);
    paths.add(item.path);
    if (item.oldPath) paths.add(item.oldPath);
  }
  return [...paths];
}
export interface FileState {
  exists: boolean;
  mode: string;
  size: number;
  sha256: string;
  data?: Buffer;
}
export async function diskState(
  repo: string,
  file: string,
): Promise<FileState> {
  const relative = relativeFile(repo, file);
  let current = repo;
  const pieces = relative.split("/");
  for (let i = 0; i < pieces.length; i++) {
    current = path.join(current, pieces[i]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return { exists: false, mode: "100644", size: 0, sha256: "absent" };
      throw e;
    }
    if (stat.isSymbolicLink())
      throw new Error(`不处理符号链接或重解析点：${file}`);
    if (i < pieces.length - 1 && !stat.isDirectory())
      throw new Error(`路径父项不是目录：${file}`);
    if (i === pieces.length - 1) {
      if (!stat.isFile()) throw new Error(`不处理子模块或目录：${file}`);
      if (stat.size > FILE_LIMIT) throw new Error(`文件超过 64 MB：${file}`);
      const handle = await fs.open(current, "r");
      try {
        const info = await handle.stat();
        if (info.size > FILE_LIMIT || !info.isFile())
          throw new Error(`文件类型或大小已变化：${file}`);
        const data = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < data.length) {
          const read = await handle.read(
            data,
            offset,
            data.length - offset,
            offset,
          );
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        const after = await handle.stat();
        if (
          offset !== data.length ||
          after.size !== info.size ||
          after.mtimeMs !== info.mtimeMs
        )
          throw new Error(`读取期间文件发生变化：${file}`);
        return {
          exists: true,
          mode: info.mode & 0o111 ? "100755" : "100644",
          size: data.length,
          sha256: digest(data),
          data,
        };
      } finally {
        await handle.close();
      }
    }
  }
  throw new Error("请选择普通文件");
}
export async function writeDiskState(
  repo: string,
  file: string,
  state: FileState,
) {
  const absolute = path.join(repo, relativeFile(repo, file));
  await diskState(repo, file);
  if (!state.exists) {
    await fs.rm(absolute, { force: true });
    return;
  }
  if (!state.data || digest(state.data) !== state.sha256)
    throw new Error("恢复内容摘要不匹配");
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await atomicWrite(absolute, state.data);
  if (process.platform !== "win32")
    await fs.chmod(absolute, state.mode === "100755" ? 0o755 : 0o644);
}
export interface IndexEntry {
  path: string;
  mode: string;
  hash: string;
  stage: number;
}
export async function indexEntries(
  repo: string,
  index?: string,
): Promise<IndexEntry[]> {
  const raw = await git(
    repo,
    ["ls-files", "--stage", "-z"],
    undefined,
    [0],
    index ? { GIT_INDEX_FILE: index } : {},
  );
  return raw
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error("无法解析 Git 索引");
      return {
        path: match[4],
        mode: match[1],
        hash: match[2],
        stage: Number(match[3]),
      };
    });
}
export async function treeEntries(
  repo: string,
  revision: string,
): Promise<IndexEntry[]> {
  if (!revision) return [];
  const raw = await git(repo, ["ls-tree", "-r", "-z", revision]);
  return raw
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const match = /^(\d+) (?:blob|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error("无法解析 Git 树");
      return { path: match[3], mode: match[1], hash: match[2], stage: 0 };
    });
}
export async function seedIndex(repo: string, file: string, revision: string) {
  await git(
    repo,
    revision ? ["read-tree", revision] : ["read-tree", "--empty"],
    undefined,
    [0],
    { GIT_INDEX_FILE: file },
  );
}
export async function putEntries(
  repo: string,
  file: string,
  paths: string[],
  entries: IndexEntry[],
) {
  const selected = new Set(paths);
  const zero =
    (await git(repo, ["rev-parse", "--show-object-format"])).trim() === "sha256"
      ? "0".repeat(64)
      : "0".repeat(40);
  const updates =
    paths.map((value) => `0 ${zero}\t${value}\0`).join("") +
    entries
      .filter((entry) => selected.has(entry.path) && entry.stage === 0)
      .map((entry) => `${entry.mode} ${entry.hash}\t${entry.path}\0`)
      .join("");
  if (updates)
    await git(repo, ["update-index", "-z", "--index-info"], updates, [0], {
      GIT_INDEX_FILE: file,
    });
}
export async function putDiskStates(
  repo: string,
  file: string,
  states: Map<string, FileState>,
) {
  const entries: IndexEntry[] = [];
  for (const [name, state] of states)
    if (state.exists) {
      if (!state.data) throw new Error("文件内容缺失");
      entries.push({
        path: name,
        mode: state.mode,
        hash: (
          await git(
            repo,
            ["hash-object", "-w", "--no-filters", "--stdin"],
            state.data,
          )
        ).trim(),
        stage: 0,
      });
    }
  await putEntries(repo, file, [...states.keys()], entries);
}
export async function gitBytes(
  repo: string,
  args: string[],
  env: Record<string, string> = {},
  outputFile?: string,
): Promise<Buffer> {
  let streamError: unknown;
  const child = spawn(
    "git",
    [
      "--no-pager",
      "--literal-pathspecs",
      "-c",
      "core.quotepath=false",
      ...args,
    ],
    {
      cwd: repo,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C.UTF-8",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const chunks: Buffer[] = [],
    errors: Buffer[] = [];
  let bytes = 0;
  const timer = setTimeout(() => {
    streamError = new Error("归档 Git 操作超时");
    child.kill();
  }, 120000);
  const limit = outputFile ? 2 * RECORD_LIMIT : FILE_LIMIT;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit) callback(new Error("归档输出超过限制"));
      else callback(null, chunk);
    },
  });
  const output = outputFile
    ? createWriteStream(outputFile, { flags: "wx" })
    : undefined;
  const writing = output
    ? pipeline(child.stdout, counter, output).catch((error) => {
        streamError = error;
        child.kill();
      })
    : Promise.resolve();
  if (!output)
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        streamError = new Error("文件超过 64 MB");
        child.kill();
      } else chunks.push(chunk);
    });
  child.stderr.on("data", (chunk: Buffer) => {
    if (errors.reduce((sum, part) => sum + part.length, 0) < 12000)
      errors.push(chunk);
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    await writing;
    if (streamError) throw streamError;
    if (code !== 0)
      throw new Error(
        Buffer.concat(errors).toString("utf8").trim() || `Git 退出码 ${code}`,
      );
    return output ? Buffer.alloc(0) : Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    if (outputFile && streamError) await fs.rm(outputFile, { force: true });
  }
}
export async function entryState(
  repo: string,
  entry?: IndexEntry,
): Promise<FileState> {
  if (!entry)
    return { exists: false, mode: "100644", size: 0, sha256: "absent" };
  if (!["100644", "100755"].includes(entry.mode))
    throw new Error(`不处理子模块或链接：${entry.path}`);
  const size = Number((await git(repo, ["cat-file", "-s", entry.hash])).trim());
  if (size > FILE_LIMIT) throw new Error(`文件超过 64 MB：${entry.path}`);
  const data = await gitBytes(repo, ["cat-file", "blob", entry.hash]);
  return {
    exists: true,
    mode: entry.mode,
    size: data.length,
    sha256: digest(data),
    data,
  };
}
