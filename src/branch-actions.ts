import type { BranchInfo } from "../shared/branches";
import type { RepoSnapshot } from "../shared/types";
import type { FormSpec } from "./components/Dialogs";

interface BranchActionEnvironment {
  repo: string;
  getRepo: () => string;
  snapshot: RepoSnapshot | null;
  mutate: (
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<boolean>;
  confirm: (
    title: string,
    message: string,
    action: () => Promise<unknown>,
  ) => void;
  form: (spec: FormSpec) => void;
  compare: (mode: "branches" | "worktree") => void;
  openRepository: (path: string) => Promise<boolean>;
  notify: (message: string, error?: boolean) => void;
}
const updateMethods = [
  { value: "merge", label: "合并（Merge）" },
  { value: "rebase", label: "变基（Rebase）" },
  { value: "ff-only", label: "仅快进（Fast-forward only）" },
];
export function performBranchAction(
  name: string,
  info: BranchInfo,
  extra: Record<string, unknown>,
  env: BranchActionEnvironment,
) {
  const S = info.name,
    C = info.currentName || "分离 HEAD";
  const context = {
    ref: info.ref,
    expectedHash: info.hash,
    expectedCurrentRef: info.currentRef,
    expectedCurrentHash: info.currentHash,
    expectedUpstream: info.upstream,
    expectedUpstreamRemote: info.upstreamRemote,
    expectedUpstreamMerge: info.upstreamMerge,
  };
  const run = (action: string, params: Record<string, unknown> = {}) => {
    if (env.getRepo() !== env.repo) {
      env.notify("仓库已切换，请重新打开分支菜单。", true);
      return Promise.resolve(false);
    }
    return env.mutate(action, { ...params, ...context });
  };
  if (name === "compare" || name === "worktreeDiff") {
    env.compare(name === "compare" ? "branches" : "worktree");
    return;
  }
  if (name === "checkout") {
    void run("branch.checkoutRef");
    return;
  }
  if (name === "create") {
    env.form({
      title: `从 '${S}' 新建分支`,
      description: `起点固定为 ${S} · ${info.hash.slice(0, 8)}`,
      submitLabel: "创建分支",
      fields: [
        { key: "name", label: "分支名称", placeholder: "feature/my-change" },
        {
          key: "checkout",
          label: "创建后检出",
          value: "true",
          options: [
            { value: "true", label: "检出新分支" },
            { value: "false", label: "保持当前分支" },
          ],
        },
      ],
      onSubmit: (values) =>
        run("branch.createFrom", {
          name: values.name,
          checkout: values.checkout === "true",
        }),
    });
    return;
  }
  if (
    ["merge", "rebase", "checkoutRebase", "pullMerge", "pullRebase"].includes(
      name,
    )
  ) {
    const descriptions: Record<string, [string, string, string]> = {
      merge: [
        "合并分支",
        `将 '${S}' 合并到当前 '${C}'，不切换分支。`,
        "branch.mergeIntoCurrent",
      ],
      rebase: [
        "变基当前分支",
        `保持当前 '${C}'，将其变基到 '${S}'。这会重写当前分支的提交。`,
        "branch.rebaseCurrent",
      ],
      checkoutRebase: [
        "签出并变基",
        `先签出 '${S}'，再将其变基到原来的 '${C}'（${info.currentHash.slice(0, 8)}）。完成后停留在 '${S}'；失败时也可能已切换。`,
        "branch.checkoutAndRebase",
      ],
      pullMerge: [
        "拉取并合并",
        `获取 '${S}' 的远程更新，再合并到当前 '${C}'，不切换分支。`,
        "branch.pullMerge",
      ],
      pullRebase: [
        "拉取并变基",
        `获取 '${S}' 的远程更新，再将当前 '${C}' 变基到该分支。此操作会重写当前分支的提交。`,
        "branch.pullRebase",
      ],
    };
    const [title, message, action] = descriptions[name];
    env.confirm(title, message, () => run(action));
    return;
  }
  if (name === "update" || name === "checkoutUpdate") {
    const inactive =
      info.ref !== info.currentRef && !info.remote && name === "update";
    const remoteOnly = info.remote && name === "update";
    if (!info.remote && !info.upstream) {
      env.notify(`'${S}' 没有上游，请在“跟踪分支”子菜单设置后更新。`, true);
      return;
    }
    if (inactive || remoteOnly) {
      env.confirm(
        remoteOnly ? "更新远程分支" : "更新选中分支",
        remoteOnly
          ? `只获取 '${S}' 的远程引用，不检出或合并到 '${C}'。`
          : `获取 '${info.upstream}' 并安全快进 '${S}'，保持当前 '${C}'。如果分支已分叉，将停止并提示先检出处理。`,
        () => run("branch.update", { method: "ff-only" }),
      );
      return;
    }
    let method = "merge";
    try {
      const saved = localStorage.getItem(`git-idea-branch-update:${env.repo}`);
      if (updateMethods.some((item) => item.value === saved)) method = saved!;
    } catch {
      /* Session defaults remain usable. */
    }
    env.form({
      title: name === "checkoutUpdate" ? "签出并更新" : "更新当前分支",
      description: `${name === "checkoutUpdate" ? `先检出 '${S}'，再` : ""}获取上游并更新 '${S}'。若出现冲突，保留 Git 状态以便继续或中止。`,
      submitLabel: "更新",
      fields: [
        {
          key: "method",
          label: "更新方式",
          value: method,
          options: updateMethods,
        },
      ],
      onSubmit: (values) => {
        try {
          localStorage.setItem(
            `git-idea-branch-update:${env.repo}`,
            values.method,
          );
        } catch {
          /* Optional view preference. */
        }
        return run(
          name === "checkoutUpdate"
            ? "branch.checkoutAndUpdate"
            : "branch.update",
          { method: values.method },
        );
      },
    });
    return;
  }
  if (name === "push") {
    const remotes = env.snapshot?.remotes || [];
    if (!remotes.length) {
      env.notify("尚未配置远程仓库，请先在 Git 窗口管理远程仓库。", true);
      return;
    }
    env.form({
      title: `推送 '${S}'`,
      description: `源分支固定为 '${S}'，不会隐式改用当前 '${C}'。不执行强制推送。`,
      submitLabel: "下一步",
      fields: [
        {
          key: "remote",
          label: "远程仓库",
          value:
            info.upstreamRemote && info.upstreamRemote !== "."
              ? info.upstreamRemote
              : remotes[0].name,
          options: remotes.map((remote) => ({
            value: remote.name,
            label: remote.name,
          })),
        },
        {
          key: "destination",
          label: "远程目标分支",
          value: info.upstreamMerge?.replace(/^refs\/heads\//, "") || S,
        },
        {
          key: "setUpstream",
          label: "推送后跟踪此目标",
          value: info.upstream ? "false" : "true",
          options: [
            { value: "true", label: "设置为上游" },
            { value: "false", label: "保留原有跟踪设置" },
          ],
        },
      ],
      onSubmit: async (values) => {
        env.confirm(
          "确认推送",
          `将本地 '${S}' 推送到 '${values.remote}/${values.destination}'。${values.setUpstream === "true" ? "\n成功后将该远程分支设为上游。" : ""}`,
          () =>
            run("branch.pushSelected", {
              ...values,
              setUpstream: values.setUpstream === "true",
            }),
        );
        return true;
      },
    });
    return;
  }
  if (name === "track") {
    void run("branch.track", extra);
    return;
  }
  if (name === "rename") {
    env.form({
      title: `重命名 '${S}'`,
      fields: [{ key: "newName", label: "新名称", value: S }],
      submitLabel: "重命名",
      onSubmit: (values) => run("branch.renameRef", values),
    });
    return;
  }
  if (name === "delete") {
    env.confirm(
      info.remote ? "删除远程分支" : "删除本地分支",
      info.remote
        ? `将从远程 '${info.remoteTarget?.remote || S}' 删除 '${info.remoteTarget?.source || info.ref}'。这会影响其他协作者；如果服务器分支已更新，将拒绝删除并要求重新获取后确认。`
        : `删除本地 '${S}'。Git 会拒绝删除未合并或被工作树占用的分支，不进行强制删除。`,
      () => run("branch.deleteRef"),
    );
    return;
  }
  if (name === "worktree") {
    const occupied = info.worktrees.some((tree) => tree.branch === info.ref);
    const short = info.remote ? S.slice(S.indexOf("/") + 1) : S;
    const defaultNew = occupied || info.remote ? `${short}-worktree` : "";
    env.form({
      title: `来自 '${S}' 的新工作树`,
      description:
        "创建独立目录，共享 Git 历史。目标必须不存在或为空目录；已被使用的分支需要新建分支。",
      submitLabel: "创建工作树",
      fields: [
        {
          key: "path",
          label: "工作树绝对路径",
          placeholder: "C:\\Project\\Code\\my-worktree",
          browse: true,
        },
        {
          key: "newName",
          label: "新分支名称（留空复用选中分支）",
          required: false,
          value: defaultNew,
        },
        {
          key: "open",
          label: "创建后",
          value: "true",
          options: [
            { value: "true", label: "在当前窗口打开新工作树" },
            { value: "false", label: "保持当前仓库" },
          ],
        },
      ],
      onSubmit: async (values) => {
        const ok = await run("branch.worktree", {
          path: values.path,
          ...(values.newName ? { newName: values.newName } : {}),
        });
        if (!ok) return false;
        if (values.open === "true" && env.getRepo() === env.repo)
          await env.openRepository(values.path);
        return true;
      },
    });
  }
}
