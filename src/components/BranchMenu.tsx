import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Search } from "lucide-react";
import type { Branch, RepoSnapshot } from "../../shared/types";
import type { BranchInfo } from "../../shared/branches";
import { request } from "../api";
import { LogPopup } from "./LogDialogs";
import { Spinner } from "./ui";

export interface BranchMenuTarget {
  repo: string;
  branch: Branch;
  anchor: HTMLElement;
  point?: { x: number; y: number };
  initialAction?: string;
}
export function BranchMenu({
  target,
  snapshot,
  busy,
  onClose,
  onAction,
}: {
  target: BranchMenuTarget;
  snapshot: RepoSnapshot | null;
  busy: boolean;
  onClose: () => void;
  onAction: (
    name: string,
    info: BranchInfo,
    extra?: Record<string, unknown>,
  ) => void;
}) {
  const [info, setInfo] = useState<BranchInfo | null>(null),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0),
    [tracking, setTracking] = useState(false),
    [query, setQuery] = useState("");
  const anchor = useRef<HTMLElement | null>(
      target.point ? null : target.anchor,
    ),
    point = useRef<HTMLSpanElement>(null);
  const trackAnchor = useRef<HTMLButtonElement>(null),
    initiated = useRef(false);
  if (target.point) anchor.current = point.current;
  useEffect(() => {
    let current = true;
    setInfo(null);
    setError("");
    request<BranchInfo>("branchInfo", target.repo, { ref: target.branch.ref })
      .then((value) => {
        if (current) setInfo(value);
      })
      .catch((cause) => {
        if (current) setError(cause.message);
      });
    return () => {
      current = false;
    };
  }, [target.repo, target.branch.ref, reload]);
  useEffect(() => {
    if (
      !info ||
      !target.initialAction ||
      initiated.current ||
      busy ||
      snapshot?.operation
    )
      return;
    if (
      (target.initialAction === "delete" && info.ref === info.currentRef) ||
      (target.initialAction === "rename" && info.remote)
    )
      return;
    if (
      info.worktrees.some(
        (tree) =>
          tree.branch === info.ref &&
          tree.path.replaceAll("\\", "/").toLowerCase() !==
            target.repo.replaceAll("\\", "/").toLowerCase(),
      )
    )
      return;
    initiated.current = true;
    onAction(target.initialAction, info);
    onClose();
  }, [info, target.initialAction, busy, snapshot?.operation]);
  const run = (action: string, extra?: Record<string, unknown>) => {
    if (!info) return;
    onAction(action, info, extra);
    onClose();
  };
  const current = info ? info.currentRef === info.ref : target.branch.current;
  const selectedName = info?.name || target.branch.name,
    currentName = info?.currentName || snapshot?.branch || "HEAD";
  const otherTree = info?.worktrees.find(
    (tree) =>
      tree.branch === info.ref &&
      tree.path.replaceAll("\\", "/").toLowerCase() !==
        target.repo.replaceAll("\\", "/").toLowerCase(),
  );
  const occupied = otherTree ? `该分支正在工作树 ${otherTree.path} 中使用` : "";
  const blocked = busy
    ? "其他 Git 操作正在执行"
    : snapshot?.operation
      ? `先完成或中止 ${snapshot.operation}`
      : !info
        ? "正在读取分支状态"
        : "";
  const entry = (
    name: string,
    label: string,
    options: { disabled?: string; shortcut?: string; danger?: boolean } = {},
  ) => (
    <button
      key={name}
      role="menuitem"
      autoFocus={name === (current ? "create" : "checkout")}
      disabled={!!blocked || !!options.disabled}
      title={blocked || options.disabled || label}
      className={options.danger ? "red" : undefined}
      onMouseEnter={() => setTracking(false)}
      onClick={() => run(name)}
    >
      <span>{label}</span>
      {options.shortcut && <kbd>{options.shortcut}</kbd>}
    </button>
  );
  const remoteRefs =
    snapshot?.branches.filter(
      (branch) =>
        branch.remote &&
        branch.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) || [];
  return (
    <>
      {target.point && (
        <span
          ref={(element) => {
            point.current = element;
            anchor.current = element;
          }}
          className="branch-context-anchor"
          style={{ left: target.point.x, top: target.point.y }}
        />
      )}
      <LogPopup
        anchor={anchor}
        title={`分支操作 ${selectedName}`}
        onClose={onClose}
        menu
        className="branch-context-menu"
      >
        {!info ? (
          error ? (
            <div className="branch-menu-state" role="alert">
              <span>{error}</span>
              <button
                className="small"
                onClick={() => setReload((value) => value + 1)}
              >
                重新读取
              </button>
            </div>
          ) : (
            <div className="inline-loading">
              <Spinner />
              读取分支状态…
            </div>
          )
        ) : (
          <>
            {!current && entry("checkout", "签出", { disabled: occupied })}
            {entry("create", `从 '${selectedName}' 新建分支…`)}
            {!current && (
              <>
                {entry("checkoutRebase", `签出并变基到 '${currentName}'`, {
                  disabled:
                    occupied ||
                    (!info.currentRef
                      ? "当前处于分离 HEAD，先检出本地分支"
                      : ""),
                })}
                {entry("checkoutUpdate", "签出并更新…", { disabled: occupied })}
              </>
            )}
            <div className="menu-divider" />
            {!current && (
              <button
                role="menuitem"
                disabled={!info.currentHash}
                onMouseEnter={() => setTracking(false)}
                onClick={() => run("compare")}
              >
                与 '{currentName}' 比较
              </button>
            )}
            <button
              role="menuitem"
              onMouseEnter={() => setTracking(false)}
              onClick={() => run("worktreeDiff")}
            >
              显示与工作树的差异
            </button>
            {!current && (
              <>
                <div className="menu-divider" />
                {entry(
                  "rebase",
                  `将 '${currentName}' 变基到 '${selectedName}'`,
                  { disabled: !info.currentRef ? "当前处于分离 HEAD" : "" },
                )}
                {entry(
                  "merge",
                  `将 '${selectedName}' 合并到 '${currentName}' 中`,
                  { disabled: !info.currentRef ? "当前处于分离 HEAD" : "" },
                )}
              </>
            )}
            {info.remote && (
              <>
                {entry("pullRebase", `拉取到 '${currentName}'（变基）…`, {
                  disabled: !info.currentRef ? "当前处于分离 HEAD" : "",
                })}
                {entry("pullMerge", `拉取到 '${currentName}'（合并）…`, {
                  disabled: !info.currentRef ? "当前处于分离 HEAD" : "",
                })}
              </>
            )}
            <div className="menu-divider" />
            {entry("worktree", `来自 '${selectedName}' 的新工作树…`)}
            <div className="menu-divider" />
            {entry("update", "更新…", {
              disabled: !current && !info.remote ? occupied : "",
            })}
            {!info.remote && (
              <>
                {entry("push", "推送…")}
                <button
                  ref={trackAnchor}
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={tracking}
                  disabled={!!blocked}
                  title={blocked || "配置此分支的上游"}
                  onMouseEnter={() => setTracking(true)}
                  onClick={() => setTracking(true)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight") {
                      event.preventDefault();
                      event.stopPropagation();
                      setTracking(true);
                    }
                  }}
                >
                  跟踪分支{info.upstream ? ` '${info.upstream}'` : "…"}
                  <ChevronRight size={13} />
                </button>
              </>
            )}
            <div className="menu-divider" />
            {!info.remote &&
              entry("rename", "重命名…", {
                shortcut: "F2",
                disabled: occupied,
              })}
            {!current &&
              entry("delete", "删除…", {
                shortcut: "Delete",
                disabled: current ? "不能删除当前分支" : occupied,
                danger: true,
              })}
          </>
        )}
      </LogPopup>
      {tracking && info && (
        <LogPopup
          anchor={trackAnchor}
          title="跟踪分支"
          onClose={() => setTracking(false)}
          onOutsideClose={onClose}
          menu
          placement="right"
          className="branch-tracking-menu"
        >
          <div
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                event.stopPropagation();
                setTracking(false);
              }
            }}
          >
            <div className="branch-tracking-heading">
              设置 '{selectedName}' 的上游
            </div>
            <div className="input-shell branch-tracking-search">
              <Search size={13} />
              <input
                aria-label="搜索上游分支"
                placeholder="远程分支"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button
              role="menuitemradio"
              aria-checked={!info.upstream}
              disabled={!!blocked}
              onClick={() => run("track", { upstream: "" })}
            >
              {!info.upstream && <Check size={13} />}不跟踪
            </button>
            <div className="menu-divider" />
            <div className="branch-tracking-options">
              {remoteRefs.map((branch) => (
                <button
                  key={branch.ref}
                  role="menuitemradio"
                  aria-checked={info.upstream === branch.name}
                  disabled={!!blocked}
                  title={branch.name}
                  onClick={() => run("track", { upstream: branch.ref })}
                >
                  {info.upstream === branch.name && <Check size={13} />}
                  <span className="truncate">{branch.name}</span>
                </button>
              ))}
              {!remoteRefs.length && (
                <div className="group-empty">没有匹配的远程分支</div>
              )}
            </div>
          </div>
        </LogPopup>
      )}
    </>
  );
}
