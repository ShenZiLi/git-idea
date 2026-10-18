import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  Folder,
  Search,
} from "lucide-react";
import type { Change, RepoSnapshot } from "../../shared/types";
import type {
  Grouping,
  IgnoredPage,
  WorkspaceModule,
  WorkspaceState,
} from "../../shared/commit-workspace";
import { request } from "../api";
import { Modal } from "./Dialogs";
import { isStaged, isUnstaged, StageCheckbox } from "./CommitFiles";
import { Empty, FileIcon, IconButton } from "./ui";
import "../commit-workspace.css";

const PAGE_SIZE = 100;
type SelectionEvent = Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">;
interface TreeNode {
  id: string;
  label: string;
  listId: string;
  changes: Change[];
  children: TreeNode[];
  change?: Change;
}
interface VisibleRow {
  node: TreeNode;
  depth: number;
}

export interface CommitTreeProps {
  snapshot: RepoSnapshot;
  workspace: WorkspaceState;
  modules: WorkspaceModule[];
  busy: boolean;
  selected: string[];
  onSelect: (paths: string[]) => void;
  mutate: (
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<boolean>;
  openDiff: (path: string, staged?: boolean) => void;
  onContext: (event: MouseEvent, paths: string[], listId?: string) => void;
  locate?: { path: string; revision: number };
}

function directoryNodes(
  changes: Change[],
  listId: string,
  prefix: string,
  base = "",
): TreeNode[] {
  const directories = new Map<string, Change[]>();
  const files: TreeNode[] = [];
  for (const change of changes) {
    const relative = base ? change.path.slice(base.length + 1) : change.path;
    const slash = relative.indexOf("/");
    if (slash < 0)
      files.push({
        id: `${prefix}/file:${change.path}`,
        label: relative,
        listId,
        changes: [change],
        children: [],
        change,
      });
    else {
      const name = relative.slice(0, slash);
      const group = directories.get(name) || [];
      group.push(change);
      directories.set(name, group);
    }
  }
  return [
    ...[...directories]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, group]) => {
        const path = base ? `${base}/${name}` : name;
        const id = `${prefix}/dir:${path}`;
        return {
          id,
          label: name,
          listId,
          changes: group,
          children: directoryNodes(group, listId, prefix, path),
        };
      }),
    ...files.sort((left, right) => left.label.localeCompare(right.label)),
  ];
}

function moduleFor(path: string, modules: WorkspaceModule[]) {
  return modules
    .filter(
      (module) =>
        module.path === "." ||
        module.path === "" ||
        path === module.path ||
        path.startsWith(`${module.path}/`),
    )
    .sort(
      (left, right) =>
        Number(right.manual) - Number(left.manual) ||
        right.path.length - left.path.length,
    )[0];
}

function keyboardContext(
  event: KeyboardEvent,
  callback: CommitTreeProps["onContext"],
  paths: string[],
  listId?: string,
) {
  event.preventDefault();
  event.stopPropagation();
  const bounds = event.currentTarget.getBoundingClientRect();
  callback(
    {
      ...event,
      clientX: bounds.left + Math.min(100, bounds.width / 2),
      clientY: bounds.bottom,
      preventDefault: () => event.preventDefault(),
      stopPropagation: () => event.stopPropagation(),
    } as unknown as MouseEvent,
    paths,
    listId,
  );
}

export function CommitTree({
  snapshot,
  workspace,
  modules,
  busy,
  selected,
  onSelect,
  mutate,
  openDiff,
  onContext,
  locate,
}: CommitTreeProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [browser, setBrowser] = useState<"untracked" | "ignored" | null>(null);
  const anchor = useRef("");
  const treeRef = useRef<HTMLDivElement>(null);
  const pendingLocate = useRef("");
  const tracked = snapshot.changes.filter((change) => change.index !== "?");
  const untracked = snapshot.changes.filter((change) => change.index === "?");
  const value = query.trim().toLocaleLowerCase();
  const nodes = useMemo(
    () =>
      workspace.lists.map((list) => {
        const changes = snapshot.changes.filter(
          (change) =>
            change.index !== "?" &&
            (workspace.assignments[change.path] ||
              workspace.assignments[change.oldPath || ""] ||
              workspace.activeListId) === list.id &&
            (!value ||
              change.path.toLocaleLowerCase().includes(value) ||
              change.oldPath?.toLocaleLowerCase().includes(value)),
        );
        const id = `list:${list.id}`;
        let children: TreeNode[];
        if (workspace.view.grouping === "module") {
          const groups = new Map<
            string,
            { module?: WorkspaceModule; changes: Change[] }
          >();
          for (const change of changes) {
            const module = moduleFor(change.path, modules),
              key = module?.path ?? "\0unknown";
            const group = groups.get(key) || { module, changes: [] };
            group.changes.push(change);
            groups.set(key, group);
          }
          children = [...groups].map(([key, group]) => ({
            id: `${id}/module:${key}`,
            label: group.module?.name || "未识别模块",
            listId: list.id,
            changes: group.changes,
            children: directoryNodes(
              group.changes,
              list.id,
              `${id}/module:${key}`,
              group.module?.path === "." ? "" : group.module?.path || "",
            ),
          }));
        } else if (workspace.view.grouping === "directory")
          children = directoryNodes(changes, list.id, id);
        else
          children = changes.map((change) => ({
            id: `${id}/file:${change.path}`,
            label: change.path.split("/").at(-1) || change.path,
            listId: list.id,
            changes: [change],
            children: [],
            change,
          }));
        return { id, label: list.name, listId: list.id, changes, children };
      }),
    [
      snapshot.changes,
      workspace.lists,
      workspace.assignments,
      workspace.activeListId,
      workspace.view.grouping,
      modules,
      value,
    ],
  );
  const rows = useMemo(() => {
    const result: VisibleRow[] = [];
    function add(node: TreeNode, depth: number) {
      result.push({ node, depth });
      if (!collapsed.has(node.id))
        node.children.forEach((child) => add(child, depth + 1));
    }
    nodes.forEach((node) => add(node, 0));
    return result;
  }, [nodes, collapsed]);
  const visible = rows.slice(0, visibleCount);
  const visiblePaths = visible.flatMap(({ node }) =>
    node.change ? [node.change.path] : [],
  );
  const visibleSet = new Set(visiblePaths);
  const hiddenSelection = selected.filter(
    (path) => !visibleSet.has(path),
  ).length;
  useEffect(() => {
    setQuery("");
    setCollapsed(new Set());
    setVisibleCount(PAGE_SIZE);
    setBrowser(null);
    anchor.current = "";
  }, [snapshot.root]);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, workspace.view.grouping]);
  useEffect(() => {
    if (!locate?.path) return;
    const change = snapshot.changes.find((item) => item.path === locate.path);
    if (!change) return;
    onSelect([change.path]);
    if (change.index === "?") {
      setBrowser("untracked");
      return;
    }
    pendingLocate.current = change.path;
    setQuery("");
    setCollapsed(new Set());
  }, [locate?.revision]);
  useEffect(() => {
    if (!pendingLocate.current || query) return;
    const position = rows.findIndex(
      (row) => row.node.change?.path === pendingLocate.current,
    );
    if (position < 0) return;
    if (position >= visibleCount) {
      setVisibleCount(Math.ceil((position + 1) / PAGE_SIZE) * PAGE_SIZE);
      return;
    }
    const node = treeRef.current?.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(pendingLocate.current)}"]`,
    );
    if (node) {
      node.scrollIntoView({ block: "nearest" });
      node.focus({ preventScroll: true });
      pendingLocate.current = "";
    }
  }, [rows, visibleCount, query]);

  function select(
    paths: string[],
    event: SelectionEvent,
    order = visiblePaths,
  ) {
    const last = paths.at(-1) || "";
    if (
      event.shiftKey &&
      anchor.current &&
      order.includes(anchor.current) &&
      order.includes(last)
    ) {
      const start = order.indexOf(anchor.current),
        end = order.indexOf(last);
      const range = order.slice(Math.min(start, end), Math.max(start, end) + 1);
      onSelect(
        event.ctrlKey || event.metaKey
          ? [...new Set([...selected, ...range])]
          : range,
      );
    } else if (event.ctrlKey || event.metaKey) {
      const all = paths.every((path) => selected.includes(path));
      onSelect(
        all
          ? selected.filter((path) => !paths.includes(path))
          : [...new Set([...selected, ...paths])],
      );
      anchor.current = last;
    } else {
      onSelect(paths);
      anchor.current = last;
    }
  }
  function context(event: MouseEvent, paths: string[], listId?: string) {
    event.preventDefault();
    event.stopPropagation();
    const actual =
      !listId && paths.length && paths.every((path) => selected.includes(path))
        ? selected
        : paths;
    onSelect(actual);
    onContext(event, actual, listId);
  }
  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function view(grouping: Grouping) {
    void mutate("commit.view", {
      grouping,
      expectedRevision: workspace.revision,
    });
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).matches("input,textarea,select")) return;
    if (
      event.ctrlKey &&
      event.altKey &&
      ["p", "m"].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      view(event.key.toLowerCase() === "p" ? "directory" : "module");
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "a"
    ) {
      event.preventDefault();
      onSelect(visiblePaths);
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "d" &&
      selected.length
    ) {
      event.preventDefault();
      const change = snapshot.changes.find((item) => item.path === selected[0]);
      openDiff(selected[0], change && !isUnstaged(change) && isStaged(change));
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const elements = [
        ...(treeRef.current?.querySelectorAll<HTMLDivElement>(
          ".workspace-tree-row",
        ) || []),
      ];
      const current = elements.indexOf(
        (event.target as HTMLElement).closest(
          ".workspace-tree-row",
        ) as HTMLDivElement,
      );
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? elements.length - 1
            : Math.max(
                0,
                Math.min(
                  elements.length - 1,
                  current + (event.key === "ArrowDown" ? 1 : -1),
                ),
              );
      if (elements[index]) {
        event.preventDefault();
        elements[index].focus();
      }
    }
  }
  function allGroupIds(items: TreeNode[]): string[] {
    return items.flatMap((item) =>
      item.change ? [] : [item.id, ...allGroupIds(item.children)],
    );
  }
  return (
    <div className="commit-workspace-tree">
      <div className="workspace-view-options">
        <select
          aria-label="更改分组方式"
          value={workspace.view.grouping}
          disabled={busy}
          onChange={(event) => view(event.target.value as Grouping)}
        >
          <option value="flat">平铺</option>
          <option value="directory">目录</option>
          <option value="module">模块</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={workspace.view.showIgnored}
            disabled={busy}
            onChange={(event) =>
              void mutate("commit.view", {
                showIgnored: event.target.checked,
                expectedRevision: workspace.revision,
              })
            }
          />
          显示已忽略文件
        </label>
        <span className="workspace-view-spacer" />
        <IconButton
          title="展开全部更改列表与分组"
          onClick={() => setCollapsed(new Set())}
        >
          <ChevronsUpDown size={14} />
        </IconButton>
        <IconButton
          title="收起全部更改列表与分组"
          onClick={() => setCollapsed(new Set(allGroupIds(nodes)))}
        >
          <ChevronsDownUp size={14} />
        </IconButton>
      </div>
      <label className="commit-file-search input-shell workspace-file-search">
        <Search size={14} />
        <input
          aria-label="筛选更改文件名或路径"
          placeholder="搜索文件或路径…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {selected.length > 0 && (
        <div className="workspace-selection-summary">
          已选择 {selected.length} 个文件
          {hiddenSelection > 0 && `，其中 ${hiddenSelection} 个未显示`}
          <button onClick={() => onSelect([])}>清除选择</button>
        </div>
      )}
      <div
        className="changes-scroll workspace-tree-scroll"
        role="tree"
        aria-label="更改列表，复选框表示真实 Git 暂存"
        aria-multiselectable="true"
        ref={treeRef}
        onKeyDown={keyDown}
      >
        {visible.map(({ node, depth }) => {
          const change = node.change,
            paths = node.changes.map((item) => item.path);
          const eligible = node.changes.filter((item) => !item.conflict),
            staged = eligible.filter(isStaged);
          const checked =
            eligible.length > 0 &&
            eligible.every((item) => isStaged(item) && !isUnstaged(item));
          const partial = staged.length > 0 && !checked;
          const chosen =
            paths.length > 0 && paths.every((path) => selected.includes(path));
          const open = !collapsed.has(node.id),
            list = depth === 0;
          const status = change?.conflict
            ? "conflicted"
            : change && /[AC]/.test(change.index)
              ? "added"
              : "modified";
          return (
            <div
              key={node.id}
              className={`workspace-tree-row ${change ? "change-row" : "workspace-group-row"} ${chosen ? "selected" : ""}`}
              data-status={change ? status : undefined}
              data-list-id={node.listId}
              data-path={change?.path}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={change ? undefined : open}
              aria-selected={chosen}
              tabIndex={0}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={(event) => {
                select(paths, event);
                if (
                  change &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey
                )
                  openDiff(
                    change.path,
                    !isUnstaged(change) && isStaged(change),
                  );
              }}
              onContextMenu={(event) =>
                context(event, paths, list ? node.listId : undefined)
              }
              onKeyDown={(event) => {
                if (
                  event.key === "ContextMenu" ||
                  (event.shiftKey && event.key === "F10")
                ) {
                  const actual = chosen && !list ? selected : paths;
                  onSelect(actual);
                  keyboardContext(
                    event,
                    onContext,
                    actual,
                    list ? node.listId : undefined,
                  );
                } else if (event.target !== event.currentTarget) {
                  return;
                } else if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  select(paths, event);
                  if (event.key === "Enter") {
                    if (change)
                      openDiff(
                        change.path,
                        !isUnstaged(change) && isStaged(change),
                      );
                    else toggle(node.id);
                  }
                } else if (
                  !change &&
                  ["ArrowLeft", "ArrowRight"].includes(event.key)
                ) {
                  event.preventDefault();
                  if (
                    (event.key === "ArrowLeft" && open) ||
                    (event.key === "ArrowRight" && !open)
                  )
                    toggle(node.id);
                }
              }}
            >
              {!change && (
                <IconButton
                  title={`${open ? "收起" : "展开"} ${node.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(node.id);
                  }}
                >
                  <ChevronRight size={13} className={open ? "rotate" : ""} />
                </IconButton>
              )}
              <span
                className="workspace-stage-control"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <StageCheckbox
                  label={`${checked ? "取消暂存" : "暂存"} ${change?.path || node.label}${partial ? "（部分暂存）" : ""}${change?.conflict ? "，冲突尚未解决" : ""}`}
                  checked={checked}
                  mixed={partial}
                  disabled={busy || !eligible.length}
                  onChange={(stage) => {
                    const items = stage ? eligible.filter(isUnstaged) : staged;
                    if (items.length)
                      void mutate(stage ? "stage" : "unstage", {
                        paths: items.map((item) => item.path),
                      });
                  }}
                />
              </span>
              {change ? (
                <FileIcon name={change.path} />
              ) : !list ? (
                <Folder size={13} />
              ) : null}
              <span
                className="workspace-node-name truncate"
                title={
                  change
                    ? `${change.oldPath ? `${change.oldPath} → ` : ""}${change.path}`
                    : node.label
                }
              >
                {node.label}
              </span>
              {list && workspace.activeListId === node.listId && (
                <span className="workspace-active-marker">活动</span>
              )}
              {!change && (
                <span className="workspace-node-count muted">
                  {node.changes.length}
                </span>
              )}
              {change && workspace.view.grouping === "flat" && (
                <span className="change-directory truncate">
                  {change.path.includes("/")
                    ? change.path.slice(0, change.path.lastIndexOf("/"))
                    : ""}
                </span>
              )}
              {change && (
                <>
                  <span className="partial-stage">
                    {change.conflict
                      ? "冲突"
                      : partial
                        ? "部分暂存"
                        : isStaged(change)
                          ? "已暂存"
                          : "未暂存"}
                  </span>
                  <span className="change-letter">
                    {change.conflict
                      ? "!"
                      : isStaged(change)
                        ? change.index
                        : change.worktree}
                  </span>
                </>
              )}
              {change && isStaged(change) && isUnstaged(change) && (
                <IconButton
                  title={`查看 ${change.path} 的已暂存差异`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openDiff(change.path, true);
                  }}
                >
                  <Eye size={13} />
                </IconButton>
              )}
            </div>
          );
        })}
        {rows.length > visibleCount && (
          <button
            className="more-changes"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          >
            显示更多（剩余 {rows.length - visibleCount} 行）
          </button>
        )}
        {value && !nodes.some((node) => node.changes.length > 0) && (
          <Empty title="没有匹配的更改" />
        )}
        {!tracked.length && !value && (
          <div className="workspace-tree-hint muted">
            没有已托管的更改。右键更改列表可管理任务。
          </div>
        )}
        {untracked.length > 0 && (
          <div className="untracked-summary">
            <span>未进行版本管理的文件</span>
            <span className="muted">{untracked.length} 个</span>
            <button onClick={() => setBrowser("untracked")}>浏览</button>
          </div>
        )}
        {workspace.view.showIgnored && (
          <div className="untracked-summary">
            <span>已忽略文件</span>
            <span className="muted">按需读取</span>
            <button onClick={() => setBrowser("ignored")}>浏览</button>
          </div>
        )}
      </div>
      {browser &&
        createPortal(
          browser === "ignored" ? (
            <IgnoredBrowser
              repo={snapshot.root}
              onClose={() => setBrowser(null)}
              onContext={onContext}
              openDiff={openDiff}
            />
          ) : (
            <UntrackedFilesBrowser
              changes={untracked}
              busy={busy}
              selected={selected}
              onSelect={onSelect}
              select={select}
              mutate={mutate}
              openDiff={openDiff}
              onContext={context}
              onClose={() => setBrowser(null)}
            />
          ),
          document.body,
        )}
    </div>
  );
}

function UntrackedFilesBrowser({
  changes,
  busy,
  selected,
  onSelect,
  select,
  mutate,
  openDiff,
  onContext,
  onClose,
}: {
  changes: Change[];
  busy: boolean;
  selected: string[];
  onSelect: (paths: string[]) => void;
  select: (paths: string[], event: SelectionEvent, order: string[]) => void;
  mutate: CommitTreeProps["mutate"];
  openDiff: CommitTreeProps["openDiff"];
  onContext: CommitTreeProps["onContext"];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [requestedPage, setPage] = useState(0);
  const filtered = changes.filter((change) =>
    change.path.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    page = Math.min(requestedPage, pages - 1);
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    order = visible.map((change) => change.path);
  return (
    <Modal title="未进行版本管理的文件" onClose={onClose} wide>
      <div className="untracked-browser">
        <label className="commit-file-search input-shell">
          <Search size={14} />
          <input
            aria-label="筛选未托管文件"
            placeholder="搜索文件或路径…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="untracked-browser-toolbar">
          <span className="muted">
            {filtered.length} / {changes.length} 个文件
          </span>
          <button
            disabled={busy || !visible.length}
            onClick={() => void mutate("stage", { paths: order })}
          >
            暂存本页文件
          </button>
        </div>
        <div
          className="untracked-files"
          role="listbox"
          aria-label="未托管文件"
          aria-multiselectable="true"
        >
          {visible.map((change) => (
            <div
              key={change.path}
              role="option"
              aria-selected={selected.includes(change.path)}
              tabIndex={0}
              className={`change-row workspace-tree-row ${selected.includes(change.path) ? "selected" : ""}`}
              data-status="untracked"
              onClick={(event) => {
                select([change.path], event, order);
                if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
                  openDiff(change.path);
                  onClose();
                }
              }}
              onContextMenu={(event) => {
                onContext(event, [change.path]);
              }}
              onKeyDown={(event) => {
                if ((event.target as HTMLElement).matches("input")) return;
                if (
                  event.key === "ContextMenu" ||
                  (event.shiftKey && event.key === "F10")
                ) {
                  const paths = selected.includes(change.path)
                    ? selected
                    : [change.path];
                  onSelect(paths);
                  keyboardContext(event, onContext, paths);
                } else if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  select([change.path], event, order);
                  if (event.key === "Enter") {
                    openDiff(change.path);
                    onClose();
                  }
                }
              }}
            >
              <span
                className="workspace-stage-control"
                onClick={(event) => event.stopPropagation()}
              >
                <StageCheckbox
                  label={`加入 Git 暂存区 ${change.path}`}
                  checked={false}
                  disabled={busy}
                  onChange={() =>
                    void mutate("stage", { paths: [change.path] })
                  }
                />
              </span>
              <FileIcon name={change.path} />
              <span className="truncate" title={change.path}>
                {change.path}
              </span>
              <span className="change-letter">U</span>
            </div>
          ))}
          {!visible.length && <Empty title="没有匹配的未托管文件" />}
        </div>
        <div className="untracked-browser-footer">
          <span className="muted">勾选会真实加入 Git 暂存区</span>
          <IconButton
            title="上一页"
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={14} />
          </IconButton>
          <span>
            {page + 1} / {pages}
          </span>
          <IconButton
            title="下一页"
            disabled={page + 1 >= pages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={14} />
          </IconButton>
        </div>
      </div>
    </Modal>
  );
}

function IgnoredBrowser({
  repo,
  onClose,
  onContext,
  openDiff,
}: {
  repo: string;
  onClose: () => void;
  onContext: CommitTreeProps["onContext"];
  openDiff: CommitTreeProps["openDiff"];
}) {
  const [directory, setDirectory] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<IgnoredPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setResult(null);
    setError("");
    void request<IgnoredPage>("ignoredFiles", repo, {
      directory,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    })
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repo, directory, page, retry]);
  return (
    <Modal title="已忽略文件" onClose={onClose} wide>
      <div className="untracked-browser">
        <div className="untracked-browser-toolbar">
          <IconButton
            title="上级目录"
            disabled={!directory || loading}
            onClick={() => {
              setDirectory(
                directory.split("/").filter(Boolean).slice(0, -1).join("/"),
              );
              setPage(0);
            }}
          >
            <ChevronLeft size={14} />
          </IconButton>
          <span className="truncate" title={directory || "仓库根目录"}>
            {directory || "仓库根目录"}
          </span>
          <button
            onClick={() => setRetry((value) => value + 1)}
            disabled={loading}
          >
            刷新
          </button>
        </div>
        <p className="muted workspace-browser-hint">
          目录按需读取。已忽略文件不参与暂存、提交或搁置。
        </p>
        <div className="untracked-files" aria-busy={loading}>
          {loading ? (
            <div className="workspace-tree-hint muted" role="status">
              正在读取忽略项…
            </div>
          ) : error ? (
            <div className="workspace-error" role="alert">
              {error}
              <button onClick={() => setRetry((value) => value + 1)}>
                重试
              </button>
            </div>
          ) : (
            result?.entries.map((entry) => (
              <div className="workspace-ignored-row" key={entry.path}>
                <button
                  title={entry.path}
                  onClick={() => {
                    if (entry.directory) {
                      setDirectory(entry.path.replace(/\/$/, ""));
                      setPage(0);
                    } else {
                      openDiff(entry.path);
                      onClose();
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onContext(event, [entry.path]);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ContextMenu" ||
                      (event.shiftKey && event.key === "F10")
                    )
                      keyboardContext(event, onContext, [entry.path]);
                  }}
                >
                  {entry.directory ? (
                    <Folder size={14} />
                  ) : (
                    <FileIcon name={entry.path} />
                  )}
                  <span className="truncate">{entry.path}</span>
                  {entry.directory && <ChevronRight size={13} />}
                </button>
              </div>
            ))
          )}
          {!loading && !error && !result?.entries.length && (
            <Empty title="此目录没有已忽略文件" />
          )}
        </div>
        <div className="untracked-browser-footer">
          <span className="muted">
            {result ? `此目录共 ${result.total} 项` : ""}
          </span>
          <IconButton
            title="上一页忽略项"
            disabled={loading || !page}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={14} />
          </IconButton>
          <span>第 {page + 1} 页</span>
          <IconButton
            title="下一页忽略项"
            disabled={loading || !result?.hasMore}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={14} />
          </IconButton>
        </div>
      </div>
    </Modal>
  );
}
