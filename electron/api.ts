import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  commandLogs,
  commitDetail,
  diff,
  git,
  history,
  mutate,
  readFile,
  repository,
  saveFile,
  snapshot,
  tree,
} from "./git.ts";
import type { ApiRequest, Preferences } from "../shared/types.ts";
import { normalizeUiScale } from "../shared/types.ts";

export function createApi(
  options: { preferencesPath?: string; defaultRepo?: string } = {},
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
      case "snapshot":
        return snapshot(repo, p);
      case "history":
        return history(repo, p);
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
        return mutate(repo, String(p.action || ""), p);
      default:
        throw new Error("未知请求");
    }
  };
}
