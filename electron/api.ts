import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  commandLogs,
  commitDetail,
  diff,
  git,
  history,
  logLocate,
  logPeople,
  logResolve,
  mutate,
  readFile,
  repository,
  saveFile,
  snapshot,
  tree,
} from "./git.ts";
import type { ApiRequest, Preferences } from "../shared/types.ts";
import { normalizeUiScale } from "../shared/types.ts";
import { BRANCH_ACTIONS } from "../shared/branches.ts";
import { branchInfo, mutateBranch } from "./branches.ts";
import { branchCompare, branchCompareFile } from "./branch-compare.ts";
import {
  commitWorkspace,
  ensureNoRecovery,
  ignoredFiles,
  modules,
  mutateWorkspace,
} from "./commit-workspace.ts";
import {
  WORKSPACE_ACTIONS,
  SHELF_ACTIONS,
} from "../shared/commit-workspace.ts";
import {
  shelves,
  shelfDetail,
  shelfDiff,
  mutateShelf,
  recoveryRecords,
  operationDiff,
  workspacePreview,
  archiveFileAction,
} from "./shelves.ts";
import {
  commitScope,
  commitScopePreview,
  recoverScopedCommit,
} from "./commit-index.ts";
import { pendingOperations } from "./commit-workspace.ts";
import { withWorkspace, workspaceRoot, validId } from "./workspace-io.ts";
import { patchPreview, readonlyDiff } from "./patches.ts";

export function createApi(
  options: {
    preferencesPath?: string;
    defaultRepo?: string;
    trashItem?: (absolutePath: string) => Promise<void>;
  } = {},
) {
  const preferencesPath =
    options.preferencesPath ||
    path.join(os.homedir(), ".git-idea", "preferences.json");
  let preferences: Preferences | undefined;
  let preferenceWrites = Promise.resolve();
  async function prefs() {
    if (!preferences) {
      try {
        preferences = {
          recent: [],
          ...JSON.parse(await fs.readFile(preferencesPath, "utf8")),
        };
      } catch {
        preferences = { recent: [] };
      }
    }
    return preferences!;
  }
  function save(values: Partial<Preferences>) {
    const writing = preferenceWrites.then(async () => {
      const next = { ...(await prefs()), ...values };
      await fs.mkdir(path.dirname(preferencesPath), { recursive: true });
      await fs.writeFile(preferencesPath, JSON.stringify(next, null, 2));
      preferences = next;
      return next;
    });
    preferenceWrites = writing.then(
      () => {},
      () => {},
    );
    return writing;
  }
  async function remember(root: string) {
    const current = await prefs();
    await save({
      recent: [root, ...current.recent.filter((r) => r !== root)].slice(0, 12),
      lastRepo: root,
    });
    return root;
  }
  return async function request(request: ApiRequest): Promise<unknown> {
    if (!request || typeof request.method !== "string")
      throw new Error("无效请求");
    if (
      request.params !== undefined &&
      (!request.params ||
        typeof request.params !== "object" ||
        Array.isArray(request.params))
    )
      throw new Error("无效的请求参数");
    const p = request.params || {};
    if (request.method === "bootstrap")
      return {
        preferences: await prefs(),
        defaultRepo: options.defaultRepo,
        platform: process.platform,
      };
    if (request.method === "preferences")
      return save({
        ...(typeof p.theme === "string" ? { theme: p.theme } : {}),
        ...(typeof p.uiScale === "number"
          ? { uiScale: normalizeUiScale(p.uiScale) }
          : {}),
        ...(typeof p.fontSize === "number"
          ? { fontSize: Math.max(11, Math.min(18, p.fontSize)) }
          : {}),
        ...(typeof p.uiFontFamily === "string"
          ? { uiFontFamily: p.uiFontFamily.trim() }
          : {}),
        ...(typeof p.editorFontFamily === "string"
          ? { editorFontFamily: p.editorFontFamily.trim() }
          : {}),
      });
    if (request.method === "logs") return commandLogs();
    if (request.method === "open")
      return remember(await repository(String(p.path || "")));
    if (request.method === "init") {
      const target = String(p.path || "");
      if (!target) throw new Error("请填写目录");
      await fs.mkdir(path.resolve(target), { recursive: true });
      await git(path.resolve(target), ["init", "-b", "main"]);
      return remember(await repository(target));
    }
    if (request.method === "clone") {
      const url = String(p.url || ""),
        target = String(p.path || "");
      if (!url || !target || url.startsWith("-") || url.includes("\0"))
        throw new Error("请填写有效的克隆地址和目标目录");
      const destination = path.resolve(target);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await git(path.dirname(destination), ["clone", "--", url, destination]);
      return remember(await repository(destination));
    }
    const repo = await repository(request.repo || "");
    switch (request.method) {
      case "patchPreview": return patchPreview(repo, p);
      case "readonlyDiff": return readonlyDiff(repo, p);
      case "snapshot":
        return snapshot(repo, p);
      case "branchInfo":
        return branchInfo(repo, p);
      case "commitWorkspace":
        return commitWorkspace(repo);
      case "commitScopePreview":
        return commitScopePreview(repo, p);
      case "operationRecovery":
        return recoveryRecords(repo);
      case "workspacePreview":
        return workspacePreview(repo, p);
      case "shelves":
        return shelves(repo, p);
      case "shelfDetail":
        return shelfDetail(repo, p);
      case "shelfDiff":
        return shelfDiff(repo, p);
      case "operationDiff":
        return operationDiff(repo, p);
      case "ignoredFiles":
        return ignoredFiles(repo, p);
      case "modules":
        return modules(repo);
      case "branchCompare":
        return branchCompare(repo, p);
      case "branchCompareFile":
        return branchCompareFile(repo, p);
      case "history":
        return history(repo, p);
      case "logPeople":
        return logPeople(repo);
      case "logResolve":
        return logResolve(repo, p);
      case "logLocate":
        return logLocate(repo, p);
      case "tree":
        return tree(repo, String(p.path || ""));
      case "file":
        return readFile(repo, String(p.path || ""), p.baseline === true);
      case "saveFile":
        return saveFile(
          repo,
          String(p.path || ""),
          String(p.text ?? ""),
          typeof p.expectedText === "string" ? p.expectedText : undefined,
        );
      case "diff":
        return diff(repo, p);
      case "commitDetail":
        return commitDetail(repo, String(p.hash || ""));
      case "mutate":
        if (p.action === "commit.scope") return commitScope(repo, p);
        if (p.action === "file.trash" && options.trashItem)
          return archiveFileAction(repo, "file.trash", p, options.trashItem);
        if (
          (SHELF_ACTIONS as readonly string[]).includes(String(p.action || ""))
        )
          return mutateShelf(repo, String(p.action), p);
        if (
          (WORKSPACE_ACTIONS as readonly string[]).includes(
            String(p.action || ""),
          )
        )
          return mutateWorkspace(repo, String(p.action), p);
        if (
          (BRANCH_ACTIONS as readonly string[]).includes(String(p.action || ""))
        )
          return mutateBranch(repo, String(p.action), p, () =>
            ensureNoRecovery(repo),
          );
        return mutate(repo, String(p.action || ""), p, () =>
          ensureNoRecovery(repo),
        );
      default:
        throw new Error("未知请求");
    }
  };
}
