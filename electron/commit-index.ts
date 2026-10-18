import { promises as fs } from "node:fs";
import path from "node:path";
import { git, relativeFile } from "./git.ts";
import { lineChanges } from "../shared/line-changes.ts";
import type {
  CommitScope,
  OperationResult,
} from "../shared/commit-workspace.ts";
import { ensureNoRecovery, readWorkspaceUnlocked } from "./commit-workspace.ts";
import {
  assertOrdinary,
  changes,
  digest,
  headHash,
  indexEntries,
  indexFile,
  putEntries,
  readOptional,
  seedIndex,
  treeEntries,
  withWorkspace,
  type IndexEntry,
} from "./workspace-io.ts";
import {
  indexState,
  newOperation,
  removePrivateIndex,
  saveOperation,
  stateEquals,
  storeState,
  withIndexLock,
  readOperation,
  loadState,
  type WorkspaceOperation,
} from "./workspace-operations.ts";

async function currentRef(repo: string) {
  return (
    await git(repo, ["symbolic-ref", "--quiet", "HEAD"], undefined, [0, 1])
  ).trim();
}

async function ownedCommit(repo: string, record: WorkspaceOperation) {
  if (
    !Array.isArray(record.commitParents) ||
    typeof record.commitRef !== "string"
  )
    throw new Error("恢复记录缺少提交归属验证上下文，请保留材料手工核对");
  const prefix = `Git IDEA scoped ${record.id}`;
  const reflog = await git(
    repo,
    [
      "reflog",
      "show",
      "--fixed-strings",
      `--grep-reflog=${prefix}`,
      "--format=%H%x00%gs",
      "HEAD",
    ],
    undefined,
    [0, 128],
  );
  const hashes = [
    ...new Set(
      reflog
        .split("\n")
        .map((row) => row.split("\0"))
        .filter(
          (row) =>
            /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(row[0]) &&
            (row[1] === prefix || row[1]?.startsWith(`${prefix}: `)),
        )
        .map((row) => row[0]),
    ),
  ];
  const matching: string[] = [];
  for (const hash of hashes) {
    const parents = (await git(repo, ["show", "-s", "--format=%P", hash]))
      .trim()
      .split(" ")
      .filter(Boolean);
    if (
      parents.length === record.commitParents.length &&
      parents.every((parent, index) => parent === record.commitParents![index])
    )
      matching.push(hash);
  }
  return {
    hash:
      hashes.length === 1 && matching.length === 1 ? matching[0] : undefined,
    observed: hashes.length > 0,
  };
}

export async function filterPrivateIndex(
  repo: string,
  index: string,
  base: string,
  selected: string[],
) {
  const wanted = new Set(selected),
    [original, entries] = await Promise.all([
      treeEntries(repo, base),
      indexEntries(repo, index),
    ]),
    tree = new Map(original.map((entry) => [entry.path, entry]));
  const replacements: IndexEntry[] = [];
  for (const entry of entries) {
    if (
      !wanted.has(entry.path) ||
      entry.stage ||
      !["100644", "100755"].includes(entry.mode)
    )
      continue;
    const old = tree.get(entry.path);
    if (!old || old.hash === entry.hash || old.mode !== entry.mode) continue;
    const sizes = await Promise.all(
      [old.hash, entry.hash].map((hash) => git(repo, ["cat-file", "-s", hash])),
    );
    if (sizes.some((value) => Number(value) > 2 * 1024 * 1024)) continue;
    const [before, after] = await Promise.all(
      [old.hash, entry.hash].map((hash) =>
        git(repo, ["cat-file", "blob", hash]),
      ),
    );
    if (
      [before, after].some(
        (value) => value.includes("\0") || value.includes("\ufffd"),
      )
    )
      continue;
    const filtered = lineChanges(before, after).commitText;
    if (filtered === after) continue;
    replacements.push({
      ...entry,
      hash: (
        await git(
          repo,
          ["hash-object", "-w", "--no-filters", "--stdin"],
          filtered,
        )
      ).trim(),
    });
  }
  if (replacements.length)
    await git(
      repo,
      ["update-index", "-z", "--index-info"],
      replacements
        .map((entry) => `${entry.mode} ${entry.hash}\t${entry.path}\0`)
        .join(""),
      [0],
      { GIT_INDEX_FILE: index },
    );
}
export async function scopePaths(repo: string, scope: unknown, root: string) {
  if (!scope || typeof scope !== "object")
    throw new Error("请选择明确提交范围");
  const selected = scope as CommitScope,
    all = await changes(repo),
    workspace = await readWorkspaceUnlocked(repo, root);
  const staged = all.filter(
    (item) => item.index !== "?" && item.index !== " " && !item.conflict,
  );
  let chosen = staged;
  if (selected.kind === "changelist") {
    if (!workspace.lists.some((item) => item.id === selected.id))
      throw new Error("更改列表已不存在");
    chosen = staged.filter(
      (item) =>
        (workspace.assignments[item.path] || workspace.activeListId) ===
        selected.id,
    );
  } else if (selected.kind === "files") {
    if (!Array.isArray(selected.paths) || !selected.paths.length)
      throw new Error("所选文件为空，不会改为提交全部");
    const names = new Set(
      selected.paths.map((value) => {
        if (typeof value !== "string") throw new Error("无效的提交路径");
        return relativeFile(repo, value);
      }),
    );
    chosen = staged.filter(
      (item) =>
        names.has(item.path) || (!!item.oldPath && names.has(item.oldPath)),
    );
  } else if (selected.kind !== "all-staged") throw new Error("无效的提交范围");
  const paths = [
    ...new Set(
      chosen.flatMap((item) => [
        item.path,
        ...(item.oldPath ? [item.oldPath] : []),
      ]),
    ),
  ];
  return { paths, changes: chosen };
}
export async function commitScope(
  repo: string,
  p: Record<string, unknown>,
): Promise<OperationResult> {
  return withWorkspace(repo, async (root) => {
    await ensureNoRecovery(repo);
    const workspace = await readWorkspaceUnlocked(repo, root);
    if (p.expectedRevision !== workspace.revision)
      throw new Error("更改列表已变化，请刷新提交范围后确认");
    if (
      typeof p.message !== "string" ||
      !p.message.trim() ||
      p.message.length > 20000
    )
      throw new Error("请输入有效的提交消息");
    if (p.amend !== undefined && typeof p.amend !== "boolean")
      throw new Error("无效的修订状态");
    const { paths } = await scopePaths(repo, p.scope, root);
    if (
      !paths.length &&
      !(p.amend === true && (p.scope as CommitScope)?.kind === "all-staged")
    )
      throw new Error("当前范围没有已暂存的内容，不会创建空提交");
    await assertOrdinary(repo, paths, false, true);
    const { record, directory } = await newOperation(
        root,
        repo,
        "commit",
        paths,
      ),
      privateIndex = path.join(directory, "commit.index"),
      publishedIndex = path.join(directory, "published.index");
    const result = (
      state: OperationResult["state"],
      message: string,
    ): OperationResult => ({
      operationId: record.id,
      state,
      message,
      affectedPaths: record.paths,
      ...(record.commitHash ? { commitHash: record.commitHash } : {}),
    });
    let committed = false,
      attempted = false;
    try {
      if (
        typeof p.expectedHead !== "string" ||
        p.expectedHead !== record.baseHead ||
        typeof p.expectedIndex !== "string" ||
        p.expectedIndex !== record.beforeIndex.sha256
      )
        throw new Error("提交确认后 HEAD 或索引已变化，请刷新范围并重新确认");
      const entries = await indexEntries(repo);
      if (entries.some((entry) => entry.stage))
        throw new Error("存在未解决的索引冲突");
      record.commitRef = await currentRef(repo);
      record.commitParents =
        p.amend === true && record.baseHead
          ? (await git(repo, ["show", "-s", "--format=%P", record.baseHead]))
              .trim()
              .split(" ")
              .filter(Boolean)
          : record.baseHead
            ? [record.baseHead]
            : [];
      await seedIndex(repo, privateIndex, record.baseHead);
      await putEntries(repo, privateIndex, paths, entries);
      await filterPrivateIndex(repo, privateIndex, record.baseHead, paths);
      const tree = (
        await git(repo, ["write-tree"], undefined, [0], {
          GIT_INDEX_FILE: privateIndex,
        })
      ).trim();
      const baseTree = record.baseHead
        ? (await git(repo, ["rev-parse", `${record.baseHead}^{tree}`])).trim()
        : (
            await git(repo, ["hash-object", "-t", "tree", "--stdin"], "")
          ).trim();
      if (tree === baseTree && !p.amend)
        throw new Error("范围中只有纯格式变化，没有可提交的内容改动");
      await saveOperation(root, record);
      return await withIndexLock(repo, async (lock) => {
        if (
          (await headHash(repo)) !== record.baseHead ||
          (await currentRef(repo)) !== record.commitRef ||
          !stateEquals(
            indexState(await readOptional(await indexFile(repo))),
            record.beforeIndex,
          )
        )
          throw new Error("HEAD 或索引已变化，未创建提交，请刷新后重试");
        let commandError: unknown;
        attempted = true;
        try {
          await git(
            repo,
            [
              "-c",
              "core.logAllRefUpdates=true",
              "commit",
              ...(p.amend ? ["--amend"] : []),
              "-m",
              p.message as string,
            ],
            undefined,
            [0],
            {
              GIT_INDEX_FILE: privateIndex,
              GIT_REFLOG_ACTION: `Git IDEA scoped ${record.id}`,
            },
          );
        } catch (error) {
          commandError = error;
        }
        const ownership = await ownedCommit(repo, record);
        if (!ownership.hash) {
          if (
            commandError &&
            !ownership.observed &&
            (await headHash(repo)) === record.baseHead &&
            (await currentRef(repo)) === record.commitRef
          ) {
            attempted = false;
            throw commandError;
          }
          throw new Error(
            `无法从唯一操作日志和父提交确认本次提交归属，未同步索引；请先检查恢复材料，勿重复提交。${commandError ? `\n${(commandError as Error).message}` : ""}`,
          );
        }
        committed = true;
        record.commitHash = ownership.hash;
        record.state = "committed-index-pending";
        if (
          commandError ||
          (await headHash(repo)) !== record.commitHash ||
          (await currentRef(repo)) !== record.commitRef
        ) {
          record.message = `已确认本次提交 ${record.commitHash.slice(0, 12)}，但提交命令或当前分支状态已变化，原索引尚未同步；请先恢复，勿重复提交。${commandError ? `\n${(commandError as Error).message}` : ""}`;
          await saveOperation(root, record);
          return result("committed-index-pending", record.message);
        }
        record.message = `已创建提交 ${record.commitHash.slice(0, 12)}，正在同步原索引`;
        await saveOperation(root, record);
        const actual = (
          await git(repo, [
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-only",
            "-r",
            "-z",
            ...(record.baseHead
              ? [record.baseHead, record.commitHash]
              : [record.commitHash]),
          ])
        )
          .split("\0")
          .filter(Boolean);
        record.paths = [...new Set([...paths, ...actual])];
        const before = await loadState(directory, record.beforeIndex);
        if (before.exists)
          await fs.writeFile(publishedIndex, before.data!, { flag: "wx" });
        else await seedIndex(repo, publishedIndex, "");
        await putEntries(
          repo,
          publishedIndex,
          record.paths,
          await treeEntries(repo, record.commitHash),
        );
        record.afterIndex = await storeState(
          directory,
          indexState(await readOptional(publishedIndex)),
        );
        await saveOperation(root, record);
        const candidate = await loadState(directory, record.afterIndex);
        if (
          (await headHash(repo)) !== record.commitHash ||
          (await currentRef(repo)) !== record.commitRef
        )
          throw new Error("提交后 HEAD 再次变化，停止同步索引");
        await lock.publish(candidate.data!);
        record.state = "completed";
        record.message = `已提交 ${record.commitHash.slice(0, 12)}；其他文件的暂存内容已保留。`;
        await saveOperation(root, record);
        return result("completed", record.message);
      });
    } catch (error) {
      record.state = committed
        ? "committed-index-pending"
        : attempted
          ? "recovery-required"
          : "completed";
      record.message = committed
        ? `提交 ${record.commitHash?.slice(0, 12)} 已创建，索引同步待恢复，不能重复提交。${(error as Error).message}`
        : attempted
          ? `提交归属尚未确认，已保留索引及日志，必须先恢复，不能重复提交。${(error as Error).message}`
          : `未创建提交：${(error as Error).message}`;
      await saveOperation(root, record);
      if (committed) return result("committed-index-pending", record.message);
      if (attempted) return result("recovery-required", record.message);
      throw error;
    } finally {
      if (record.state === "completed") {
        await removePrivateIndex(privateIndex);
        await removePrivateIndex(publishedIndex);
      }
    }
  });
}
export async function commitScopePreview(
  repo: string,
  p: Record<string, unknown>,
) {
  return withWorkspace(repo, async (root) => {
    const head = await headHash(repo),
      index = await readOptional(await indexFile(repo)),
      workspace = await readWorkspaceUnlocked(repo, root),
      selected = await scopePaths(repo, p.scope, root);
    if (
      head !== (await headHash(repo)) ||
      !stateEquals(
        indexState(index),
        indexState(await readOptional(await indexFile(repo))),
      )
    )
      throw new Error("读取期间索引或 HEAD 已变化，请重试");
    return {
      revision: workspace.revision,
      head,
      index: index ? digest(index) : "absent",
      paths: selected.paths,
      partial: selected.changes
        .filter((item) => item.worktree !== " ")
        .map((item) => item.path),
    };
  });
}
export async function recoverScopedCommit(
  repo: string,
  root: string,
  id: string,
): Promise<OperationResult> {
  const { record, directory } = await readOperation(root, repo, id);
  if (record.kind !== "commit") throw new Error("不是提交恢复记录");
  const current = await headHash(repo);
  if ((await currentRef(repo)) !== record.commitRef)
    throw new Error("当前分支引用已改变，保留材料并拒绝恢复到其他分支");
  const ownership = await ownedCommit(repo, record);
  if (!ownership.hash) {
    if (
      record.state !== "recovery-required" &&
      !record.commitHash &&
      !ownership.observed &&
      current === record.baseHead
    ) {
      record.state = "completed";
      record.message = "尚未创建提交，已关闭中断记录";
      await saveOperation(root, record);
      return {
        operationId: id,
        state: "completed",
        message: record.message,
        affectedPaths: record.paths,
      };
    }
    throw new Error("无法唯一确认操作日志及父提交，保留材料，不自动覆盖索引");
  }
  if (record.commitHash && record.commitHash !== ownership.hash)
    throw new Error("记录中的提交与操作日志不符，保留材料并拒绝覆盖");
  record.commitHash = ownership.hash;
  if (current !== record.commitHash)
    throw new Error("HEAD 已有后续变化，不能自动恢复索引");
  return withIndexLock(repo, async (lock) => {
    if (
      (await headHash(repo)) !== record.commitHash ||
      (await currentRef(repo)) !== record.commitRef
    )
      throw new Error("获取索引锁前 HEAD 已变化，保留恢复材料并拒绝覆盖");
    const real = indexState(await readOptional(await indexFile(repo)));
    if (
      !stateEquals(real, record.beforeIndex) &&
      (!record.afterIndex || !stateEquals(real, record.afterIndex))
    )
      throw new Error("真实索引已有其他改动，保留材料并拒绝覆盖");
    if (!record.afterIndex) {
      const candidate = path.join(directory, "recovery.index");
      await removePrivateIndex(candidate);
      const before = await loadState(directory, record.beforeIndex);
      if (before.exists)
        await fs.writeFile(candidate, before.data!, { flag: "wx" });
      else await seedIndex(repo, candidate, "");
      const actual = (
        await git(repo, [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "--name-only",
          "-r",
          "-z",
          ...(record.baseHead
            ? [record.baseHead, record.commitHash!]
            : [record.commitHash!]),
        ])
      )
        .split("\0")
        .filter(Boolean);
      record.paths = [...new Set([...record.paths, ...actual])];
      await putEntries(
        repo,
        candidate,
        record.paths,
        await treeEntries(repo, record.commitHash!),
      );
      record.afterIndex = await storeState(
        directory,
        indexState(await readOptional(candidate)),
      );
      await saveOperation(root, record);
      await removePrivateIndex(candidate);
    }
    const candidate = await loadState(directory, record.afterIndex);
    if (
      (await headHash(repo)) !== record.commitHash ||
      (await currentRef(repo)) !== record.commitRef
    )
      throw new Error("恢复期间 HEAD 已变化，保留候选索引，不会发布");
    await lock.publish(candidate.data!);
    record.state = "completed";
    record.message = `提交 ${record.commitHash!.slice(0, 12)} 的索引同步已恢复，不会重复提交。`;
    await saveOperation(root, record);
    return {
      operationId: id,
      state: "completed",
      message: record.message,
      commitHash: record.commitHash,
      affectedPaths: record.paths,
    };
  });
}
