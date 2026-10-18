import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArrowLeftRight,
  Eye,
  MoreVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import type { DiffData, RepoSnapshot } from "../../shared/types";
import type {
  ChangeListRecord,
  CommitScope,
  WorkspaceModule,
  WorkspacePreview,
  WorkspaceState,
} from "../../shared/commit-workspace";
import { request } from "../api";
import { Modal } from "./Dialogs";
import { LogPopup } from "./LogDialogs";
import { CommitMessage } from "./CommitMessage";
import { CommitTree } from "./CommitTree";
import { ChangeListDialog, ModuleRootsDialog } from "./CommitWorkspaceDialogs";
import { ShelfPanel } from "./ShelfPanel";
import { RecoveryPanel } from "./RecoveryPanel";
import { ReadonlyDiff } from "./BranchCompare";
import { Empty, IconButton } from "./ui";
import { isStaged, isUnstaged } from "./CommitFiles";
export { isStaged, isUnstaged } from "./CommitFiles";
interface Props {
  snapshot: RepoSnapshot | null;
  busy: boolean;
  mutate: (
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<boolean>;
  openDiff: (path: string, staged?: boolean) => void;
  refresh: () => void;
  prepare: () => Promise<boolean>;
  confirm: (
    title: string,
    message: string,
    action: () => Promise<unknown>,
  ) => void;
  settings: () => void;
  stash: () => void;
  activePath?: string;
}
export function CommitPanel({
  snapshot: s,
  busy,
  mutate,
  openDiff,
  refresh,
  prepare,
  confirm,
  settings,
  stash,
  activePath,
}: Props) {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null),
    [modules, setModules] = useState<WorkspaceModule[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [tab, setTab] = useState("commit"),
    [error, setError] = useState(""),
    [scope, setScope] = useState<CommitScope>({ kind: "all-staged" });
  const [locate, setLocate] = useState<{ path: string; revision: number }>({
    path: "",
    revision: 0,
  });
  const [menu, setMenu] = useState<{ paths: string[]; listId?: string } | null>(
      null,
    ),
    [view, setView] = useState(false),
    [listDialog, setListDialog] = useState<ChangeListRecord | null | undefined>(
      undefined,
    ),
    [moduleDialog, setModuleDialog] = useState(false),
    [shelfDialog, setShelfDialog] = useState<{
      paths: string[];
      name: string;
      remove: boolean;
    } | null>(null),
    [readonly, setReadonly] = useState<DiffData | null>(null);
  const anchor = useRef<HTMLElement | null>(null),
    viewAnchor = useRef<HTMLDivElement | null>(null),
    repoRef = useRef(s?.root),
    repoGeneration = useRef(0),
    loadGeneration = useRef(0),
    draftFlush = useRef<(() => Promise<void>) | null>(null);
  if (repoRef.current !== s?.root) {
    repoRef.current = s?.root;
    repoGeneration.current++;
  }
  const load = useCallback(async () => {
    const repo = s?.root;
    if (!repo || repoRef.current !== repo) return;
    const generation = ++loadGeneration.current,
      session = repoGeneration.current;
    try {
      const [w, m] = await Promise.all([
        request<WorkspaceState>("commitWorkspace", repo),
        request<WorkspaceModule[]>("modules", repo),
      ]);
      if (
        repoRef.current === repo &&
        session === repoGeneration.current &&
        generation === loadGeneration.current
      ) {
        setWorkspace(w);
        setModules(m);
        setError("");
      }
    } catch (e) {
      if (
        repoRef.current === repo &&
        session === repoGeneration.current &&
        generation === loadGeneration.current
      )
        setError((e as Error).message);
    }
  }, [s?.root]);
  useEffect(() => {
    setWorkspace(null);
    setSelected([]);
    setScope({ kind: "all-staged" });
    setMenu(null);
    setView(false);
    setModules([]);
    setListDialog(undefined);
    setModuleDialog(false);
    setShelfDialog(null);
    setReadonly(null);
    setError("");
    setTab("commit");
  }, [s?.root]);
  useEffect(() => {
    void load();
  }, [load, s]);
  async function run(action: string, params: Record<string, unknown> = {}) {
    if (!s || repoRef.current !== s.root) return false;
    const repo = s.root,
      session = repoGeneration.current;
    try {
      if (action === "commit.scope") await draftFlush.current?.();
      else if (action !== "operation.recover")
        await draftFlush.current?.().catch(() => {});
      if (repoRef.current !== repo || session !== repoGeneration.current)
        return false;
      const latest = await request<WorkspaceState>("commitWorkspace", repo);
      if (repoRef.current !== repo || session !== repoGeneration.current)
        return false;
      const metadata =
        action.startsWith("changelist.") ||
        ["commit.view", "commit.modules", "commit.draft"].includes(action);
      const ok = await mutate(action, {
        ...params,
        expectedRevision: metadata
          ? latest.revision
          : (params.expectedRevision ?? latest.revision),
      });
      if (repoRef.current !== repo || session !== repoGeneration.current)
        return false;
      await load();
      return ok;
    } catch (cause) {
      if (repoRef.current === repo && session === repoGeneration.current)
        setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }
  async function safely(action: () => Promise<unknown>) {
    const repo = s?.root,
      session = repoGeneration.current;
    try {
      if (!(await prepare())) throw new Error("请先处理编辑器的自动保存提示");
      if (repoRef.current !== repo || session !== repoGeneration.current)
        return;
      await action();
    } catch (e) {
      if (repoRef.current === repo && session === repoGeneration.current)
        setError((e as Error).message);
    }
  }
  async function openPreview(source: Record<string, unknown>) {
    await safely(async () => {
      if (!s) return;
      if (window.gitIdea?.openDiffWindow)
        await window.gitIdea.openDiffWindow(s.root, source);
      else {
        const repo = s.root,
          session = repoGeneration.current;
        const value = await request<DiffData>("readonlyDiff", repo, source);
        if (repoRef.current === repo && session === repoGeneration.current)
          setReadonly(value);
      }
    });
  }
  async function patch(
    paths: string[],
    staged = false,
    copy = false,
    extra: Record<string, unknown> = {},
  ) {
    await safely(async () => {
      if (!s) return;
      const params = { paths, staged, ...extra };
      if (copy && window.gitIdea?.copyPatch) {
        await window.gitIdea.copyPatch(s.root, params);
        return;
      }
      if (!copy && window.gitIdea?.savePatch) {
        await window.gitIdea.savePatch(s.root, params);
        return;
      }
      const value = await request<{
        text: string;
        tooLarge: boolean;
        name: string;
      }>("patchPreview", s.root, params);
      if (value.tooLarge) throw new Error("超过 8 MB 的补丁请在桌面端导出");
      if (copy) await navigator.clipboard.writeText(value.text);
      else {
        const url = URL.createObjectURL(
          new Blob([value.text], { type: "text/plain;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = value.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }
  async function saveArchive(params: Record<string, unknown>) {
    if (params.format === "patch") {
      await patch([], false, false, params);
      return;
    }
    await safely(async () => {
      if (!s) return;
      if (!window.gitIdea?.saveArchiveFile)
        throw new Error("请在桌面端另存归档文件");
      await window.gitIdea.saveArchiveFile(s.root, params);
    });
  }
  async function rollback(paths: string[], trash = false, full = false) {
    await safely(async () => {
      if (!s) return;
      if (
        !paths.length ||
        paths.some((path) => !s.changes.some((change) => change.path === path))
      )
        throw new Error("请选择当前仓库中的更改文件。已忽略文件只支持查看。");
      const session = repoGeneration.current;
      const preview = await request<WorkspacePreview>(
        "workspacePreview",
        s.root,
        { paths },
      );
      if (repoRef.current !== s.root || session !== repoGeneration.current)
        return;
      confirm(
        trash
          ? "删除文件并保留恢复备份"
          : full
            ? "回滚全部改动"
            : "回滚工作区改动",
        `${paths.length} 个文件：\n${paths.join("\n")}\n${trash ? "文件将移入系统回收站，应用内保留原始内容和索引备份。" : full ? "恢复为 HEAD 版本，并取消所选文件的暂存。" : "恢复为索引版本，保留已暂存内容。"}`,
        () =>
          run(trash ? "file.trash" : "file.rollback", {
            paths,
            preview,
            full,
            expectedRevision: preview.revision,
          }),
      );
    });
  }
  const chosen = menu?.paths || selected,
    changes = s?.changes.filter((c) => chosen.includes(c.path)) || [],
    tracked = changes.filter((c) => c.index !== "?"),
    unknown = chosen.some(
      (path) => !changes.some((change) => change.path === path),
    ),
    validSelection =
      selected.length > 0 &&
      selected.every((path) =>
        s?.changes.some((change) => change.path === path && !change.conflict),
      ),
    fullyStagedSelection =
      validSelection &&
      selected.every((path) => {
        const change = s!.changes.find((item) => item.path === path)!;
        return isStaged(change) && !isUnstaged(change);
      }),
    conflict = changes.some((c) => c.conflict),
    locked = busy || !!workspace?.pending.length;
  function context(event: React.MouseEvent, paths: string[], listId?: string) {
    event.preventDefault();
    anchor.current = event.currentTarget as HTMLElement;
    setMenu({ paths, listId });
    setView(false);
  }
  const list = workspace?.lists.find((l) => l.id === menu?.listId);
  function action(fn: () => void) {
    setMenu(null);
    fn();
  }
  return (
    <section
      className="commit-panel panel"
      onKeyDown={(e) => {
        if (e.defaultPrevented) return;
        if (
          (e.target as Element).closest("input,textarea,select,[role=dialog]")
        )
          return;
        if (e.ctrlKey && e.key.toLowerCase() === "k") {
          e.preventDefault();
          setTab("commit");
          setTimeout(
            () =>
              document
                .querySelector<HTMLTextAreaElement>(".commit-form textarea")
                ?.focus(),
            0,
          );
        }
        if (tab !== "commit" || !(e.target as Element).closest('[role="tree"]'))
          return;
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          document
            .querySelector<HTMLButtonElement>(".commit-actions .primary")
            ?.click();
          return;
        }
        if (e.key === "F2" && !locked) {
          const id = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-list-id]",
          )?.dataset.listId;
          const record = workspace?.lists.find((item) => item.id === id);
          if (record) {
            e.preventDefault();
            setListDialog(record);
          }
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === "d" && selected[0]) {
          e.preventDefault();
          openDiff(selected[0]);
        }
        if (
          e.ctrlKey &&
          e.altKey &&
          e.key.toLowerCase() === "z" &&
          validSelection &&
          !locked
        ) {
          e.preventDefault();
          void rollback(selected);
        }
        if (e.ctrlKey && e.altKey && ["p", "m"].includes(e.key.toLowerCase())) {
          e.preventDefault();
          void run("commit.view", {
            grouping: e.key.toLowerCase() === "p" ? "directory" : "module",
          });
        }
        if (e.key === "Delete" && validSelection && !locked) {
          e.preventDefault();
          void rollback(selected, true);
        }
      }}
    >
      <header className="panel-header">
        <div className="tab-buttons" role="tablist" aria-label="提交工作台">
          {[
            ["commit", "提交"],
            ["shelf", "搁置"],
            ["recovery", "恢复记录"],
          ].map(([id, label]) => (
            <button
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
              {id === "recovery" && !!workspace?.pending.length
                ? ` ${workspace.pending.length}`
                : ""}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <div ref={viewAnchor}>
          <IconButton
            title="视图选项"
            onClick={() => {
              setView(!view);
              setMenu(null);
            }}
          >
            <MoreVertical size={15} />
          </IconButton>
        </div>
      </header>
      {error && (
        <div className="form-error" role="alert">
          {error}
          <button onClick={() => void load()}>重试</button>
        </div>
      )}
      {!!workspace?.pending.length && (
        <div className="operation-banner">
          <span>
            有 {workspace.pending.length} 个操作需要恢复，Git 写入已暂停。
          </span>
          <button onClick={() => setTab("recovery")}>查看恢复</button>
        </div>
      )}
      {tab === "commit" && (
        <>
          <div className="panel-toolbar commit-toolbar">
            <IconButton
              title="刷新"
              onClick={() => {
                refresh();
                void load();
              }}
            >
              <RefreshCw size={15} />
            </IconButton>
            <IconButton
              title="回滚所选工作区改动…"
              disabled={locked || !validSelection}
              onClick={() => void rollback(selected)}
            >
              <RotateCcw size={15} />
            </IconButton>
            <IconButton
              title={fullyStagedSelection ? "取消暂存所选文件" : "暂存所选文件"}
              disabled={locked || !validSelection}
              onClick={() =>
                void run(fullyStagedSelection ? "unstage" : "stage", {
                  paths: selected,
                })
              }
            >
              <ArrowLeftRight size={15} />
            </IconButton>
            <IconButton
              title="搁置所选更改…"
              disabled={
                locked ||
                !validSelection ||
                selected.some(
                  (path) =>
                    s?.changes.find((change) => change.path === path)?.index ===
                    "?",
                ) ||
                !!s?.operation
              }
              onClick={() =>
                setShelfDialog({ paths: selected, name: "", remove: true })
              }
            >
              <Archive size={15} />
            </IconButton>
            <IconButton
              title="显示所选差异"
              disabled={!selected[0]}
              onClick={() => openDiff(selected[0])}
            >
              <Eye size={15} />
            </IconButton>
            <IconButton
              title="新建更改列表…"
              disabled={locked}
              onClick={() => setListDialog(null)}
            >
              <Plus size={15} />
            </IconButton>
            {activePath && (
              <IconButton
                title="定位当前文件"
                onClick={() => {
                  setLocate((value) => ({
                    path: activePath,
                    revision: value.revision + 1,
                  }));
                }}
              >
                <Search size={15} />
              </IconButton>
            )}
          </div>
          {s?.operation && (
            <div className="operation-banner">
              <span>正在进行 {s.operation}</span>
              <button
                disabled={busy}
                onClick={() =>
                  confirm(
                    "中止 Git 操作",
                    `中止 ${s.operation} 并恢复原状态？`,
                    () => run("operation.abort", { operation: s.operation }),
                  )
                }
              >
                中止
              </button>
              <button
                disabled={busy || s.changes.some((c) => c.conflict)}
                onClick={() =>
                  void mutate("operation.continue", { operation: s.operation })
                }
              >
                继续
              </button>
            </div>
          )}
          {s && workspace ? (
            <CommitTree
              snapshot={s}
              workspace={workspace}
              modules={modules}
              busy={locked}
              selected={selected}
              onSelect={setSelected}
              mutate={run}
              openDiff={openDiff}
              onContext={context}
              locate={locate}
            />
          ) : (
            <div className="changes-scroll">
              <Empty title={s ? "正在读取更改列表…" : "尚未打开仓库"} />
            </div>
          )}
        </>
      )}
      {tab === "shelf" && s && workspace && (
        <ShelfPanel
          repo={s.root}
          workspace={workspace}
          busy={busy}
          mutate={run}
          refresh={() => {
            refresh();
            void load();
          }}
          openPreview={(source) => void openPreview(source)}
          saveArchive={(params) => void saveArchive(params)}
          confirm={confirm}
          prepare={prepare}
        />
      )}
      {tab === "recovery" && s && workspace && (
        <RecoveryPanel
          repo={s.root}
          workspace={workspace}
          busy={busy}
          mutate={run}
          openPreview={(source) => void openPreview(source)}
          saveArchive={(params) => void saveArchive(params)}
          confirm={confirm}
        />
      )}
      <div style={{ display: tab === "commit" ? "contents" : "none" }}>
        <CommitMessage
          snapshot={s}
          workspace={workspace}
          stagedCount={s?.changes.filter(isStaged).length || 0}
          busy={busy}
          scope={scope}
          setScope={setScope}
          selected={selected}
          mutate={run}
          prepare={prepare}
          refreshWorkspace={load}
          draftFlushRef={draftFlush}
          settings={settings}
        />
      </div>
      {view && (
        <LogPopup
          anchor={viewAnchor}
          title="提交视图选项"
          menu
          onClose={() => setView(false)}
        >
          {(["flat", "directory", "module"] as const).map((group, i) => (
            <button
              role="menuitemradio"
              aria-checked={workspace?.view.grouping === group}
              key={group}
              onClick={() => {
                setView(false);
                void run("commit.view", { grouping: group });
              }}
            >
              {["平铺", "按目录分组", "按模块分组"][i]}
            </button>
          ))}
          <div className="menu-divider" />
          <button
            role="menuitemcheckbox"
            aria-checked={workspace?.view.showIgnored}
            onClick={() => {
              setView(false);
              void run("commit.view", {
                showIgnored: !workspace?.view.showIgnored,
              });
            }}
          >
            显示已忽略文件
          </button>
          <button
            onClick={() => {
              setView(false);
              setModuleDialog(true);
            }}
          >
            配置模块根目录…
          </button>
          <button
            onClick={() => {
              setView(false);
              stash();
            }}
          >
            Git 储藏全部更改…
          </button>
        </LogPopup>
      )}
      {menu && workspace && (
        <LogPopup
          anchor={anchor}
          title="更改操作"
          menu
          onClose={() => setMenu(null)}
        >
          <div className="menu-caption">
            {list ? list.name : `已选 ${chosen.length} 个文件`}
          </div>
          {unknown ? (
            <>
              <button
                disabled={!chosen[0]}
                onClick={() => action(() => openDiff(chosen[0]))}
              >
                打开文件
              </button>
              <button
                disabled={!chosen[0]}
                onClick={() =>
                  action(
                    () =>
                      void safely(() =>
                        navigator.clipboard.writeText(chosen.join("\n")),
                      ),
                  )
                }
              >
                复制相对路径
              </button>
              <button
                onClick={() =>
                  action(() => {
                    refresh();
                    void load();
                  })
                }
              >
                刷新
              </button>
            </>
          ) : (
            <>
              <button
                disabled={
                  locked ||
                  !tracked.some(isStaged) ||
                  conflict ||
                  !!s?.operation
                }
                onClick={() =>
                  action(() => {
                    setScope(
                      list
                        ? { kind: "changelist", id: list.id }
                        : { kind: "files", paths: chosen },
                    );
                    document
                      .querySelector<HTMLTextAreaElement>(
                        ".commit-form textarea",
                      )
                      ?.focus();
                  })
                }
              >
                提交{list ? "该列表" : "所选"}已暂存内容…
              </button>
              <button
                disabled={locked || !chosen.length || conflict}
                onClick={() =>
                  action(() => void run("stage", { paths: chosen }))
                }
              >
                暂存所选
              </button>
              <button
                disabled={locked || !tracked.some(isStaged) || conflict}
                onClick={() =>
                  action(() => void run("unstage", { paths: chosen }))
                }
              >
                取消暂存
              </button>
              <button
                disabled={!chosen[0]}
                onClick={() => action(() => openDiff(chosen[0]))}
              >
                显示差异　Ctrl D
              </button>
              {conflict && (
                <button
                  disabled={busy}
                  onClick={() =>
                    action(() =>
                      confirm(
                        "标记冲突已解决",
                        `确认已保存所选冲突文件并移除冲突标记？\n${changes
                          .filter((change) => change.conflict)
                          .map((change) => change.path)
                          .join("\n")}`,
                        () =>
                          run("resolve", {
                            paths: changes
                              .filter((change) => change.conflict)
                              .map((change) => change.path),
                          }),
                      ),
                    )
                  }
                >
                  标记冲突已解决…
                </button>
              )}
              <button
                disabled={!tracked.some(isStaged)}
                onClick={() =>
                  action(() => {
                    const change = tracked.find(isStaged);
                    if (change) openDiff(change.path, true);
                  })
                }
              >
                显示暂存差异
              </button>
              <button
                disabled={!chosen[0]}
                onClick={() =>
                  action(
                    () => void openPreview({ kind: "file", path: chosen[0] }),
                  )
                }
              >
                在独立窗口中显示差异
              </button>
              <div className="menu-divider" />
              <button
                disabled={locked || !tracked.length || conflict}
                onClick={() => action(() => void rollback(chosen))}
              >
                回滚工作区改动…
              </button>
              <button
                disabled={locked || !tracked.length || conflict}
                onClick={() => action(() => void rollback(chosen, false, true))}
              >
                回滚工作区和暂存改动…
              </button>
              <button
                disabled={
                  locked ||
                  !tracked.length ||
                  conflict ||
                  tracked.length !== changes.length
                }
                onClick={() =>
                  action(() =>
                    setShelfDialog({
                      paths: chosen,
                      name: list?.name || "",
                      remove: true,
                    }),
                  )
                }
              >
                搁置更改…
              </button>
              <div className="menu-caption">移动到更改列表</div>
              {workspace.lists.map((target) => (
                <button
                  key={target.id}
                  disabled={locked || !tracked.length || conflict}
                  onClick={() =>
                    action(
                      () =>
                        void run("changelist.move", {
                          id: target.id,
                          paths: tracked.map((c) => c.path),
                        }),
                    )
                  }
                >
                  {target.name}
                </button>
              ))}
              <div className="menu-divider" />
              <button
                disabled={!tracked.length || conflict}
                onClick={() => action(() => void patch(chosen))}
              >
                创建工作区补丁…
              </button>
              <button
                disabled={!tracked.some(isStaged) || conflict}
                onClick={() => action(() => void patch(chosen, true))}
              >
                创建暂存区补丁…
              </button>
              <button
                disabled={!tracked.length || conflict}
                onClick={() => action(() => void patch(chosen, false, true))}
              >
                复制工作区补丁
              </button>
              <button
                disabled={!tracked.some(isStaged) || conflict}
                onClick={() => action(() => void patch(chosen, true, true))}
              >
                复制暂存区补丁
              </button>
              <button
                disabled={locked || !chosen.length || conflict}
                onClick={() => action(() => void rollback(chosen, true))}
              >
                删除文件…　Delete
              </button>
              <div className="menu-divider" />
              <button
                disabled={locked}
                onClick={() => action(() => setListDialog(null))}
              >
                新建更改列表…
              </button>
              {list && (
                <>
                  <button
                    disabled={locked}
                    onClick={() => action(() => setListDialog(list))}
                  >
                    编辑更改列表…　F2
                  </button>
                  <button
                    disabled={locked || list.id === workspace.activeListId}
                    onClick={() =>
                      action(
                        () => void run("changelist.activate", { id: list.id }),
                      )
                    }
                  >
                    设为活动列表
                  </button>
                  <button
                    disabled={locked || list.builtin}
                    onClick={() =>
                      action(() =>
                        confirm(
                          "删除更改列表",
                          `删除「${list.name}」？文件将移入内置更改列表，磁盘内容和暂存状态保持。`,
                          () => run("changelist.delete", { id: list.id }),
                        ),
                      )
                    }
                  >
                    删除更改列表
                  </button>
                </>
              )}
              <button
                onClick={() =>
                  action(() => {
                    refresh();
                    void load();
                  })
                }
              >
                刷新
              </button>
            </>
          )}
        </LogPopup>
      )}
      {createPortal(
        <>
          {listDialog !== undefined && (
            <ChangeListDialog
              list={listDialog}
              lists={workspace?.lists}
              busy={busy}
              onSubmit={(values) =>
                run(listDialog ? "changelist.update" : "changelist.create", {
                  ...values,
                  ...(listDialog ? { id: listDialog.id } : {}),
                })
              }
              onClose={() => setListDialog(undefined)}
            />
          )}
          {moduleDialog && (
            <ModuleRootsDialog
              roots={workspace?.moduleRoots || []}
              busy={busy}
              onSubmit={(roots) => run("commit.modules", { roots })}
              onClose={() => setModuleDialog(false)}
            />
          )}
          {shelfDialog && (
            <Modal title="搁置更改" onClose={() => setShelfDialog(null)}>
              <p className="modal-description">
                保存 {shelfDialog.paths.length}{" "}
                个文件的基线、暂存和工作区原始内容。重命名包含两端。
              </p>
              <label>
                名称
                <input
                  autoFocus
                  value={shelfDialog.name}
                  onChange={(e) =>
                    setShelfDialog({ ...shelfDialog, name: e.target.value })
                  }
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={shelfDialog.remove}
                  onChange={(e) =>
                    setShelfDialog({ ...shelfDialog, remove: e.target.checked })
                  }
                />
                存档后移除所选改动（取消勾选仅复制备份）
              </label>
              <div className="modal-actions">
                <button onClick={() => setShelfDialog(null)}>取消</button>
                <button
                  className="primary"
                  disabled={locked || !shelfDialog.name.trim()}
                  onClick={() =>
                    void safely(async () => {
                      if (!s) return;
                      const session = repoGeneration.current;
                      const value = shelfDialog,
                        preview = await request<WorkspacePreview>(
                          "workspacePreview",
                          s.root,
                          { paths: value.paths },
                        );
                      if (
                        repoRef.current !== s.root ||
                        session !== repoGeneration.current
                      )
                        return;
                      confirm(
                        value.remove ? "存档并移除更改" : "复制到搁置",
                        `${value.name}\n${preview.files.map((f) => f.path).join("\n")}\n${value.remove ? "存档完成后恢复所选路径至 HEAD；其他文件保留。" : "保留当前工作区及暂存内容。"}`,
                        async () => {
                          if (
                            await run("shelf.create", {
                              ...value,
                              preview,
                              expectedRevision: preview.revision,
                            })
                          )
                            setShelfDialog(null);
                        },
                      );
                    })
                  }
                >
                  继续…
                </button>
              </div>
            </Modal>
          )}
          {readonly && (
            <Modal
              title={`只读差异 · ${readonly.path}`}
              wide
              onClose={() => setReadonly(null)}
            >
              <div style={{ maxHeight: "65vh", overflow: "auto" }}>
                <ReadonlyDiff data={readonly} />
              </div>
            </Modal>
          )}
        </>,
        document.body,
      )}
    </section>
  );
}
