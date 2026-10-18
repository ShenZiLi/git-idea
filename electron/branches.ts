import { promises as fs } from "node:fs";
import path from "node:path";
import { git, serialize } from "./git.ts";
import { BRANCH_ACTIONS } from "../shared/branches.ts";
import type { BranchInfo, BranchWorktree } from "../shared/branches.ts";

type Params = Record<string, unknown>;
type RemoteTarget = { remote: string; source: string; tracking: string };

function text(p: Params, key: string, empty = false): string {
  const value = p[key];
  if (typeof value !== "string" || value.includes("\0") || (!empty && !value))
    throw new Error(`无效的分支参数：${key}`);
  return value;
}

async function refRecord(repo: string, ref: string) {
  if (!/^refs\/(heads|remotes)\/.+/.test(ref) || /[\0\r\n]/.test(ref))
    throw new Error("请选择完整的本地或远程分支引用");
  await git(repo, ["check-ref-format", ref]);
  const rows = (
    await git(repo, [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(symref)%00%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(objecttype)",
      ref,
    ])
  )
    .trimEnd()
    .split("\n")
    .map((row) => row.split("\0"));
  const row = rows.find((parts) => parts[0] === ref);
  if (!row || row[2] || row[6] !== "commit")
    throw new Error("分支已不存在、是符号引用或未指向提交，请刷新后重试");
  return {
    hash: row[1],
    upstream: row[3] || "",
    upstreamRemote: row[4] || "",
    upstreamMerge: row[5] || "",
  };
}

async function head(repo: string) {
  const currentRef = (
    await git(repo, ["symbolic-ref", "--quiet", "HEAD"], undefined, [0, 1])
  ).trim();
  const currentHash = (
    await git(
      repo,
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      undefined,
      [0, 1],
    )
  ).trim();
  return {
    currentRef,
    currentHash,
    currentName: currentRef.startsWith("refs/heads/")
      ? currentRef.slice(11)
      : "",
  };
}

async function worktrees(repo: string): Promise<BranchWorktree[]> {
  const result: BranchWorktree[] = [];
  let current: BranchWorktree | undefined;
  for (const field of (
    await git(repo, ["worktree", "list", "--porcelain", "-z"])
  ).split("\0")) {
    if (!field) {
      current = undefined;
      continue;
    }
    const separator = field.indexOf(" ");
    const key = separator < 0 ? field : field.slice(0, separator);
    const value = separator < 0 ? "" : field.slice(separator + 1);
    if (key === "worktree") {
      current = { path: value, branch: "", head: "" };
      result.push(current);
    } else if (current && key === "HEAD") current.head = value;
    else if (current && key === "branch") current.branch = value;
    else if (current && key === "locked") current.locked = value || "已锁定";
    else if (current && key === "prunable")
      current.prunable = value || "可清理";
  }
  return result;
}

export async function branchInfo(
  repo: string,
  params: Params,
): Promise<BranchInfo> {
  const ref = text(params, "ref");
  const [record, current, trees] = await Promise.all([
    refRecord(repo, ref),
    head(repo),
    worktrees(repo),
  ]);
  const remote = ref.startsWith("refs/remotes/");
  const mapped = remote ? await remoteTarget(repo, ref) : undefined;
  return {
    ref,
    name: ref.replace(/^refs\/(heads|remotes)\//, ""),
    remote,
    ...record,
    ...current,
    worktrees: trees,
    ...(mapped
      ? { remoteTarget: { remote: mapped.remote, source: mapped.source } }
      : {}),
  };
}

async function assertContext(repo: string, p: Params) {
  const info = await branchInfo(repo, p);
  if (
    info.hash !== text(p, "expectedHash") ||
    info.currentRef !== text(p, "expectedCurrentRef", true) ||
    info.currentHash !== text(p, "expectedCurrentHash", true)
  )
    throw new Error("分支或当前提交已改变，请刷新菜单并重新确认操作");
  for (const [parameter, key] of [
    ["expectedUpstream", "upstream"],
    ["expectedUpstreamRemote", "upstreamRemote"],
    ["expectedUpstreamMerge", "upstreamMerge"],
  ] as const) {
    if (p[parameter] !== undefined && text(p, parameter, true) !== info[key])
      throw new Error("分支跟踪配置已改变，请刷新菜单并重新确认远程目标");
  }
  return info;
}

async function assertIdle(repo: string) {
  for (const marker of [
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "sequencer",
  ]) {
    const location = path.resolve(
      repo,
      (await git(repo, ["rev-parse", "--git-path", marker])).trim(),
    );
    try {
      await fs.stat(location);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error("仓库有尚未完成的 Git 操作，请先继续或中止该操作");
  }
}

async function branchName(repo: string, value: string) {
  if (!value || value.startsWith("-") || /[\0\r\n]/.test(value))
    throw new Error("请输入有效的分支名称");
  const checked = (
    await git(repo, ["check-ref-format", "--branch", value])
  ).trim();
  // Reject checkout shorthand such as @{-1}; the dialog must name a literal branch.
  if (checked !== value)
    throw new Error("分支名称必须是字面名称，不能使用 Git 表达式");
  return value;
}

async function remotes(repo: string) {
  return (await git(repo, ["remote"])).split(/\r?\n/).filter(Boolean);
}

async function configuredRemote(repo: string, remote: string) {
  if (
    remote === "." ||
    remote.startsWith("-") ||
    /[\0\r\n]/.test(remote) ||
    !(await remotes(repo)).includes(remote)
  )
    throw new Error("远程已不存在，请选择仓库中配置的远程");
  return remote;
}

function mapPattern(
  pattern: string,
  value: string,
  replacement: string,
): string | undefined {
  const wildcard = pattern.indexOf("*");
  if (wildcard < 0) return pattern === value ? replacement : undefined;
  if (pattern.indexOf("*", wildcard + 1) >= 0) return undefined;
  const prefix = pattern.slice(0, wildcard),
    suffix = pattern.slice(wildcard + 1);
  if (
    !value.startsWith(prefix) ||
    !value.endsWith(suffix) ||
    value.length < prefix.length + suffix.length
  )
    return undefined;
  return replacement.replace(
    "*",
    value.slice(prefix.length, value.length - suffix.length),
  );
}

async function remoteTarget(
  repo: string,
  tracking: string,
  requireExisting = true,
): Promise<RemoteTarget> {
  if (requireExisting) await refRecord(repo, tracking);
  if (!tracking.startsWith("refs/remotes/"))
    throw new Error("请选择远程跟踪分支");
  await git(repo, ["check-ref-format", tracking]);
  const matches: RemoteTarget[] = [];
  for (const remote of await remotes(repo)) {
    const specs = (
      await git(
        repo,
        ["config", "--get-all", `remote.${remote}.fetch`],
        undefined,
        [0, 1],
      )
    )
      .split(/\r?\n/)
      .filter(Boolean);
    for (const raw of specs) {
      const spec = raw.replace(/^\+/, "");
      if (spec.startsWith("^")) continue;
      const colon = spec.indexOf(":");
      if (colon < 0) continue;
      const sourcePattern = spec.slice(0, colon),
        destinationPattern = spec.slice(colon + 1);
      const source = mapPattern(destinationPattern, tracking, sourcePattern);
      if (!source || !source.startsWith("refs/heads/")) continue;
      if (
        specs.some(
          (excluded) =>
            excluded.startsWith("^") &&
            mapPattern(excluded.slice(1), source, source) !== undefined,
        )
      )
        continue;
      await git(repo, ["check-ref-format", source]);
      if (
        !matches.some(
          (match) => match.remote === remote && match.source === source,
        )
      )
        matches.push({ remote, source, tracking });
    }
  }
  if (matches.length !== 1)
    throw new Error("无法唯一确定远程分支的 fetch 映射，请检查远程配置");
  await configuredRemote(repo, matches[0].remote);
  return matches[0];
}

async function upstreamTarget(repo: string, info: BranchInfo) {
  if (!info.upstream || !info.upstreamRemote || !info.upstreamMerge)
    throw new Error("该分支尚未配置可更新的上游，请先设置跟踪分支");
  const target = await remoteTarget(repo, info.upstream, false);
  if (
    target.remote !== info.upstreamRemote ||
    target.source !== info.upstreamMerge
  )
    throw new Error("跟踪配置与 fetch 映射不一致，请重新设置跟踪分支");
  return target;
}

async function fetchTarget(repo: string, target: RemoteTarget) {
  await configuredRemote(repo, target.remote);
  await git(repo, [
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    "--refmap=",
    target.remote,
    `${target.source}:${target.tracking}`,
  ]);
  return (await refRecord(repo, target.tracking)).hash;
}

function requireLocal(info: BranchInfo) {
  if (info.remote) throw new Error("此操作仅适用于本地分支");
}

function requireCurrent(info: BranchInfo) {
  if (!info.currentRef || !info.currentHash)
    throw new Error("当前处于分离 HEAD 或尚无提交，请先签出本地分支");
}

function assertUnoccupied(info: BranchInfo) {
  const tree = info.worktrees.find((item) => item.branch === info.ref);
  if (tree)
    throw new Error(
      `分支已在工作树中使用：${tree.path}。请切换到该工作树，或使用新分支。`,
    );
}

async function checkout(repo: string, info: BranchInfo) {
  if (!info.remote) {
    await git(repo, ["switch", "--no-guess", info.name]);
    return info.name;
  }
  const target = await remoteTarget(repo, info.ref);
  const localName = await branchName(repo, target.source.slice(11));
  const localRef = `refs/heads/${localName}`;
  const existing = (
    await git(repo, ["for-each-ref", "--format=%(refname)", localRef])
  )
    .split(/\r?\n/)
    .includes(localRef);
  if (existing) {
    const local = await refRecord(repo, localRef);
    if (
      local.upstream !== info.ref ||
      local.upstreamRemote !== target.remote ||
      local.upstreamMerge !== target.source
    )
      throw new Error(
        `本地分支 ${localName} 已存在且未跟踪此远程分支，请使用“从此分支新建分支”并选择其他名称`,
      );
    await git(repo, ["switch", "--no-guess", localName]);
  } else await git(repo, ["switch", "--track", "-c", localName, info.ref]);
  return localName;
}

function updateMethod(p: Params) {
  const method = text(p, "method");
  if (!["merge", "rebase", "ff-only"].includes(method))
    throw new Error("请选择 merge、rebase 或 ff-only 更新策略");
  return method;
}

async function integrate(repo: string, hash: string, method: string) {
  return method === "rebase"
    ? git(repo, ["rebase", hash])
    : git(repo, [
        "merge",
        method === "ff-only" ? "--ff-only" : "--no-edit",
        hash,
      ]);
}

async function update(repo: string, info: BranchInfo, method: string) {
  if (info.remote) {
    await fetchTarget(repo, await remoteTarget(repo, info.ref));
    return "远程跟踪分支已更新";
  }
  const isCurrent = info.ref === info.currentRef;
  if (!isCurrent) assertUnoccupied(info);
  const target = await upstreamTarget(repo, info);
  const hash = await fetchTarget(repo, target);
  const fresh = await branchInfo(repo, { ref: info.ref });
  if (
    fresh.hash !== info.hash ||
    fresh.currentRef !== info.currentRef ||
    fresh.currentHash !== info.currentHash
  )
    throw new Error(
      "已获取上游，但本地分支或当前提交发生变化，尚未集成。请刷新后重试。",
    );
  if (isCurrent) return integrate(repo, hash, method);
  assertUnoccupied(fresh);
  const common = (
    await git(repo, ["merge-base", info.hash, hash], undefined, [0, 1])
  ).trim();
  if (common === hash) return "已获取上游，本地分支已包含上游提交，无需更新";
  if (common !== info.hash)
    throw new Error(
      "已获取上游；该分支存在分叉，未修改本地分支。请签出后选择合并或变基。",
    );
  // Native fetch checks checked-out branches across linked worktrees and permits
  // only a fast-forward. update-ref alone would bypass that worktree protection.
  await git(repo, [
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    "--refmap=",
    ".",
    `${target.tracking}:${info.ref}`,
  ]);
  return "本地分支已安全快进，当前工作区未切换";
}

function within(candidate: string, directory: string) {
  const relative = path.relative(directory, candidate);
  return (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function canonical(destination: string): Promise<string> {
  try {
    return await fs.realpath(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(destination);
    if (parent === destination) throw error;
    return path.join(await canonical(parent), path.basename(destination));
  }
}

async function worktreePath(repo: string, requested: string, info: BranchInfo) {
  if (
    !path.isAbsolute(requested) ||
    requested.split(/[\\/]/).some((part) => part.toLowerCase() === ".git")
  )
    throw new Error("工作树目录必须是绝对路径，且不能位于 Git 元数据目录中");
  const destination = await canonical(path.resolve(requested));
  if (destination.split(/[\\/]/).some((part) => part.toLowerCase() === ".git"))
    throw new Error("工作树目录不能通过符号链接进入 Git 元数据目录");
  const protectedPaths = [repo, ...info.worktrees.map((tree) => tree.path)];
  for (const option of ["--absolute-git-dir", "--git-common-dir"])
    protectedPaths.push(
      path.resolve(repo, (await git(repo, ["rev-parse", option])).trim()),
    );
  for (const location of protectedPaths) {
    const resolved = await canonical(location);
    if (within(destination, resolved) || within(resolved, destination))
      throw new Error(
        "工作树目录不能位于现有仓库或 Git 元数据内，也不能是它们的父目录",
      );
  }
  try {
    const stat = await fs.stat(destination);
    if (!stat.isDirectory() || (await fs.readdir(destination)).length)
      throw new Error("工作树目标必须是不存在的目录或空目录");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return destination;
}

export async function mutateBranch(
  repo: string,
  action: string,
  p: Params,
): Promise<string> {
  if (!(BRANCH_ACTIONS as readonly string[]).includes(action))
    throw new Error("未知分支操作");
  return serialize(repo, async () => {
    const info = await assertContext(repo, p);
    await assertIdle(repo);
    if (!info.remote) await branchName(repo, info.name);
    switch (action) {
      case "branch.checkoutRef":
        return `已签出 ${await checkout(repo, info)}`;
      case "branch.createFrom": {
        const name = await branchName(repo, text(p, "name"));
        if (typeof p.checkout !== "boolean")
          throw new Error("请选择是否检出新分支");
        await git(
          repo,
          p.checkout
            ? ["switch", "--no-track", "-c", name, info.hash]
            : ["branch", "--no-track", name, info.hash],
        );
        return `已从 ${info.name} 创建${p.checkout ? "并签出" : ""}分支 ${name}`;
      }
      case "branch.checkoutAndRebase":
      case "branch.checkoutAndUpdate": {
        if (action === "branch.checkoutAndRebase") requireCurrent(info);
        if (
          info.ref === info.currentRef &&
          action === "branch.checkoutAndRebase"
        )
          throw new Error("当前分支不能变基到自身");
        const method =
          action === "branch.checkoutAndUpdate" ? updateMethod(p) : "rebase";
        const name = await checkout(repo, info);
        try {
          if (action === "branch.checkoutAndRebase")
            await integrate(repo, info.currentHash, "rebase");
          else
            await update(
              repo,
              await branchInfo(repo, { ref: `refs/heads/${name}` }),
              method,
            );
        } catch (error) {
          throw new Error(
            `已签出 ${name}，后续${action === "branch.checkoutAndRebase" ? "变基" : "更新"}未完成；当前已处于该分支，请检查冲突并继续或中止。\n${(error as Error).message}`,
          );
        }
        return `已签出并${action === "branch.checkoutAndRebase" ? "变基" : "更新"} ${name}`;
      }
      case "branch.update":
        return update(repo, info, info.remote ? "ff-only" : updateMethod(p));
      case "branch.pullMerge":
      case "branch.pullRebase": {
        requireCurrent(info);
        if (!info.remote) throw new Error("拉取到当前分支需要选择远程分支");
        const hash = await fetchTarget(
          repo,
          await remoteTarget(repo, info.ref),
        );
        const current = await head(repo);
        if (
          current.currentRef !== info.currentRef ||
          current.currentHash !== info.currentHash
        )
          throw new Error(
            "已获取远程分支，但当前分支已改变，尚未合并或变基。请刷新后重试。",
          );
        return integrate(
          repo,
          hash,
          action === "branch.pullRebase" ? "rebase" : "merge",
        );
      }
      case "branch.mergeIntoCurrent":
      case "branch.rebaseCurrent":
        requireCurrent(info);
        if (info.ref === info.currentRef) throw new Error("请选择其他分支");
        return integrate(
          repo,
          info.hash,
          action === "branch.rebaseCurrent" ? "rebase" : "merge",
        );
      case "branch.pushSelected": {
        requireLocal(info);
        const remote = await configuredRemote(repo, text(p, "remote"));
        const destination = await branchName(repo, text(p, "destination"));
        if (typeof p.setUpstream !== "boolean")
          throw new Error("请选择是否设置上游");
        return git(repo, [
          "push",
          ...(p.setUpstream ? ["--set-upstream"] : []),
          remote,
          `${info.ref}:refs/heads/${destination}`,
        ]);
      }
      case "branch.track": {
        requireLocal(info);
        const upstream = text(p, "upstream", true);
        if (!upstream) {
          if (info.upstream || info.upstreamRemote || info.upstreamMerge)
            await git(repo, ["branch", "--unset-upstream", info.name]);
          return "已取消上游跟踪";
        }
        await remoteTarget(repo, upstream);
        await git(repo, ["branch", `--set-upstream-to=${upstream}`, info.name]);
        const tracked = await branchInfo(repo, { ref: info.ref });
        await upstreamTarget(repo, tracked);
        return `已设置 ${info.name} 跟踪 ${upstream.slice(13)}`;
      }
      case "branch.renameRef": {
        requireLocal(info);
        const occupied = info.worktrees.find(
          (tree) =>
            tree.branch === info.ref && path.relative(repo, tree.path) !== "",
        );
        if (occupied)
          throw new Error(
            `该分支正在其他工作树中使用：${occupied.path}，请在那里重命名`,
          );
        return git(repo, [
          "branch",
          "-m",
          info.name,
          await branchName(repo, text(p, "newName")),
        ]);
      }
      case "branch.deleteRef":
        if (info.remote) {
          const target = await remoteTarget(repo, info.ref);
          // A deletion lease only rejects a changed server tip; it never permits
          // replacing commits or bypasses push ancestry for branch updates.
          return git(repo, [
            "push",
            `--force-with-lease=${target.source}:${info.hash}`,
            target.remote,
            `:${target.source}`,
          ]);
        }
        requireLocal(info);
        assertUnoccupied(info);
        return git(repo, ["branch", "-d", info.name]);
      case "branch.worktree": {
        const destination = await worktreePath(repo, text(p, "path"), info);
        const name =
          p.newName === undefined || p.newName === ""
            ? ""
            : await branchName(repo, text(p, "newName"));
        if (!name && !info.remote) assertUnoccupied(info);
        if (info.remote) {
          const target = await remoteTarget(repo, info.ref);
          const localName =
            name || (await branchName(repo, target.source.slice(11)));
          await git(repo, [
            "worktree",
            "add",
            "--track",
            "-b",
            localName,
            destination,
            info.ref,
          ]);
        } else
          await git(repo, [
            "worktree",
            "add",
            ...(name ? ["--no-track", "-b", name] : []),
            destination,
            name ? info.hash : info.name,
          ]);
        return `已创建工作树：${destination}`;
      }
      default:
        throw new Error("未知分支操作");
    }
  });
}
