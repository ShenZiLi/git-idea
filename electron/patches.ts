import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { diff } from "./git.ts";
import { shelfDiff, operationDiff, patchFromStates } from "./shelves.ts";
import { assertOrdinary, changes, diskState, entryState, expandPaths, headHash, indexEntries, indexFile, readOptional, digest, safeDirectory, treeEntries, withWorkspace, RECORD_LIMIT, type FileState } from "./workspace-io.ts";

export const CLIPBOARD_LIMIT = 8 * 1024 * 1024;
export async function preparePatch(repo: string, p: Record<string, unknown>) {
  return withWorkspace(repo, async root => {
    const all = await changes(repo), paths = expandPaths(repo, p.paths, all);
    await assertOrdinary(repo, paths, true);
    const head = await headHash(repo), original = await readOptional(await indexFile(repo));
    const [baseEntries, stagedEntries] = await Promise.all([treeEntries(repo, head), indexEntries(repo)]);
    const base = new Map<string, FileState>(), target = new Map<string, FileState>();
    let bytes = 0;
    for (const name of paths) {
      const before = await entryState(repo, baseEntries.find(e => e.path === name));
      const after = p.staged === true ? await entryState(repo, stagedEntries.find(e => e.path === name && e.stage === 0)) : await diskState(repo, name);
      bytes += before.size + after.size;
      if (bytes > RECORD_LIMIT) throw new Error("补丁材料超过 256 MB，请缩小选择范围");
      base.set(name, before); target.set(name, after);
    }
    const directory = await safeDirectory(root, `exports/${randomUUID()}`);
    const file = await patchFromStates(repo, directory, base, target, "changes");
    if (head !== await headHash(repo) || digest(original || Buffer.alloc(0)) !== digest((await readOptional(await indexFile(repo))) || Buffer.alloc(0))) throw new Error("生成补丁时仓库已变化，请重试");
    if (p.staged !== true) for (const [name, state] of target) {
      const current = await diskState(repo, name);
      if (current.exists !== state.exists || current.sha256 !== state.sha256) throw new Error("生成补丁时文件已变化，请重试");
    }
    return { file, size: (await fs.stat(file)).size, name: path.basename(repo) + "-changes.patch" };
  });
}
export async function patchPreview(repo: string, p: Record<string, unknown>) {
  const patch = await preparePatch(repo, p);
  return { size: patch.size, tooLarge: patch.size > CLIPBOARD_LIMIT, text: patch.size > CLIPBOARD_LIMIT ? "" : await fs.readFile(patch.file, "utf8"), name: patch.name };
}
export async function readonlyDiff(repo: string, source: Record<string, unknown>) {
  if (source.kind === "shelf") return shelfDiff(repo, source);
  if (source.kind === "operation") return operationDiff(repo, source);
  if (source.kind === "file") return { ...await diff(repo, { path: source.path, staged: source.staged === true, commit: source.commit, oldPath: source.oldPath }), readOnly: true };
  throw new Error("无效的只读差异来源");
}
