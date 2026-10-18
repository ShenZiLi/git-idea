import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { diff } from "./git.ts";
import { stashDiff } from "./stashes.ts";
import {
  shelfDiff,
  operationDiff,
  patchFromStates,
  prepareShelfPatch,
} from "./shelves.ts";
import {
  assertOrdinary,
  changes,
  diskState,
  entryState,
  expandPaths,
  headHash,
  indexEntries,
  indexFile,
  readOptional,
  safeDirectory,
  treeEntries,
  validId,
  withWorkspace,
  workspaceRoot,
  RECORD_LIMIT,
  type FileState,
} from "./workspace-io.ts";

export const CLIPBOARD_LIMIT = 8 * 1024 * 1024;

export async function discardPatch(repo: string, file: string) {
  const exportsRoot = path.join(await workspaceRoot(repo), "exports");
  const directory = path.resolve(path.dirname(file)),
    id = path.relative(exportsRoot, directory);
  validId(id);
  for (const location of [exportsRoot, directory]) {
    const stat = await fs.lstat(location);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("临时补丁目录无效");
  }
  const realRoot = await fs.realpath(exportsRoot),
    realDirectory = await fs.realpath(directory);
  if (path.relative(realRoot, realDirectory) !== id)
    throw new Error("临时补丁清理目标超出导出目录");
  await fs.rm(realDirectory, { recursive: true, force: false });
}

export async function preparePatch(repo: string, p: Record<string, unknown>) {
  if (p.staged !== undefined && typeof p.staged !== "boolean")
    throw new Error("无效的补丁版本");
  if (p.source === "shelf") return prepareShelfPatch(repo, p);
  if (p.source !== undefined && p.source !== "workspace")
    throw new Error("无效的补丁来源");
  return withWorkspace(repo, async (root) => {
    const all = await changes(repo),
      paths = expandPaths(repo, p.paths, all);
    await assertOrdinary(repo, paths);
    const head = await headHash(repo),
      original = await readOptional(await indexFile(repo));
    const [baseEntries, stagedEntries] = await Promise.all([
      treeEntries(repo, head),
      indexEntries(repo),
    ]);
    const baseEntriesByPath = new Map(
      baseEntries.map((entry) => [entry.path, entry]),
    );
    const stagedEntriesByPath = new Map(
      stagedEntries
        .filter((entry) => entry.stage === 0)
        .map((entry) => [entry.path, entry]),
    );
    const base = new Map<string, FileState>(),
      target = new Map<string, FileState>();
    let bytes = 0;
    for (const name of paths) {
      const before = await entryState(repo, baseEntriesByPath.get(name));
      const after =
        p.staged === true
          ? await entryState(repo, stagedEntriesByPath.get(name))
          : await diskState(repo, name);
      if (p.staged !== true && process.platform === "win32")
        after.mode =
          stagedEntriesByPath.get(name)?.mode ||
          baseEntriesByPath.get(name)?.mode ||
          after.mode;
      bytes += before.size + after.size;
      if (bytes > RECORD_LIMIT)
        throw new Error("补丁材料超过 256 MB，请缩小选择范围");
      base.set(name, before);
      target.set(name, after);
    }
    const directory = await safeDirectory(root, `exports/${randomUUID()}`);
    try {
      const file = await patchFromStates(
        repo,
        directory,
        base,
        target,
        "changes",
      );
      const currentIndex = await readOptional(await indexFile(repo));
      if (
        head !== (await headHash(repo)) ||
        (original === null
          ? currentIndex !== null
          : currentIndex === null || !original.equals(currentIndex))
      )
        throw new Error("生成补丁时仓库已变化，请重试");
      if (p.staged !== true)
        for (const [name, state] of target) {
          const current = await diskState(repo, name);
          if (
            current.exists !== state.exists ||
            current.sha256 !== state.sha256 ||
            (process.platform !== "win32" && current.mode !== state.mode)
          )
            throw new Error("生成补丁时文件已变化，请重试");
        }
      return {
        file,
        size: (await fs.stat(file)).size,
        name: path.basename(repo) + "-changes.patch",
      };
    } catch (error) {
      await discardPatch(repo, path.join(directory, "changes.patch")).catch(
        () => {},
      );
      throw error;
    }
  });
}
export async function patchPreview(repo: string, p: Record<string, unknown>) {
  const patch = await preparePatch(repo, p);
  try {
    return {
      size: patch.size,
      tooLarge: patch.size > CLIPBOARD_LIMIT,
      text:
        patch.size > CLIPBOARD_LIMIT
          ? ""
          : await fs.readFile(patch.file, "utf8"),
      name: patch.name,
    };
  } finally {
    await discardPatch(repo, patch.file).catch(() => {});
  }
}
export async function readonlyDiff(
  repo: string,
  source: Record<string, unknown>,
) {
  if (source.kind === "stash") return stashDiff(repo, source);
  if (source.kind === "shelf") return shelfDiff(repo, source);
  if (source.kind === "operation") return operationDiff(repo, source);
  if (source.kind === "file")
    return {
      ...(await diff(repo, {
        path: source.path,
        staged: source.staged === true,
        commit: source.commit,
        oldPath: source.oldPath,
      })),
      readOnly: true,
    };
  throw new Error("无效的只读差异来源");
}
