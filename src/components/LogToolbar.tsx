import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ArrowDownWideNarrow,
  ChevronDown,
  CirclePlay,
  Eye,
  GitFork,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { Commit, RepoSnapshot } from "../../shared/types";
import type { LogFilters, LogLocation } from "../../shared/log";
import { readLogSearches, saveLogSearch, type LogView } from "../log-settings";
import {
  LogFilterPopup,
  LogJumpPopup,
  LogPopup,
  type FilterKind,
} from "./LogDialogs";
import { IconButton, Spinner } from "./ui";

export function LogToolbar({
  snapshot,
  filters,
  change,
  view,
  updateView,
  refresh,
  loading,
  busy,
  index,
  currentPath,
  onJump,
  onHead,
  searchRef,
  jumpSignal,
}: {
  snapshot: RepoSnapshot | null;
  filters: LogFilters;
  change: (patch: Partial<LogFilters>) => void;
  view: LogView;
  updateView: (patch: Partial<LogView>) => void;
  refresh: () => void;
  loading: boolean;
  busy: boolean;
  index: () => Promise<void>;
  currentPath?: string;
  onJump: (location: LogLocation, commit: Commit) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  jumpSignal: number;
  onHead: () => void;
}) {
  const [draft, setDraft] = useState(filters.search);
  const [menu, setMenu] = useState<
    FilterKind | "graph" | "view" | "history" | "jump" | null
  >(null);
  const [history, setHistory] = useState<string[]>([]);
  const [indexing, setIndexing] = useState(false);
  const anchor = useRef<HTMLElement>(null),
    jumpButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setDraft(filters.search);
  }, [filters.search]);
  useEffect(() => {
    setMenu(null);
    setHistory(snapshot?.root ? readLogSearches(snapshot.root) : []);
  }, [snapshot?.root]);
  useEffect(() => {
    if (jumpSignal && snapshot) {
      anchor.current = jumpButton.current;
      setMenu("jump");
    }
  }, [jumpSignal]);
  const applySearch = (value = draft) => {
    if (value !== filters.search) change({ search: value });
    if (value.trim() && value.length <= 2000 && snapshot)
      setHistory(saveLogSearch(snapshot.root, value));
  };
  const open = (name: NonNullable<typeof menu>, target: HTMLElement) => {
    anchor.current = target;
    setMenu((current) => (current === name ? null : name));
  };
  const refs = [filters.ref, ...(filters.refs || [])].filter(Boolean);
  const authors = [filters.author, ...(filters.authors || [])].filter(Boolean);
  const paths = [filters.file, ...(filters.paths || [])].filter(Boolean);
  const refName = (value: string) =>
    value === "HEAD"
      ? "当前分支"
      : value.replace(/^refs\/(heads|remotes|tags)\//, "");
  const items: {
    kind: FilterKind;
    label: string;
    value: string;
    clear: Partial<LogFilters>;
    full: string;
  }[] = [
    {
      kind: "branch",
      label: "分支",
      value: refs.length
        ? `${refName(refs[0])}${refs.length > 1 ? ` +${refs.length - 1}` : ""}`
        : "",
      clear: { ref: "", refs: [] },
      full: refs.map(refName).join(", "),
    },
    {
      kind: "author",
      label: "用户",
      value: authors.length
        ? `${authors[0].split("@")[0]}${authors.length > 1 ? ` +${authors.length - 1}` : ""}`
        : "",
      clear: { author: "", authors: [] },
      full: authors.join(", "),
    },
    {
      kind: "date",
      label: "日期",
      value:
        filters.since || filters.until
          ? `${filters.since || "…"}～${filters.until || "…"}`
          : "",
      clear: { since: "", until: "" },
      full: "",
    },
    {
      kind: "path",
      label: "路径",
      value: paths.length
        ? `${paths[0]}${paths.length > 1 ? ` +${paths.length - 1}` : ""}`
        : "",
      clear: { file: "", paths: [] },
      full: paths.join(", "),
    },
  ];
  const options: [keyof LogView, string][] = [
    ["author", "作者列"],
    ["date", "日期列"],
    ["hash", "提交哈希列"],
    ["headers", "列标题与宽度调整"],
    ["details", "提交详情"],
    ["tagNames", "标签名称"],
    ["refsLeft", "在左侧显示引用"],
    ["longEdges", "长边"],
    ["commitTimestamp", "使用提交者时间戳"],
    ["highlightMine", "高亮我的提交"],
    ["highlightMerges", "淡化合并提交"],
  ];
  return (
    <div className="idea-log-toolbar">
      <div className="idea-log-toolbar-main">
        <div className="log-search input-shell">
          <IconButton
            title="搜索历史"
            onClick={(event) => open("history", event.currentTarget)}
          >
            <Search size={14} />
            <ChevronDown size={8} />
          </IconButton>
          <input
            ref={searchRef}
            aria-label="搜索提交"
            placeholder="文本或哈希"
            value={draft}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => applySearch()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applySearch();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setDraft(filters.search);
              }
            }}
          />
          {draft && (
            <IconButton
              title="清除搜索"
              onClick={() => {
                setDraft("");
                change({ search: "" });
              }}
            >
              <X size={12} />
            </IconButton>
          )}
          <IconButton
            title="正则表达式（Git 扩展正则）"
            active={!!filters.regex}
            onClick={() => {
              applySearch();
              change({ search: draft, regex: !filters.regex });
            }}
          >
            .*
          </IconButton>
          <IconButton
            title="区分大小写"
            active={!!filters.matchCase}
            onClick={() => {
              applySearch();
              change({ search: draft, matchCase: !filters.matchCase });
            }}
          >
            Cc
          </IconButton>
        </div>
        <div className="log-filter-buttons">
          {items.map((item) => (
            <div
              className={`log-filter-trigger ${item.value ? "is-filtered" : ""}`}
              key={item.kind}
            >
              <button
                disabled={!snapshot}
                title={item.full || item.value || item.label}
                aria-label={
                  item.value
                    ? `${item.label}：${item.value}`
                    : `筛选${item.label}`
                }
                aria-haspopup="dialog"
                aria-expanded={menu === item.kind}
                onClick={(event) => open(item.kind, event.currentTarget)}
              >
                <span>
                  {item.label}
                  {item.value ? ":" : ""}
                </span>
                {item.value && (
                  <strong className="truncate">{item.value}</strong>
                )}
                {!item.value && <ChevronDown size={11} />}
              </button>
              {item.value && (
                <IconButton
                  title={`清除${item.label}筛选`}
                  onClick={() => change(item.clear)}
                >
                  <X size={12} />
                </IconButton>
              )}
            </div>
          ))}
        </div>
        <IconButton
          title="图选项"
          active={menu === "graph"}
          onClick={(event) => open("graph", event.currentTarget)}
        >
          <ArrowDownWideNarrow size={16} />
          <ChevronDown size={8} />
        </IconButton>
        <span className="spacer" />
        <div className="log-toolbar-actions">
          <IconButton
            title="构建 Git 提交图与路径索引"
            disabled={!snapshot || busy || indexing || !snapshot.head}
            onClick={async () => {
              setIndexing(true);
              try {
                await index();
              } finally {
                setIndexing(false);
              }
            }}
          >
            {indexing ? <Spinner /> : <CirclePlay size={16} />}
          </IconButton>
          <IconButton
            title="刷新日志"
            disabled={loading || !snapshot}
            onClick={refresh}
          >
            {loading ? <Spinner /> : <RefreshCw size={16} />}
          </IconButton>
          <IconButton
            title="转到当前分支 HEAD"
            disabled={!snapshot?.head}
            onClick={onHead}
          >
            <GitFork size={16} />
          </IconButton>
          <IconButton
            title="日志显示选项"
            active={menu === "view"}
            onClick={(event) => open("view", event.currentTarget)}
          >
            <Eye size={17} />
          </IconButton>
          <button
            ref={jumpButton}
            className="icon-button"
            title="转到哈希 / 分支 / 标签（Ctrl+F）"
            aria-label="转到哈希 / 分支 / 标签（Ctrl+F）"
            disabled={!snapshot}
            onClick={(event) => open("jump", event.currentTarget)}
          >
            <Search size={16} />
          </button>
        </div>
      </div>
      {menu &&
        snapshot &&
        (["branch", "author", "date", "path"] as string[]).includes(menu) && (
          <LogFilterPopup
            key={`${snapshot.root}:${menu}`}
            kind={menu as FilterKind}
            anchor={anchor}
            snapshot={snapshot}
            filters={filters}
            currentPath={currentPath}
            apply={change}
            onClose={() => setMenu(null)}
          />
        )}
      {menu === "history" && (
        <LogPopup
          anchor={anchor}
          title="搜索历史"
          onClose={() => setMenu(null)}
          menu
        >
          {history.length ? (
            history.map((value) => (
              <button
                role="menuitem"
                className="truncate"
                key={value}
                title={value}
                onClick={() => {
                  setDraft(value);
                  applySearch(value);
                  setMenu(null);
                }}
              >
                {value}
              </button>
            ))
          ) : (
            <div className="group-empty">尚无搜索历史</div>
          )}
        </LogPopup>
      )}
      {menu === "jump" && snapshot && (
        <LogJumpPopup
          key={snapshot.root}
          repo={snapshot.root}
          snapshot={snapshot}
          anchor={anchor}
          onClose={() => setMenu(null)}
          onJump={onJump}
        />
      )}
      {menu === "graph" && (
        <LogPopup anchor={anchor} title="图选项" onClose={() => setMenu(null)}>
          <div className="log-option-heading">排序</div>
          <label className="log-option">
            <input
              type="radio"
              name="log-order"
              checked={filters.order !== "topo"}
              onChange={() => change({ order: "date" })}
            />
            按提交日期
          </label>
          <label className="log-option">
            <input
              type="radio"
              name="log-order"
              checked={filters.order === "topo"}
              onChange={() => change({ order: "topo" })}
            />
            以拓扑方式
          </label>
          <div className="menu-divider" />
          <label className="log-option">
            <input
              type="checkbox"
              checked={!!filters.firstParent}
              onChange={(event) =>
                change({ firstParent: event.target.checked })
              }
            />
            仅显示第一个父项
          </label>
          <label className="log-option">
            <input
              type="checkbox"
              checked={!!filters.noMerges}
              onChange={(event) => change({ noMerges: event.target.checked })}
            />
            无合并提交
          </label>
          <div className="menu-divider" />
          <label className="log-option">
            <input
              type="checkbox"
              checked={view.collapseLinear}
              onChange={(event) =>
                updateView({ collapseLinear: event.target.checked })
              }
            />
            折叠线性分支
          </label>
          <p className="tiny muted log-option-note">
            折叠段保留数量，点击即可展开。
          </p>
        </LogPopup>
      )}
      {menu === "view" && (
        <LogPopup
          anchor={anchor}
          title="日志显示选项"
          onClose={() => setMenu(null)}
        >
          {options.map(([field, label], i) => (
            <div key={field}>
              {[4, 5, 9].includes(i) && <div className="menu-divider" />}
              <label className="log-option">
                <input
                  type="checkbox"
                  checked={Boolean(view[field])}
                  onChange={(event) =>
                    updateView({ [field]: event.target.checked })
                  }
                />
                {label}
              </label>
            </div>
          ))}
        </LogPopup>
      )}
    </div>
  );
}
