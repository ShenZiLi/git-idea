import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { git, relativeFile } from "./git.ts";
import {
  atomicWrite,
  changes,
  diskState,
  readOptional,
  safeDirectory,
  withWorkspace,
  workspaceRoot,
  writeJson,
} from "./workspace-io.ts";
import type {
  CommitWorkspace,
  IgnoredPage,
  OperationSummary,
  WorkspaceModule,
  WorkspaceState,
} from "../shared/commit-workspace.ts";

export function emptyWorkspace(): CommitWorkspace {
  return {
    schemaVersion: 1,
    revision: 0,
    activeListId: "default",
    lists: [{ id: "default", name: "更改", description: "", builtin: true }],
    assignments: Object.create(null) as Record<string, string>,
    view: { grouping: "flat", showIgnored: false },
    moduleRoots: [],
    drafts: {},
  };
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export async function readWorkspaceUnlocked(
  repo: string,
  root: string,
): Promise<CommitWorkspace> {
  try {
    const stat = await fs.lstat(path.join(root, "workspace.json"));
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("工作台元数据必须是普通文件，不能是链接");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const raw = await readOptional(path.join(root, "workspace.json"));
  if (!raw) return emptyWorkspace();
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(
      "工作台元数据损坏，原文件与备份已保留；请先恢复 workspace.json，不会覆盖为空配置。",
    );
  }
  const invalid = () =>
    new Error("工作台元数据版本或结构无效，已停止写入并保留原文件。");
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !Array.isArray(value.lists) ||
    !value.lists.length ||
    !object(value.assignments) ||
    !object(value.view) ||
    !object(value.drafts) ||
    !Array.isArray(value.moduleRoots)
  )
    throw invalid();
  const ids = new Set<string>(),
    names = new Set<string>();
  for (const item of value.lists) {
    if (
      !object(item) ||
      typeof item.id !== "string" ||
      !(item.id === "default" || /^[0-9a-f-]{36}$/.test(item.id)) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 100 ||
      typeof item.description !== "string" ||
      item.description.length > 4000 ||
      typeof item.builtin !== "boolean" ||
      item.builtin !== (item.id === "default") ||
      ids.has(item.id) ||
      names.has(item.name)
    )
      throw invalid();
    ids.add(item.id);
    names.add(item.name);
  }
  if (
    !ids.has("default") ||
    typeof value.activeListId !== "string" ||
    !ids.has(value.activeListId) ||
    !["flat", "directory", "module"].includes(String(value.view.grouping)) ||
    typeof value.view.showIgnored !== "boolean"
  )
    throw invalid();
  for (const [file, id] of Object.entries(value.assignments)) {
    if (
      typeof id !== "string" ||
      !ids.has(id) ||
      relativeFile(repo, file) !== file
    )
      throw invalid();
  }
  for (const [id, draft] of Object.entries(value.drafts)) {
    if (
      !(ids.has(id) || id === "amend") ||
      typeof draft !== "string" ||
      draft.length > 20000
    )
      throw invalid();
  }
  for (const root of value.moduleRoots) {
    if (
      !object(root) ||
      typeof root.path !== "string" ||
      typeof root.name !== "string" ||
      !root.name.trim() ||
      root.name.length > 100 ||
      relativeFile(repo, root.path || ".") !== root.path
    )
      throw invalid();
  }
  value.assignments = Object.assign(Object.create(null), value.assignments);
  return value as unknown as CommitWorkspace;
}
export async function saveWorkspaceUnlocked(
  root: string,
  workspace: CommitWorkspace,
) {
  const file = path.join(root, "workspace.json"),
    old = await readOptional(file);
  if (old) await atomicWrite(`${file}.bak`, old);
  workspace.revision++;
  await writeJson(file, workspace);
}
export async function pendingOperations(
  root: string,
): Promise<OperationSummary[]> {
  const directory = await safeDirectory(root, "operations"),
    result: OperationSummary[] = [];
  for (const name of await fs.readdir(directory)) {
    if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    try {
      const stat = await fs.lstat(path.join(directory, name));
      if (stat.isSymbolicLink()) throw new Error("恢复记录不能是链接");
      const record = JSON.parse(
        await fs.readFile(path.join(directory, name), "utf8"),
      );
      if (
        !object(record) ||
        record.schemaVersion !== 1 ||
        record.id !== name.slice(0, -5) ||
        !Array.isArray(record.paths) ||
        !record.paths.every((item: unknown) => typeof item === "string")
      )
        throw new Error("恢复记录格式无效");
      if (!["completed", "rolled-back"].includes(String(record.state)))
        result.push({
          id: record.id as string,
          kind: String(record.kind),
          createdAt: String(record.createdAt),
          state: String(record.state),
          paths: record.paths as string[],
          message: String(record.message || "操作中断，需恢复"),
          ...(typeof record.commitHash === "string"
            ? { commitHash: record.commitHash }
            : {}),
        });
    } catch (e) {
      result.push({
        id: name.slice(0, -5),
        kind: "corrupted",
        createdAt: "",
        state: "recovery-required",
        paths: [],
        message: `恢复记录损坏：${(e as Error).message}。材料已保留。`,
      });
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function ensureNoRecovery(repo: string) {
  const pending = await pendingOperations(await workspaceRoot(repo));
  if (pending.length)
    throw new Error(
      `有 ${pending.length} 项操作尚未恢复，请先打开提交面板的恢复入口。${pending.find((item) => item.commitHash)?.commitHash ? "已创建提交，请勿重复提交。" : ""}`,
    );
}
export async function commitWorkspace(repo: string): Promise<WorkspaceState> {
  return withWorkspace(repo, async (root) => {
    const pending = await pendingOperations(root);
    const workspace = await readWorkspaceUnlocked(repo, root),
      all = (await changes(repo)).filter((item) => item.index !== "?");
    if (pending.length) return { ...workspace, pending };
    const assignments: Record<string, string> = Object.create(null);
    for (const item of all)
      assignments[item.path] =
        workspace.assignments[item.path] ||
        (item.oldPath && workspace.assignments[item.oldPath]) ||
        workspace.activeListId;
    if (JSON.stringify(assignments) !== JSON.stringify(workspace.assignments)) {
      workspace.assignments = assignments;
      await saveWorkspaceUnlocked(root, workspace);
    }
    return { ...workspace, pending: await pendingOperations(root) };
  });
}
const paramText = (
  p: Record<string, unknown>,
  key: string,
  limit: number,
  empty = false,
) => {
  const value = p[key];
  if (
    typeof value !== "string" ||
    value.length > limit ||
    value.includes("\0") ||
    (!empty && !value.trim())
  )
    throw new Error(`无效的 ${key}`);
  return value;
};
export async function mutateWorkspace(
  repo: string,
  action: string,
  params: Record<string, unknown>,
): Promise<string> {
  return withWorkspace(repo, async (root) => {
    const workspace = await readWorkspaceUnlocked(repo, root);
    if (params.expectedRevision !== workspace.revision)
      throw new Error("更改列表已由其他操作更新，请刷新后重试。");
    const id = typeof params.id === "string" ? params.id : "",
      list = workspace.lists.find((item) => item.id === id);
    if (action.startsWith("changelist.") && !action.endsWith("create") && !list)
      throw new Error("更改列表已不存在，请刷新");
    switch (action) {
      case "changelist.create":
      case "changelist.update": {
        const name = paramText(params, "name", 100).trim(),
          description =
            params.description === undefined
              ? ""
              : paramText(params, "description", 4000, true);
        if (
          workspace.lists.some((item) => item.name === name && item.id !== id)
        )
          throw new Error("已存在同名更改列表");
        if (action.endsWith("create")) {
          const created = {
            id: randomUUID(),
            name,
            description,
            builtin: false,
          };
          workspace.lists.push(created);
          if (params.activate === true) workspace.activeListId = created.id;
        } else {
          list!.name = name;
          list!.description = description;
        }
        break;
      }
      case "changelist.delete": {
        if (id === "default") throw new Error("内置更改列表不能删除");
        workspace.lists = workspace.lists.filter((item) => item.id !== id);
        for (const file of Object.keys(workspace.assignments))
          if (workspace.assignments[file] === id)
            workspace.assignments[file] = "default";
        delete workspace.drafts[id];
        if (workspace.activeListId === id) workspace.activeListId = "default";
        break;
      }
      case "changelist.activate":
        workspace.activeListId = id;
        break;
      case "changelist.move": {
        if (!Array.isArray(params.paths) || !params.paths.length)
          throw new Error("请选择要移动的已托管文件");
        const all = await changes(repo);
        for (const value of params.paths) {
          if (typeof value !== "string") throw new Error("无效的文件路径");
          const file = relativeFile(repo, value),
            item = all.find(
              (change) =>
                change.index !== "?" &&
                (change.path === file || change.oldPath === file),
            );
          if (!item) throw new Error(`文件状态已变化：${file}`);
          workspace.assignments[item.path] = id;
          if (item.oldPath) delete workspace.assignments[item.oldPath];
        }
        break;
      }
      case "commit.view": {
        if (params.grouping !== undefined) {
          if (
            !["flat", "directory", "module"].includes(String(params.grouping))
          )
            throw new Error("无效的分组方式");
          workspace.view.grouping =
            params.grouping as CommitWorkspace["view"]["grouping"];
        }
        if (params.showIgnored !== undefined) {
          if (typeof params.showIgnored !== "boolean")
            throw new Error("无效的忽略项开关");
          workspace.view.showIgnored = params.showIgnored;
        }
        break;
      }
      case "commit.draft":
        if (!(workspace.lists.some((item) => item.id === id) || id === "amend"))
          throw new Error("草稿所属列表已不存在");
        workspace.drafts[id] = paramText(params, "message", 20000, true);
        break;
      case "commit.modules": {
        if (!Array.isArray(params.roots) || params.roots.length > 100)
          throw new Error("最多配置 100 个模块根");
        const seen = new Set<string>();
        workspace.moduleRoots = params.roots.map((value) => {
          if (!object(value)) throw new Error("无效的模块根");
          const root = relativeFile(
              repo,
              paramText(value, "path", 4096, true) || ".",
            ),
            name = paramText(value, "name", 100).trim();
          if (seen.has(root)) throw new Error("模块根重复");
          seen.add(root);
          return { path: root, name };
        });
        break;
      }
      default:
        throw new Error("未知的工作台元数据操作");
    }
    await saveWorkspaceUnlocked(root, workspace);
    return "工作台设置已更新";
  });
}
export async function ignoredFiles(
  repo: string,
  params: Record<string, unknown>,
): Promise<IgnoredPage> {
  const prefix =
    params.directory === undefined
      ? ""
      : relativeFile(repo, paramText(params, "directory", 4096, true) || ".");
  const offset =
    typeof params.offset === "number" &&
    Number.isSafeInteger(params.offset) &&
    params.offset >= 0
      ? params.offset
      : 0;
  const cwd = path.join(repo, prefix);
  let current = repo;
  for (const part of prefix.split("/").filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("忽略目录不能是链接");
  }
  const raw = await git(cwd, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
    "--no-empty-directory",
    "-z",
  ]);
  const entries = raw
    .split("\0")
    .filter(Boolean)
    .map((value) => ({
      path: relativeFile(
        repo,
        [prefix, value.replace(/\/$/, "")].filter(Boolean).join("/"),
      ),
      directory: value.endsWith("/"),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    entries: entries.slice(offset, offset + 100),
    total: entries.length,
    hasMore: offset + 100 < entries.length,
  };
}
export async function modules(repo: string): Promise<WorkspaceModule[]> {
  const workspace = await readWorkspaceUnlocked(
      repo,
      await workspaceRoot(repo),
    ),
    found = new Map<string, WorkspaceModule>();
  for (const root of workspace.moduleRoots)
    found.set(root.path, { ...root, manual: true });
  const scanned = new Set<string>(),
    candidates = new Set<string>([""]);
  for (const item of (await changes(repo)).filter(
    (item) => item.index !== "?",
  )) {
    let directory = path.posix.dirname(item.path);
    while (directory !== ".") {
      candidates.add(directory);
      const parent = path.posix.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  for (const directory of [...candidates].sort((a, b) => b.length - a.length)) {
    if (found.has(directory) || scanned.has(directory)) continue;
    scanned.add(directory);
    const markers = [
      "package.json",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "go.mod",
      "Cargo.toml",
    ];
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(repo, directory), {
        withFileTypes: true,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    const marker = entries.find(
      (entry) =>
        entry.isFile() &&
        (markers.includes(entry.name) || entry.name.endsWith(".csproj")),
    );
    if (!marker) continue;
    const file = [directory, marker.name].filter(Boolean).join("/"),
      state = await diskState(repo, file);
    let name = directory ? path.posix.basename(directory) : path.basename(repo);
    if (
      marker.name === "package.json" &&
      state.data &&
      state.size < 2 * 1024 * 1024
    ) {
      try {
        const json = JSON.parse(state.data.toString("utf8"));
        if (typeof json.name === "string" && json.name.trim())
          name = json.name.slice(0, 100);
      } catch {
        /* Invalid package metadata still defines a module root. */
      }
    }
    found.set(directory, { path: directory, name, manual: false });
  }
  return [...found.values()].sort(
    (a, b) => b.path.length - a.path.length || a.name.localeCompare(b.name),
  );
}
