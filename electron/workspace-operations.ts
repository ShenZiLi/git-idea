import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { relativeFile } from "./git.ts";
import {
  atomicWrite,
  digest,
  diskState,
  headHash,
  indexFile,
  readOptional,
  RECORD_LIMIT,
  safeDirectory,
  validId,
  writeDiskState,
  writeJson,
  type FileState,
} from "./workspace-io.ts";

export interface StoredState {
  exists: boolean;
  mode: string;
  size: number;
  sha256: string;
  content?: string;
}
export interface OperationFile {
  path: string;
  before: StoredState;
  after: StoredState;
}
export interface WorkspaceOperation {
  schemaVersion: 1;
  id: string;
  kind: string;
  state:
    | "prepared"
    | "applying"
    | "completed"
    | "rolled-back"
    | "recovery-required"
    | "committed-index-pending";
  createdAt: string;
  paths: string[];
  message: string;
  baseHead: string;
  commitHash?: string;
  beforeIndex: StoredState;
  afterIndex?: StoredState;
  files: OperationFile[];
  shelfId?: string;
  shelfFiles?: string[];
  targetListId?: string;
  copy?: boolean;
  metadata?: {
    workspace: { before: StoredState; after: StoredState };
    shelf?: { before: StoredState; after: StoredState };
  };
}
export async function storeState(
  directory: string,
  state: FileState,
): Promise<StoredState> {
  if (!state.exists)
    return { exists: false, mode: state.mode, size: 0, sha256: "absent" };
  if (!state.data || digest(state.data) !== state.sha256)
    throw new Error("待归档内容摘要不匹配");
  const snapshots = await safeDirectory(directory, "snapshots"),
    file = path.join(snapshots, state.sha256);
  try {
    await fs.writeFile(file, state.data, { flag: "wx" });
    const handle = await fs.open(file, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stat = await fs.lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      digest(await fs.readFile(file)) !== state.sha256
    )
      throw new Error("已有快照损坏或是链接，停止归档");
  }
  return {
    exists: true,
    mode: state.mode,
    size: state.size,
    sha256: state.sha256,
    content: state.sha256,
  };
}
export async function loadState(
  directory: string,
  value: StoredState,
): Promise<FileState> {
  if (
    !value ||
    typeof value.exists !== "boolean" ||
    !/^100(644|755)$/.test(value.mode) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    value.size > RECORD_LIMIT ||
    typeof value.sha256 !== "string"
  )
    throw new Error("快照清单损坏");
  if (!value.exists) {
    if (value.sha256 !== "absent") throw new Error("缺失文件快照状态无效");
    return { ...value };
  }
  if (
    value.content !== value.sha256 ||
    !/^[a-f0-9]{64}$/.test(value.content || "")
  )
    throw new Error("快照标识无效");
  const snapshots = await safeDirectory(directory, "snapshots"),
    file = path.join(snapshots, value.content!);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== value.size)
    throw new Error("快照文件缺失或大小不符");
  const data = await fs.readFile(file);
  if (digest(data) !== value.sha256) throw new Error("快照摘要不符，不能恢复");
  return { ...value, data };
}
export const stateEquals = (
  a: Pick<FileState, "exists" | "sha256" | "mode">,
  b: Pick<FileState, "exists" | "sha256" | "mode">,
) =>
  a.exists === b.exists &&
  a.sha256 === b.sha256 &&
  (!a.exists || process.platform === "win32" || a.mode === b.mode);
export function indexState(data: Buffer | null): FileState {
  return data
    ? {
        exists: true,
        mode: "100644",
        size: data.length,
        sha256: digest(data),
        data,
      }
    : { exists: false, mode: "100644", size: 0, sha256: "absent" };
}
export async function newOperation(
  root: string,
  repo: string,
  kind: string,
  paths: string[],
): Promise<{ record: WorkspaceOperation; directory: string }> {
  const id = randomUUID(),
    directory = await safeDirectory(root, `operations/${id}`),
    data = await readOptional(await indexFile(repo));
  if (data && data.length > RECORD_LIMIT)
    throw new Error("原始索引备份超过 256 MB，操作未开始");
  const record: WorkspaceOperation = {
    schemaVersion: 1,
    id,
    kind,
    state: "prepared",
    createdAt: new Date().toISOString(),
    paths,
    message: "操作已准备，尚未完成",
    baseHead: await headHash(repo),
    beforeIndex: await storeState(directory, indexState(data)),
    files: [],
  };
  return { record, directory };
}
export async function saveOperation(root: string, record: WorkspaceOperation) {
  validId(record.id);
  await writeJson(
    path.join(await safeDirectory(root, "operations"), `${record.id}.json`),
    record,
  );
}
export async function readOperation(root: string, repo: string, id: string) {
  validId(id);
  const operations = await safeDirectory(root, "operations"),
    file = path.join(operations, `${id}.json`),
    stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
    throw new Error("恢复记录无效");
  const record = JSON.parse(
    await fs.readFile(file, "utf8"),
  ) as WorkspaceOperation;
  if (
    record.schemaVersion !== 1 ||
    record.id !== id ||
    !Array.isArray(record.paths) ||
    !Array.isArray(record.files)
  )
    throw new Error("恢复记录格式无效");
  for (const name of record.paths)
    if (typeof name !== "string" || relativeFile(repo, name) !== name)
      throw new Error("恢复记录路径无效");
  for (const entry of record.files)
    if (!record.paths.includes(entry.path))
      throw new Error("恢复文件不在操作范围内");
  return { record, directory: await safeDirectory(root, `operations/${id}`) };
}
export async function withIndexLock<T>(
  repo: string,
  action: (lock: {
    publish: (data: Buffer | null) => Promise<void>;
  }) => Promise<T>,
) {
  const file = await indexFile(repo),
    lockFile = `${file}.lock`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let owned = false;
  try {
    try {
      handle = await fs.open(lockFile, "wx");
      owned = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("Git 索引已被其他程序锁定，请稍后重试");
      throw error;
    }
    return await action({
      publish: async (data) => {
        if (!handle) throw new Error("索引锁已发布");
        if (data) {
          await handle.writeFile(data);
          await handle.sync();
          await handle.close();
          handle = undefined;
          await fs.rename(lockFile, file);
          owned = false;
        } else {
          await fs.rm(file, { force: true });
          await handle.close();
          handle = undefined;
          await fs.unlink(lockFile);
          owned = false;
        }
      },
    });
  } finally {
    await handle?.close();
    if (owned) await fs.unlink(lockFile);
  }
}
export async function applyOperationFiles(
  repo: string,
  root: string,
  record: WorkspaceOperation,
  directory: string,
  direction: "before" | "after",
  trash?: (absolutePath: string) => Promise<void>,
  beforeApply?: () => Promise<void>,
) {
  const expectedHead = record.commitHash || record.baseHead;
  if ((await headHash(repo)) !== expectedHead)
    throw new Error("HEAD 已发生后续变化，请保留恢复材料并手工处理，不会覆盖");
  const desiredIndex =
    record[direction === "after" ? "afterIndex" : "beforeIndex"];
  if (!desiredIndex) throw new Error("候选索引尚未准备完成，不能继续该操作");
  await withIndexLock(repo, async (lock) => {
    const currentIndex = indexState(await readOptional(await indexFile(repo)));
    if (
      !stateEquals(currentIndex, record.beforeIndex) &&
      (!record.afterIndex || !stateEquals(currentIndex, record.afterIndex))
    )
      throw new Error("索引已有后续变化，不会覆盖。请保留恢复材料手工处理。");
    const observed = new Map<string, FileState>();
    for (const file of record.files) {
      const current = await diskState(repo, file.path);
      if (
        !stateEquals(current, file.before) &&
        !stateEquals(current, file.after)
      )
        throw new Error(`文件有后续编辑，拒绝覆盖：${file.path}`);
      observed.set(file.path, current);
      await loadState(directory, file[direction]);
    }
    const targetIndex = await loadState(directory, desiredIndex);
    await beforeApply?.();
    if ((await headHash(repo)) !== expectedHead)
      throw new Error("开始应用前 HEAD 已变化，文件未修改");
    record.state = "applying";
    await saveOperation(root, record);
    for (const file of record.files) {
      const current = await diskState(repo, file.path);
      if (!stateEquals(current, observed.get(file.path)!))
        throw new Error(`应用期间文件发生变化：${file.path}`);
      const desired = await loadState(directory, file[direction]);
      if (!stateEquals(current, desired)) {
        if (
          trash &&
          direction === "after" &&
          record.kind === "file.trash" &&
          !desired.exists
        )
          await trash(path.join(repo, relativeFile(repo, file.path)));
        else await writeDiskState(repo, file.path, desired);
      }
    }
    if ((await headHash(repo)) !== expectedHead)
      throw new Error("应用期间 HEAD 已变化，需检查恢复材料");
    await lock.publish(targetIndex.exists ? targetIndex.data! : null);
  });
}
export async function removePrivateIndex(file: string) {
  await fs.rm(file, { force: true });
  await fs.rm(`${file}.lock`, { force: true });
}
