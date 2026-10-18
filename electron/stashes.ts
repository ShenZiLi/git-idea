import { git, relativeFile } from "./git.ts";
import {
  entryState,
  treeEntries,
  TEXT_LIMIT,
  type IndexEntry,
} from "./workspace-io.ts";
import type { DiffData } from "../shared/types.ts";
export async function resolveStash(repo: string, value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value)
  )
    throw new Error("请刷新储藏列表后重试");
  const rows = await git(repo, ["stash", "list", "--format=%gd%x00%H"]);
  const row = rows
    .trim()
    .split("\n")
    .map((r) => r.split("\0"))
    .find((r) => r[1] === value);
  if (!row) throw new Error("该储藏已被删除，请刷新列表");
  return { ref: row[0], hash: value };
}
const differs = (before?: IndexEntry, after?: IndexEntry) =>
  before?.hash !== after?.hash || before?.mode !== after?.mode;

async function stashContents(repo: string, value: unknown) {
  const { hash } = await resolveStash(repo, value);
  const parents = (await git(repo, ["show", "-s", "--format=%P", hash]))
    .trim()
    .split(" ");
  if (parents.length < 2) throw new Error("储藏缺少基线或暂存快照，不能预览");
  const trees = await Promise.all([
    treeEntries(repo, parents[0]),
    treeEntries(repo, parents[1]),
    treeEntries(repo, hash),
    parents[2] ? treeEntries(repo, parents[2]) : Promise.resolve([]),
  ]);
  const [base, staged, working, untracked] = trees.map(
    (entries) => new Map(entries.map((entry) => [entry.path, entry])),
  );
  const names = new Set([
    ...base.keys(),
    ...staged.keys(),
    ...working.keys(),
    ...untracked.keys(),
  ]);
  const files = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      path,
      untracked: untracked.has(path),
      staged: differs(base.get(path), staged.get(path)),
      working:
        untracked.has(path) || differs(base.get(path), working.get(path)),
    }))
    .filter((file) => file.staged || file.working);
  return { base, staged, working, untracked, files };
}
export async function stashFiles(repo: string, p: Record<string, unknown>) {
  return (await stashContents(repo, p.hash)).files;
}
export async function stashDiff(
  repo: string,
  p: Record<string, unknown>,
): Promise<DiffData> {
  const name = relativeFile(repo, String(p.path || ""));
  if (p.staged !== undefined && typeof p.staged !== "boolean")
    throw new Error("无效的储藏预览版本");
  const contents = await stashContents(repo, p.hash);
  const selected = contents.files.find((file) => file.path === name);
  if (!selected) throw new Error("该储藏中没有此文件改动");
  const staged =
    p.staged === true ||
    (p.staged === undefined && selected.staged && !selected.working);
  if (staged && selected.untracked) throw new Error("未托管文件没有暂存快照");
  const [before, after] = await Promise.all([
    entryState(repo, selected.untracked ? undefined : contents.base.get(name)),
    entryState(
      repo,
      (staged
        ? contents.staged
        : selected.untracked
          ? contents.untracked
          : contents.working
      ).get(name),
    ),
  ]);
  const binary = !!(before.data?.includes(0) || after.data?.includes(0)),
    truncated = before.size > TEXT_LIMIT || after.size > TEXT_LIMIT;
  return {
    path: name,
    before: binary || truncated ? "" : before.data?.toString("utf8") || "",
    after: binary || truncated ? "" : after.data?.toString("utf8") || "",
    raw: "",
    binary,
    truncated,
    beforeLabel: "储藏基线",
    afterLabel: staged
      ? "储藏暂存内容"
      : selected.untracked
        ? "储藏未托管内容"
        : "储藏工作区内容",
    readOnly: true,
  };
}
