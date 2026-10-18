import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { git, relativeFile } from "./git.ts";
import type { Change, DiffData } from "../shared/types.ts";
import type {
  ShelfRecord,
  ShelfPage,
  OperationResult,
  WorkspacePreview,
} from "../shared/commit-workspace.ts";
import {
  ensureNoRecovery,
  readWorkspaceUnlocked,
  pendingOperations,
} from "./commit-workspace.ts";
import {
  atomicWrite,
  assertOrdinary,
  changes,
  digest,
  fileDigest,
  diskState,
  entryState,
  expandPaths,
  gitBytes,
  headHash,
  indexEntries,
  indexFile,
  putDiskStates,
  putEntries,
  readOptional,
  RECORD_LIMIT,
  safeDirectory,
  seedIndex,
  TEXT_LIMIT,
  treeEntries,
  validId,
  withWorkspace,
  workspaceRoot,
  writeJson,
  type FileState,
} from "./workspace-io.ts";
import {
  applyOperationFiles,
  indexState,
  loadState,
  newOperation,
  readOperation,
  removePrivateIndex,
  saveOperation,
  stateEquals,
  storeState,
  type StoredState,
  type WorkspaceOperation,
} from "./workspace-operations.ts";
import { recoverScopedCommit } from "./commit-index.ts";

interface ShelfPath {
  base: StoredState;
  index: StoredState;
  working: StoredState;
}
interface Manifest extends ShelfRecord {
  schemaVersion: 1;
  pathStates: Record<string, ShelfPath>;
  patchHashes: { working: string; staged: string };
}
const absent = (): FileState => ({
  exists: false,
  mode: "100644",
  size: 0,
  sha256: "absent",
});
const title = (value: unknown) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 100 ||
    value.includes("\0")
  )
    throw new Error("名称须为 1 至 100 个字符");
  return value.trim();
};
export async function workspacePreview(
  repo: string,
  p: Record<string, unknown>,
): Promise<WorkspacePreview> {
  return withWorkspace(repo, async (root) => {
    if (!Array.isArray(p.paths) || !p.paths.length || p.paths.length > 10000)
      throw new Error("请选择明确的文件范围");
    const workspace = await readWorkspaceUnlocked(repo, root),
      head = await headHash(repo),
      index = indexState(await readOptional(await indexFile(repo)));
    const files = [];
    for (const value of [...new Set(p.paths)]) {
      if (typeof value !== "string") throw new Error("无效的文件范围");
      const file = relativeFile(repo, value),
        state = await diskState(repo, file);
      files.push({
        path: file,
        exists: state.exists,
        mode: state.mode,
        sha256: state.sha256,
      });
    }
    if (
      (await headHash(repo)) !== head ||
      !stateEquals(index, indexState(await readOptional(await indexFile(repo))))
    )
      throw new Error("预览期间索引或 HEAD 发生变化，请重试");
    return { revision: workspace.revision, head, index: index.sha256, files };
  });
}
async function verifyPreview(
  repo: string,
  p: Record<string, unknown>,
  paths: string[],
) {
  const preview = p.preview as WorkspacePreview | undefined;
  if (
    !preview ||
    !Array.isArray(preview.files) ||
    preview.head !== (await headHash(repo)) ||
    preview.index !==
      indexState(await readOptional(await indexFile(repo))).sha256
  )
    throw new Error("确认后 HEAD 或索引发生变化，请重新预览并确认");
  if (
    paths.length !== preview.files.length ||
    paths.some((file) => !preview.files.some((item) => item.path === file))
  )
    throw new Error("确认的文件范围已变化");
  for (const file of paths) {
    const wanted = preview.files.find((item) => item.path === file)!;
    if (!stateEquals(await diskState(repo, file), wanted))
      throw new Error(`确认后文件已变化：${file}`);
  }
}
async function loadShelf(root: string, repo: string, id: unknown) {
  validId(id);
  const directory = await safeDirectory(root, `shelves/${id}`),
    file = path.join(directory, "manifest.json"),
    stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
    throw new Error("搁置清单无效或过大");
  const record = JSON.parse(await fs.readFile(file, "utf8")) as Manifest;
  if (
    record.schemaVersion !== 1 ||
    record.id !== id ||
    !Number.isSafeInteger(record.revision) ||
    typeof record.name !== "string" ||
    !Array.isArray(record.files) ||
    !["active", "applied", "deleted"].includes(record.state) ||
    !record.pathStates ||
    typeof record.pathStates !== "object"
  )
    throw new Error("搁置清单损坏或版本不受支持");
  for (const entry of record.files) {
    validId(entry.id);
    if (
      relativeFile(repo, entry.path) !== entry.path ||
      (entry.oldPath && relativeFile(repo, entry.oldPath) !== entry.oldPath)
    )
      throw new Error("搁置文件路径无效");
    for (const file of [entry.path, ...(entry.oldPath ? [entry.oldPath] : [])])
      if (!Object.hasOwn(record.pathStates, file))
        throw new Error("搁置快照清单缺失");
  }
  return { record, directory };
}
function publicShelf(record: Manifest): ShelfRecord {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    baseHead: record.baseHead,
    sourceBranch: record.sourceBranch,
    state: record.state,
    deletedAt: record.deletedAt,
    files: record.files,
    revision: record.revision,
  };
}
async function saveShelf(directory: string, record: Manifest) {
  record.revision++;
  await writeJson(path.join(directory, "manifest.json"), record);
}
export async function shelves(
  repo: string,
  p: Record<string, unknown>,
): Promise<ShelfPage> {
  const root = await workspaceRoot(repo),
    directory = await safeDirectory(root, "shelves"),
    ids = (await fs.readdir(directory)).filter((name) =>
      /^[0-9a-f-]{36}$/.test(name),
    );
  const records: ShelfRecord[] = [];
  for (const id of ids) {
    try {
      const { record } = await loadShelf(root, repo, id);
      if (p.state === undefined || p.state === record.state)
        records.push(publicShelf(record));
    } catch (error) {
      records.push({
        id,
        name: "损坏的搁置记录",
        createdAt: "",
        baseHead: null,
        sourceBranch: "",
        state: "active",
        revision: 0,
        files: [],
        corrupted: (error as Error).message,
      });
    }
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const offset =
    typeof p.offset === "number" &&
    Number.isSafeInteger(p.offset) &&
    p.offset >= 0
      ? p.offset
      : 0;
  return {
    records: records.slice(offset, offset + 100),
    total: records.length,
    hasMore: offset + 100 < records.length,
  };
}
export async function shelfDetail(repo: string, p: Record<string, unknown>) {
  const { record } = await loadShelf(await workspaceRoot(repo), repo, p.id);
  return { record: publicShelf(record) };
}
export async function shelfDiff(
  repo: string,
  p: Record<string, unknown>,
): Promise<DiffData> {
  const { record, directory } = await loadShelf(
      await workspaceRoot(repo),
      repo,
      p.id,
    ),
    file = record.files.find((item) => item.id === p.fileId);
  if (!file) throw new Error("搁置文件已不存在");
  const before = await loadState(
      directory,
      record.pathStates[file.oldPath || file.path].base,
    ),
    after = await loadState(
      directory,
      record.pathStates[file.path][p.staged === true ? "index" : "working"],
    );
  const binary = !!(
      before.data?.includes(0) ||
      after.data?.includes(0) ||
      before.data?.toString("utf8").includes("\ufffd") ||
      after.data?.toString("utf8").includes("\ufffd")
    ),
    truncated = before.size > TEXT_LIMIT || after.size > TEXT_LIMIT;
  return {
    path: file.path,
    before: binary || truncated ? "" : before.data?.toString("utf8") || "",
    after: binary || truncated ? "" : after.data?.toString("utf8") || "",
    raw: "",
    binary,
    truncated,
    beforeLabel: record.baseHead?.slice(0, 12) || "空树",
    afterLabel: `${record.name} · ${p.staged === true ? "暂存版本" : "工作区版本"}`,
    readOnly: true,
  };
}
export async function patchFromStates(
  repo: string,
  directory: string,
  base: Map<string, FileState>,
  target: Map<string, FileState>,
  name: string,
) {
  const before = path.join(directory, `${name}-before.index`),
    after = path.join(directory, `${name}-after.index`),
    patch = path.join(directory, `${name}.patch`);
  try {
    await seedIndex(repo, before, "");
    await putDiskStates(repo, before, base);
    const left = (
      await git(repo, ["write-tree"], undefined, [0], {
        GIT_INDEX_FILE: before,
      })
    ).trim();
    await seedIndex(repo, after, "");
    await putDiskStates(repo, after, target);
    const right = (
      await git(repo, ["write-tree"], undefined, [0], { GIT_INDEX_FILE: after })
    ).trim();
    await gitBytes(
      repo,
      [
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        left,
        right,
      ],
      {},
      patch,
    );
    return patch;
  } finally {
    await removePrivateIndex(before);
    await removePrivateIndex(after);
  }
}
async function verifyCaptured(
  repo: string,
  head: string,
  index: StoredState,
  states: Map<string, FileState>,
) {
  if (
    (await headHash(repo)) !== head ||
    !stateEquals(indexState(await readOptional(await indexFile(repo))), index)
  )
    throw new Error("HEAD 或索引在准备期间发生变化，请刷新");
  for (const [file, state] of states)
    if (!stateEquals(await diskState(repo, file), state))
      throw new Error(`文件在准备期间发生变化：${file}`);
}
function result(
  record: WorkspaceOperation,
  state: OperationResult["state"],
  message: string,
): OperationResult {
  return {
    operationId: record.id,
    state,
    message,
    affectedPaths: record.paths,
    ...(record.commitHash ? { commitHash: record.commitHash } : {}),
  };
}
async function runFiles(
  repo: string,
  root: string,
  record: WorkspaceOperation,
  directory: string,
  trash?: (file: string) => Promise<void>,
  beforeApply?: () => Promise<void>,
) {
  try {
    await applyOperationFiles(
      repo,
      root,
      record,
      directory,
      "after",
      trash,
      beforeApply,
    );
  } catch (error) {
    record.state = "recovery-required";
    record.message = `操作尚未完整结束，备份已保存。${(error as Error).message}`;
    await saveOperation(root, record);
    return result(record, "recovery-required", record.message);
  }
  return null;
}
async function prepareShelfMetadata(
  repo: string,
  root: string,
  operation: WorkspaceOperation,
  operationDirectory: string,
  expectedWorkspaceRevision: number,
  expectedShelfRevision: number,
) {
  if (operation.kind !== "shelf.apply" || !operation.shelfId) return;
  const { record, directory } = await loadShelf(root, repo, operation.shelfId);
  const workspace = await readWorkspaceUnlocked(repo, root);
  if (
    record.revision !== expectedShelfRevision ||
    workspace.revision !== expectedWorkspaceRevision
  )
    throw new Error("准备期间列表或搁置记录已变化，请重新确认");
  if (!workspace.lists.some((list) => list.id === operation.targetListId))
    throw new Error("恢复目标列表已不存在");
  const workspaceBefore = await readOptional(path.join(root, "workspace.json"));
  if (
    workspaceBefore &&
    JSON.stringify(JSON.parse(workspaceBefore.toString("utf8"))) !==
      JSON.stringify(workspace)
  )
    throw new Error("读取期间工作台元数据已变化");
  const shelfBefore = await fs.readFile(path.join(directory, "manifest.json"));
  if (
    JSON.stringify(JSON.parse(shelfBefore.toString("utf8"))) !==
    JSON.stringify(record)
  )
    throw new Error("读取期间搁置清单已变化");
  for (const file of record.files)
    if (operation.shelfFiles?.includes(file.id)) {
      workspace.assignments[file.path] = operation.targetListId!;
      if (!operation.copy) file.applied = true;
    }
  workspace.revision++;
  operation.metadata = {
    workspace: {
      before: await storeState(operationDirectory, indexState(workspaceBefore)),
      after: await storeState(
        operationDirectory,
        indexState(Buffer.from(JSON.stringify(workspace, null, 2))),
      ),
    },
  };
  if (!operation.copy) {
    if (record.files.every((file) => file.applied)) record.state = "applied";
    record.revision++;
    operation.metadata.shelf = {
      before: await storeState(operationDirectory, indexState(shelfBefore)),
      after: await storeState(
        operationDirectory,
        indexState(Buffer.from(JSON.stringify(record, null, 2))),
      ),
    };
  }
}

async function shelfMetadataEntries(
  root: string,
  operation: WorkspaceOperation,
) {
  if (operation.kind !== "shelf.apply") return [];
  if (!operation.metadata)
    throw new Error(
      "旧搁置恢复记录缺少元数据快照，请保留材料手工恢复，不能自动覆盖归属",
    );
  const entries = [
    {
      file: path.join(root, "workspace.json"),
      states: operation.metadata.workspace,
    },
  ];
  if (operation.metadata.shelf) {
    const directory = await safeDirectory(
      root,
      `shelves/${validId(operation.shelfId)}`,
    );
    entries.push({
      file: path.join(directory, "manifest.json"),
      states: operation.metadata.shelf,
    });
  }
  return entries;
}

async function verifyShelfMetadata(
  root: string,
  operation: WorkspaceOperation,
  operationDirectory: string,
) {
  for (const { file, states } of await shelfMetadataEntries(root, operation)) {
    const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stat && (!stat.isFile() || stat.isSymbolicLink()))
      throw new Error("恢复元数据不能是链接或目录");
    const current = indexState(await readOptional(file));
    if (
      !stateEquals(current, states.before) &&
      !stateEquals(current, states.after)
    )
      throw new Error("列表或搁置元数据已有后续编辑，保留恢复材料并拒绝覆盖");
    await loadState(operationDirectory, states.before);
    await loadState(operationDirectory, states.after);
  }
}

async function applyShelfMetadata(
  root: string,
  operation: WorkspaceOperation,
  operationDirectory: string,
  direction: "before" | "after",
) {
  await verifyShelfMetadata(root, operation, operationDirectory);
  for (const { file, states } of await shelfMetadataEntries(root, operation)) {
    const desired = await loadState(operationDirectory, states[direction]);
    const current = indexState(await readOptional(file));
    if (
      !stateEquals(current, states.before) &&
      !stateEquals(current, states.after)
    )
      throw new Error("应用期间元数据发生变化，停止恢复并保留双方材料");
    if (stateEquals(current, desired)) continue;
    if (current.exists && file === path.join(root, "workspace.json"))
      await atomicWrite(`${file}.bak`, current.data!);
    if (desired.exists) await atomicWrite(file, desired.data!);
    else await fs.unlink(file);
  }
}
export async function createShelf(
  repo: string,
  p: Record<string, unknown>,
): Promise<OperationResult> {
  return withWorkspace(repo, async (root) => {
    await ensureNoRecovery(repo);
    const workspace = await readWorkspaceUnlocked(repo, root);
    if (p.expectedRevision !== workspace.revision)
      throw new Error("更改列表已变化，请刷新后重新选择");
    const all = await changes(repo),
      paths = expandPaths(repo, p.paths, all);
    await assertOrdinary(repo, paths);
    if (p.remove === true) await verifyPreview(repo, p, paths);
    const selected = all.filter((item) => paths.includes(item.path)),
      id = randomUUID(),
      directory = await safeDirectory(root, `shelves/.preparing-${id}`),
      baseHead = await headHash(repo);
    if (!baseHead && p.remove === true)
      throw new Error("没有 HEAD 时只能复制到搁置，不能移除本地更改");
    const [baseEntries, currentEntries, rawIndex] = await Promise.all([
        treeEntries(repo, baseHead),
        indexEntries(repo),
        readOptional(await indexFile(repo)),
      ]),
      baseMap = new Map(baseEntries.map((entry) => [entry.path, entry])),
      indexMap = new Map(currentEntries.map((entry) => [entry.path, entry]));
    const base = new Map<string, FileState>(),
      staged = new Map<string, FileState>(),
      working = new Map<string, FileState>(),
      pathStates: Record<string, ShelfPath> = Object.create(null);
    let bytes = 0;
    for (const file of paths) {
      const a = await entryState(repo, baseMap.get(file)),
        b = await entryState(repo, indexMap.get(file)),
        c = await diskState(repo, file);
      if (process.platform === "win32") c.mode = b.exists ? b.mode : a.mode;
      bytes += a.size + b.size + c.size;
      if (bytes > RECORD_LIMIT)
        throw new Error("搁置记录超过 256 MB，尚未清理任何本地内容");
      base.set(file, a);
      staged.set(file, b);
      working.set(file, c);
      pathStates[file] = {
        base: await storeState(directory, a),
        index: await storeState(directory, b),
        working: await storeState(directory, c),
      };
    }
    const workingPatch = await patchFromStates(
        repo,
        directory,
        base,
        working,
        "working",
      ),
      stagedPatch = await patchFromStates(
        repo,
        directory,
        base,
        staged,
        "staged",
      );
    if (
      bytes +
        (await fs.stat(workingPatch)).size +
        (await fs.stat(stagedPatch)).size >
      RECORD_LIMIT
    )
      throw new Error("搁置及补丁总大小超过 256 MB，本地内容未清理");
    const record: Manifest = {
      schemaVersion: 1,
      id,
      name: title(p.name),
      revision: 0,
      createdAt: new Date().toISOString(),
      baseHead: baseHead || null,
      sourceBranch:
        (
          await git(
            repo,
            ["symbolic-ref", "--quiet", "--short", "HEAD"],
            undefined,
            [0, 1],
          )
        ).trim() || "HEAD",
      state: "active",
      files: selected.map((item) => ({
        id: randomUUID(),
        path: item.path,
        oldPath: item.oldPath,
        status: item.oldPath
          ? "renamed"
          : item.index === "A"
            ? "added"
            : item.index === "D" || item.worktree === "D"
              ? "deleted"
              : "modified",
        binary: !!working.get(item.path)?.data?.includes(0),
        applied: false,
        listId: workspace.assignments[item.path] || workspace.activeListId,
        mode: working.get(item.path)?.mode || "100644",
      })),
      pathStates,
      patchHashes: {
        working: await fileDigest(workingPatch),
        staged: await fileDigest(stagedPatch),
      },
    };
    await verifyCaptured(repo, baseHead, indexState(rawIndex), working);
    await writeJson(path.join(directory, "manifest.json"), record);
    const final = path.join(root, "shelves", id);
    await fs.rename(directory, final);
    if (p.remove !== true)
      return {
        operationId: id,
        state: "completed",
        message: "已复制到搁置，工作区和暂存区保持原样。",
        affectedPaths: paths,
      };
    const operation = await newOperation(root, repo, "shelf.create", paths);
    operation.record.shelfId = id;
    const candidate = path.join(operation.directory, "cleanup.index");
    if (rawIndex) await fs.writeFile(candidate, rawIndex, { flag: "wx" });
    else await seedIndex(repo, candidate, "");
    await putEntries(repo, candidate, paths, baseEntries);
    operation.record.afterIndex = await storeState(
      operation.directory,
      indexState(await readOptional(candidate)),
    );
    for (const file of paths)
      operation.record.files.push({
        path: file,
        before: await storeState(operation.directory, working.get(file)!),
        after: await storeState(operation.directory, base.get(file)!),
      });
    await verifyCaptured(repo, baseHead, indexState(rawIndex), working);
    await saveOperation(root, operation.record);
    const failure = await runFiles(
      repo,
      root,
      operation.record,
      operation.directory,
      undefined,
      () => verifyPreview(repo, p, paths),
    );
    if (failure) return failure;
    operation.record.state = "completed";
    operation.record.message =
      "已搁置并移除选中文件的本地改动，完整归档已保留。";
    await saveOperation(root, operation.record);
    await removePrivateIndex(candidate);
    return result(operation.record, "completed", operation.record.message);
  });
}
export async function applyShelf(
  repo: string,
  p: Record<string, unknown>,
): Promise<OperationResult> {
  return withWorkspace(repo, async (root) => {
    await ensureNoRecovery(repo);
    const workspace = await readWorkspaceUnlocked(repo, root);
    if (p.expectedRevision !== workspace.revision)
      throw new Error("更改列表已变化，请刷新后再恢复");
    const { record, directory } = await loadShelf(root, repo, p.id);
    if (p.expectedShelfRevision !== record.revision)
      throw new Error("搁置记录已变化，请刷新");
    if (record.state === "deleted") throw new Error("请先从最近删除恢复该记录");
    if (
      !Array.isArray(p.fileIds) ||
      !p.fileIds.length ||
      !p.fileIds.every(
        (value) =>
          typeof value === "string" &&
          record.files.some((file) => file.id === value),
      )
    )
      throw new Error("请选择完整的搁置文件；重命名前后路径不可拆分");
    const selected = record.files.filter((file) =>
        (p.fileIds as string[]).includes(file.id),
      ),
      paths = [
        ...new Set(
          selected.flatMap((file) => [
            file.path,
            ...(file.oldPath ? [file.oldPath] : []),
          ]),
        ),
      ];
    await assertOrdinary(repo, paths, true, false, false);
    await verifyPreview(repo, p, paths);
    const operation = await newOperation(root, repo, "shelf.apply", paths);
    operation.record.shelfId = record.id;
    operation.record.shelfFiles = selected.map((file) => file.id);
    operation.record.copy = p.copy === true;
    operation.record.targetListId =
      typeof p.targetListId === "string"
        ? p.targetListId
        : workspace.activeListId;
    if (
      !workspace.lists.some((list) => list.id === operation.record.targetListId)
    )
      throw new Error("恢复目标列表已不存在");
    const [all, currentEntries, currentTree] = await Promise.all([
        changes(repo),
        indexEntries(repo),
        treeEntries(repo, operation.record.baseHead),
      ]),
      indexMap = new Map(currentEntries.map((entry) => [entry.path, entry])),
      treeMap = new Map(currentTree.map((entry) => [entry.path, entry]));
    const beforeStates = new Map<string, FileState>(),
      base = new Map<string, FileState>(),
      working = new Map<string, FileState>(),
      staged = new Map<string, FileState>();
    let direct = true,
      materialBytes = operation.record.beforeIndex.size;
    for (const file of paths) {
      const current = await diskState(repo, file),
        original = record.pathStates[file];
      for (const state of [original.base, original.working, original.index])
        if (!Number.isSafeInteger(state?.size) || state.size < 0)
          throw new Error("搁置快照大小无效");
      materialBytes +=
        current.size +
        original.base.size +
        original.working.size +
        original.index.size;
      if (materialBytes > RECORD_LIMIT)
        throw new Error("所选恢复内容及目标文件备份超过 256 MB，文件未修改");
      base.set(file, await loadState(directory, original.base));
      working.set(file, await loadState(directory, original.working));
      staged.set(file, await loadState(directory, original.index));
      if (process.platform === "win32")
        current.mode =
          indexMap.get(file)?.mode || treeMap.get(file)?.mode || current.mode;
      beforeStates.set(file, current);
      if (current.exists && !indexMap.has(file) && !treeMap.has(file))
        throw new Error(`同名未托管文件阻止恢复：${file}`);
      const clean =
        !all.some((item) => item.path === file || item.oldPath === file) &&
        stateEquals(await entryState(repo, treeMap.get(file)), base.get(file)!);
      if (!stateEquals(current, base.get(file)!) && !clean) direct = false;
      if (p.restoreIndex === true) {
        const a = indexMap.get(file),
          b = treeMap.get(file);
        if (
          (a?.hash || "") !== (b?.hash || "") ||
          (a?.mode || "") !== (b?.mode || "")
        )
          throw new Error(`恢复暂存状态要求所选目标路径索引干净：${file}`);
      }
    }
    const workingIndex = path.join(operation.directory, "working.index"),
      realIndex = path.join(operation.directory, "restore.index");
    await seedIndex(repo, workingIndex, operation.record.baseHead);
    await putDiskStates(repo, workingIndex, beforeStates);
    if (direct) await putDiskStates(repo, workingIndex, working);
    else {
      const patch = await patchFromStates(
        repo,
        operation.directory,
        base,
        working,
        "selected-working",
      );
      materialBytes += (await fs.stat(patch)).size;
      if (materialBytes > RECORD_LIMIT)
        throw new Error("恢复材料及补丁超过 256 MB，文件未修改");
      if ((await fs.stat(patch)).size)
        await git(
          repo,
          ["apply", "--cached", "--binary", "--whitespace=nowarn", patch],
          undefined,
          [0],
          { GIT_INDEX_FILE: workingIndex },
        );
    }
    const originalIndex = await loadState(
      operation.directory,
      operation.record.beforeIndex,
    );
    if (originalIndex.exists)
      await fs.writeFile(realIndex, originalIndex.data!, { flag: "wx" });
    else await seedIndex(repo, realIndex, "");
    if (p.restoreIndex === true) {
      const patch = await patchFromStates(
        repo,
        operation.directory,
        base,
        staged,
        "selected-staged",
      );
      materialBytes += (await fs.stat(patch)).size;
      if (materialBytes > RECORD_LIMIT)
        throw new Error("恢复材料及补丁超过 256 MB，文件未修改");
      if ((await fs.stat(patch)).size)
        await git(
          repo,
          ["apply", "--cached", "--binary", "--whitespace=nowarn", patch],
          undefined,
          [0],
          { GIT_INDEX_FILE: realIndex },
        );
    }
    const finalMap = new Map(
      (await indexEntries(repo, workingIndex)).map((entry) => [
        entry.path,
        entry,
      ]),
    );
    let recoveryBytes = operation.record.beforeIndex.size;
    for (const file of paths) {
      const before = beforeStates.get(file)!,
        after = await entryState(repo, finalMap.get(file));
      recoveryBytes += before.size + after.size;
      if (recoveryBytes > RECORD_LIMIT)
        throw new Error("恢复操作备份超过 256 MB，文件未修改");
      operation.record.files.push({
        path: file,
        before: await storeState(operation.directory, before),
        after: await storeState(operation.directory, after),
      });
    }
    const candidateState = indexState(await readOptional(realIndex));
    if (recoveryBytes + candidateState.size > RECORD_LIMIT)
      throw new Error("恢复操作及索引备份超过 256 MB，文件未修改");
    operation.record.afterIndex = await storeState(
      operation.directory,
      candidateState,
    );
    await prepareShelfMetadata(
      repo,
      root,
      operation.record,
      operation.directory,
      workspace.revision,
      record.revision,
    );
    const metadata = operation.record.metadata!;
    const metadataBytes =
      metadata.workspace.before.size +
      metadata.workspace.after.size +
      (metadata.shelf
        ? metadata.shelf.before.size + metadata.shelf.after.size
        : 0);
    if (recoveryBytes + candidateState.size + metadataBytes > RECORD_LIMIT)
      throw new Error("恢复操作及元数据备份超过 256 MB，文件未修改");
    await verifyCaptured(
      repo,
      operation.record.baseHead,
      operation.record.beforeIndex,
      beforeStates,
    );
    await saveOperation(root, operation.record);
    const failure = await runFiles(
      repo,
      root,
      operation.record,
      operation.directory,
      undefined,
      async () => {
        await verifyPreview(repo, p, paths);
        await verifyShelfMetadata(root, operation.record, operation.directory);
      },
    );
    if (failure) return failure;
    try {
      await applyShelfMetadata(
        root,
        operation.record,
        operation.directory,
        "after",
      );
      operation.record.state = "completed";
      operation.record.message =
        p.copy === true
          ? "已复制搁置内容到工作区，原搁置保留。"
          : "已取消搁置并恢复选中文件。";
      await saveOperation(root, operation.record);
    } catch (error) {
      operation.record.state = "recovery-required";
      operation.record.message = `文件已恢复，归属记录尚未完成：${(error as Error).message}`;
      await saveOperation(root, operation.record);
      return result(
        operation.record,
        "recovery-required",
        operation.record.message,
      );
    }
    await removePrivateIndex(workingIndex);
    await removePrivateIndex(realIndex);
    return result(operation.record, "completed", operation.record.message);
  });
}
export async function archiveFileAction(
  repo: string,
  action: string,
  p: Record<string, unknown>,
  trash?: (file: string) => Promise<void>,
): Promise<OperationResult> {
  return withWorkspace(repo, async (root) => {
    await ensureNoRecovery(repo);
    const workspace = await readWorkspaceUnlocked(repo, root);
    if (p.expectedRevision !== workspace.revision)
      throw new Error("文件列表已变化，请刷新");
    const all = await changes(repo),
      paths = expandPaths(repo, p.paths, all);
    await assertOrdinary(repo, paths, true);
    await verifyPreview(repo, p, paths);
    const operation = await newOperation(root, repo, action, paths),
      [entries, tree] = await Promise.all([
        indexEntries(repo),
        treeEntries(repo, operation.record.baseHead),
      ]),
      source = new Map(
        (p.full === true ? tree : entries).map((entry) => [entry.path, entry]),
      );
    const candidate = path.join(operation.directory, "action.index"),
      original = await loadState(
        operation.directory,
        operation.record.beforeIndex,
      );
    if (original.exists)
      await fs.writeFile(candidate, original.data!, { flag: "wx" });
    else await seedIndex(repo, candidate, "");
    if (action === "file.rollback" && p.full === true)
      await putEntries(repo, candidate, paths, tree);
    let size = 0;
    for (const file of paths) {
      const before = await diskState(repo, file),
        after =
          action === "file.trash"
            ? absent()
            : await entryState(repo, source.get(file));
      size += before.size + after.size;
      if (size > RECORD_LIMIT)
        throw new Error("回收或回滚备份超过 256 MB，文件未修改");
      operation.record.files.push({
        path: file,
        before: await storeState(operation.directory, before),
        after: await storeState(operation.directory, after),
      });
    }
    operation.record.afterIndex = await storeState(
      operation.directory,
      indexState(await readOptional(candidate)),
    );
    await saveOperation(root, operation.record);
    const failure = await runFiles(
      repo,
      root,
      operation.record,
      operation.directory,
      trash,
      () => verifyPreview(repo, p, paths),
    );
    if (failure) return failure;
    operation.record.state = "completed";
    operation.record.message =
      action === "file.trash"
        ? "文件已移至回收位置，未自动暂存删除；内部备份可恢复。"
        : "回滚已完成，原始内容和索引备份可恢复。";
    await saveOperation(root, operation.record);
    await removePrivateIndex(candidate);
    return result(operation.record, "completed", operation.record.message);
  });
}
export async function mutateShelf(
  repo: string,
  action: string,
  p: Record<string, unknown>,
): Promise<string | OperationResult> {
  if (action === "shelf.create") return createShelf(repo, p);
  if (action === "shelf.apply") return applyShelf(repo, p);
  if (action === "file.trash" || action === "file.rollback")
    return archiveFileAction(repo, action, p);
  return withWorkspace(repo, async (root) => {
    if (action === "operation.recover") {
      const { record, directory } = await readOperation(
        root,
        repo,
        validId(p.id),
      );
      if (record.kind === "commit") {
        if (p.direction === "before")
          throw new Error("提交已创建；恢复不会撤销提交，只能完成索引同步");
        return recoverScopedCommit(repo, root, record.id);
      }
      const direction = p.direction === "before" ? "before" : "after";
      await verifyShelfMetadata(root, record, directory);
      await applyOperationFiles(
        repo,
        root,
        record,
        directory,
        direction,
        undefined,
        () => verifyShelfMetadata(root, record, directory),
      );
      await applyShelfMetadata(root, record, directory, direction);
      record.state = direction === "after" ? "completed" : "rolled-back";
      record.message =
        direction === "after" ? "已完成中断操作" : "已从备份恢复操作前内容";
      await saveOperation(root, record);
      return result(record, "completed", record.message);
    }
    await ensureNoRecovery(repo);
    const { record, directory } = await loadShelf(root, repo, p.id);
    if (p.expectedShelfRevision !== record.revision)
      throw new Error("搁置记录已变化，请刷新后重试");
    if (action === "shelf.rename") record.name = title(p.name);
    else if (action === "shelf.delete") {
      record.state = "deleted";
      record.deletedAt = new Date().toISOString();
    } else if (action === "shelf.restore") {
      if (record.state !== "deleted") throw new Error("该记录不在最近删除中");
      record.state = record.files.every((file) => file.applied)
        ? "applied"
        : "active";
      delete record.deletedAt;
    } else if (action === "shelf.purge") {
      if (record.state !== "deleted" || p.confirmPermanent !== true)
        throw new Error("只能明确确认后永久删除最近删除的记录");
      const realRoot = await fs.realpath(path.join(root, "shelves")),
        realTarget = await fs.realpath(directory),
        relative = path.relative(realRoot, realTarget);
      if (
        relative !== record.id ||
        path.isAbsolute(relative) ||
        relative.includes(path.sep)
      )
        throw new Error("永久删除目标超出搁置目录");
      await fs.rm(realTarget, { recursive: true, force: false });
      return "搁置已永久删除";
    } else throw new Error("未知的搁置操作");
    await saveShelf(directory, record);
    return "搁置记录已更新";
  });
}
export async function recoveryRecords(repo: string) {
  const root = await workspaceRoot(repo),
    directory = await safeDirectory(root, "operations"),
    records = [];
  for (const file of await fs.readdir(directory)) {
    if (!/^[0-9a-f-]{36}\.json$/.test(file)) continue;
    try {
      const { record } = await readOperation(root, repo, file.slice(0, -5));
      if (
        record.kind !== "commit" ||
        !["completed", "rolled-back"].includes(record.state)
      )
        records.push({
          id: record.id,
          kind: record.kind,
          createdAt: record.createdAt,
          state: record.state,
          paths: record.paths,
          message: record.message,
          commitHash: record.commitHash,
        });
    } catch {
      /* Corrupt entries are also returned by pendingOperations. */
    }
  }
  const pending = await pendingOperations(root);
  for (const item of pending)
    if (!records.some((record) => record.id === item.id)) records.push(item);
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function operationDiff(
  repo: string,
  p: Record<string, unknown>,
): Promise<DiffData> {
  const { record, directory } = await readOperation(
      await workspaceRoot(repo),
      repo,
      validId(p.id),
    ),
    file = record.files.find((item) => item.path === p.path);
  if (!file) throw new Error("该操作没有此文件的内容备份");
  const [before, after] = await Promise.all([
      loadState(directory, file.before),
      loadState(directory, file.after),
    ]),
    binary = !!(before.data?.includes(0) || after.data?.includes(0)),
    truncated = before.size > TEXT_LIMIT || after.size > TEXT_LIMIT;
  return {
    path: file.path,
    before: binary || truncated ? "" : before.data?.toString("utf8") || "",
    after: binary || truncated ? "" : after.data?.toString("utf8") || "",
    raw: "",
    binary,
    truncated,
    beforeLabel: "操作前备份",
    afterLabel: "操作目标内容",
    readOnly: true,
  };
}
export async function archivedFileBytes(
  repo: string,
  p: Record<string, unknown>,
) {
  const root = await workspaceRoot(repo);
  if (p.source === "shelf") {
    const { record, directory } = await loadShelf(root, repo, p.id),
      file = record.files.find((item) => item.id === p.fileId);
    if (!file) throw new Error("搁置文件不存在");
    const key =
        p.version === "base"
          ? "base"
          : p.version === "index"
            ? "index"
            : "working",
      name = key === "base" ? file.oldPath || file.path : file.path,
      state = await loadState(directory, record.pathStates[name][key]);
    if (!state.exists) throw new Error("该版本中文件不存在");
    return { name: path.basename(name), data: state.data! };
  }
  if (p.source === "operation") {
    const { record, directory } = await readOperation(
        root,
        repo,
        validId(p.id),
      ),
      file = record.files.find((item) => item.path === p.path);
    if (!file) throw new Error("操作备份中没有此文件");
    const state = await loadState(
      directory,
      p.version === "after" ? file.after : file.before,
    );
    if (!state.exists) throw new Error("该版本中文件不存在");
    return { name: path.basename(file.path), data: state.data! };
  }
  throw new Error("无效的归档来源");
}

export async function prepareShelfPatch(
  repo: string,
  p: Record<string, unknown>,
) {
  return withWorkspace(repo, async (root) => {
    const { record, directory: archive } = await loadShelf(root, repo, p.id);
    if (
      !Array.isArray(p.fileIds) ||
      !p.fileIds.length ||
      p.fileIds.some(
        (id) =>
          typeof id !== "string" || !record.files.some((f) => f.id === id),
      )
    )
      throw new Error("请选择搁置文件");
    const selected = record.files.filter((file) =>
      (p.fileIds as string[]).includes(file.id),
    );
    const base = new Map<string, FileState>(),
      target = new Map<string, FileState>();
    let bytes = 0;
    for (const file of selected)
      for (const name of new Set([
        file.path,
        ...(file.oldPath ? [file.oldPath] : []),
      ])) {
        const saved = record.pathStates[name];
        const before = await loadState(archive, saved.base),
          after = await loadState(
            archive,
            p.staged === true ? saved.index : saved.working,
          );
        bytes += before.size + after.size;
        if (bytes > RECORD_LIMIT) throw new Error("所选补丁材料超过 256 MB");
        base.set(name, before);
        target.set(name, after);
      }
    const output = await safeDirectory(root, `exports/${randomUUID()}`),
      file = await patchFromStates(repo, output, base, target, "shelf");
    return {
      file,
      size: (await fs.stat(file)).size,
      name: "shelf-changes.patch",
    };
  });
}
