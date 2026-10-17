import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ChevronDown,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  Tag,
  X,
} from "lucide-react";
import type { Commit, RepoSnapshot } from "../../shared/types";
import {
  LOG_MAX_COUNT,
  LOG_PAGE_SIZE,
  type LogFilters,
  type LogLocation,
} from "../../shared/log";
import { buildLogGraph } from "../graph";
import { request } from "../api";
import { useLogView } from "../log-settings";
import { LogToolbar } from "./LogToolbar";
import { LogPopup } from "./LogDialogs";
import { Empty, IconButton, Spinner } from "./ui";

const ROW = 30;
function logDate(value: string) {
  const date = new Date(value),
    pad = (n: number) => String(n).padStart(2, "0");
  return Number.isNaN(date.valueOf())
    ? value
    : `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function RefLabels({
  commit,
  tagNames,
  remotes,
}: {
  commit: Commit;
  tagNames: boolean;
  remotes: string[];
}) {
  return (
    <span className="log-refs">
      {commit.refs
        .split(", ")
        .filter(Boolean)
        .map((ref) => {
          const tag = ref.startsWith("tag: "),
            head = ref === "HEAD" || ref.startsWith("HEAD -> "),
            remote =
              !tag &&
              !head &&
              (remotes.some((name) => ref.startsWith(`${name}/`)) ||
                ref.startsWith("refs/remotes/"));
          return (
            <span
              key={ref}
              className={`ref-pill ${head ? "head" : tag ? "tag-ref" : remote ? "remote-ref" : "local-ref"}`}
              title={ref}
            >
              {tag ? <Tag size={10} /> : <GitBranch size={10} />}
              {(!tag || tagNames) && (
                <span className="truncate">
                  {ref.replace("HEAD -> ", "").replace("tag: ", "")}
                </span>
              )}
            </span>
          );
        })}
    </span>
  );
}
function Subject({
  text,
  query,
  matchCase,
  regex,
}: {
  text: string;
  query: string;
  matchCase?: boolean;
  regex?: boolean;
}) {
  if (!query || regex) return <>{text}</>;
  const source = matchCase ? text : text.toLocaleLowerCase(),
    needle = matchCase ? query : query.toLocaleLowerCase();
  const nodes: React.ReactNode[] = [];
  let cursor = 0,
    count = 0;
  for (
    let index = source.indexOf(needle);
    index >= 0 && count < 100;
    index = source.indexOf(needle, cursor)
  ) {
    nodes.push(
      text.slice(cursor, index),
      <mark key={index}>{text.slice(index, index + query.length)}</mark>,
    );
    cursor = index + query.length;
    count++;
  }
  nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

export function LogTable({
  snapshot: s,
  selected,
  select,
  filters,
  setFilters,
  loading,
  refresh,
  error = "",
  busy,
  mutate,
  action,
  createBranch,
  notify,
  currentPath,
  onDetailsChange,
}: {
  snapshot: RepoSnapshot | null;
  selected: string;
  select: (hash: string) => void;
  filters: LogFilters;
  setFilters: (filters: LogFilters) => void;
  loading: boolean;
  refresh: () => void;
  error?: string;
  busy: boolean;
  mutate: (
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<boolean>;
  action: (name: string, commit: Commit) => void;
  createBranch: (hash: string) => void;
  notify: (message: string, error?: boolean) => void;
  currentPath?: string;
  onDetailsChange: (show: boolean) => void;
}) {
  const repo = s?.root || "";
  const commits = s?.commits || [];
  const [view, updateView] = useLogView(repo);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [scrollTop, setScrollTop] = useState(0),
    [height, setHeight] = useState(400);
  const [jumpSignal, setJumpSignal] = useState(0),
    [hint, setHint] = useState("");
  const [menu, setMenu] = useState<{
    hash: string;
    x: number;
    y: number;
  } | null>(null);
  const panel = useRef<HTMLElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const contextAnchor = useRef<HTMLSpanElement>(null),
    root = useRef(repo),
    navigation = useRef(0);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const intent = useRef({ selected, query: JSON.stringify(filters) });
  intent.current = { selected, query: JSON.stringify(filters) };
  const scrolledSelection = useRef("");
  const [scrollRequest, setScrollRequest] = useState(0);
  root.current = repo;
  const model = useMemo(
    () =>
      buildLogGraph(commits, {
        collapseLinear: view.collapseLinear,
        expanded,
        selected: view.collapseLinear ? selected : undefined,
      }),
    [
      commits,
      view.collapseLinear,
      expanded,
      view.collapseLinear ? selected : undefined,
    ],
  );
  const width = useMemo(
    () =>
      Math.max(
        30,
        model.graph.reduce(
          (max, row) =>
            Math.max(
              max,
              row.width * 16 + 12,
              row.lane * 16 +
                22 +
                Math.max(
                  0,
                  row.lines.filter((line) => line.boundary).length - 1,
                ) *
                  6,
            ),
          28,
        ),
      ),
    [model.graph],
  );
  const selectedCommit = commits.find((commit) => commit.hash === selected);
  const contextCommit = commits.find((commit) => commit.hash === menu?.hash);
  const change = (patch: Partial<LogFilters>) =>
    setFilters({ ...filters, ...patch, limit: patch.limit ?? LOG_PAGE_SIZE });
  useEffect(
    () => onDetailsChange(view.details),
    [view.details, onDetailsChange],
  );
  useEffect(() => {
    setExpanded(new Set());
  }, [view.collapseLinear]);
  useEffect(() => {
    setMenu(null);
    setHint("");
    setExpanded(new Set());
  }, [repo]);
  useEffect(
    () => () => {
      resizeCleanup.current?.();
      navigation.current++;
    },
    [repo],
  );
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const update = () => setHeight(node.clientHeight);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const key = JSON.stringify([
      repo,
      selected,
      view.headers,
      view.collapseLinear,
      [...expanded],
      scrollRequest,
    ]);
    if (key === scrolledSelection.current) return;
    const row = model.hashToRow.get(selected),
      node = scroll.current;
    if (row === undefined || !node) return;
    scrolledSelection.current = key;
    const headerHeight = view.headers ? 26 : 0;
    const top = row * ROW + headerHeight;
    if (top < node.scrollTop + headerHeight)
      node.scrollTop = top - headerHeight;
    else if (top + ROW > node.scrollTop + node.clientHeight)
      node.scrollTop = Math.max(0, top - node.clientHeight + ROW);
    setScrollTop(node.scrollTop);
  }, [
    repo,
    selected,
    model.hashToRow,
    view.headers,
    view.collapseLinear,
    expanded,
    scrollRequest,
  ]);
  const copy = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => notify(`已复制${label}`))
      .catch(() => notify("复制失败", true));
    setMenu(null);
  };
  const jump = (location: LogLocation, commit: Commit) => {
    setScrollRequest((value) => value + 1);
    if (!commits.some((item) => item.hash === commit.hash)) {
      change({
        search: "",
        ref: location.anchor ? commit.hash : "",
        refs: [],
        author: "",
        authors: [],
        since: "",
        until: "",
        file: "",
        paths: [],
        firstParent: false,
        noMerges: false,
        order: "date",
        limit: location.limit,
      });
      setHint(
        location.anchor
          ? "已以目标提交为起点显示历史，清除分支筛选可返回全部。"
          : "已清除筛选并定位到目标提交。",
      );
    }
    select(commit.hash);
    scroll.current?.focus({ preventScroll: true });
  };
  const navigate = async (hash: string) => {
    const id = ++navigation.current;
    if (commits.some((commit) => commit.hash === hash)) {
      select(hash);
      setScrollRequest((value) => value + 1);
      return;
    }
    const target = repo;
    const previous = intent.current;
    const current = () =>
      target === root.current &&
      id === navigation.current &&
      previous.selected === intent.current.selected &&
      previous.query === intent.current.query;
    try {
      const commit = await request<Commit>("logResolve", repo, { ref: hash });
      const location = await request<LogLocation>("logLocate", repo, {
        ref: hash,
      });
      if (current()) jump(location, commit);
    } catch (cause) {
      if (current()) notify((cause as Error).message, true);
    }
  };
  const resizeColumn = (
    event: React.PointerEvent,
    field: "authorWidth" | "dateWidth" | "hashWidth",
  ) => {
    resizeCleanup.current?.();
    event.preventDefault();
    const start = event.clientX,
      initial = view[field];
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const move = (pointer: PointerEvent) =>
      updateView({
        [field]: Math.max(75, Math.min(400, initial + pointer.clientX - start)),
      });
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    resizeCleanup.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const columns = `minmax(160px, 1fr)${view.author ? ` ${view.authorWidth}px` : ""}${view.date ? ` ${view.dateWidth}px` : ""}${view.hash ? ` ${view.hashWidth}px` : ""}`;
  const start = Math.max(
      0,
      Math.min(
        Math.max(0, model.items.length - 1),
        Math.floor((scrollTop - (view.headers ? 26 : 0)) / ROW) - 8,
      ),
    ),
    end = Math.min(model.items.length, start + Math.ceil(height / ROW) + 17);
  const activeFilters = !!(
    filters.search ||
    filters.ref ||
    filters.refs?.length ||
    filters.author ||
    filters.authors?.length ||
    filters.since ||
    filters.until ||
    filters.file ||
    filters.paths?.length ||
    filters.firstParent ||
    filters.noMerges
  );
  const clearFilters = () =>
    change({
      search: "",
      ref: "",
      refs: [],
      author: "",
      authors: [],
      since: "",
      until: "",
      file: "",
      paths: [],
      firstParent: false,
      noMerges: false,
    });
  const openContext = (commit: Commit, x: number, y: number) => {
    select(commit.hash);
    scroll.current?.focus({ preventScroll: true });
    setMenu({ hash: commit.hash, x, y });
  };
  const contextAction = (name: string, commit: Commit) => {
    setMenu(null);
    action(name, commit);
  };

  return (
    <section
      ref={panel}
      className="log-table-panel idea-log"
      style={{ "--log-columns": columns } as CSSProperties}
      onKeyDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(".log-popup")
        )
          return;
        if (
          (event.ctrlKey || event.metaKey) &&
          ["l", "f"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key.toLowerCase() === "l") {
            search.current?.focus();
            search.current?.select();
          } else setJumpSignal((value) => value + 1);
        }
      }}
    >
      <LogToolbar
        snapshot={s}
        filters={filters}
        change={change}
        view={view}
        updateView={updateView}
        refresh={refresh}
        loading={loading}
        busy={busy}
        currentPath={currentPath}
        searchRef={search}
        jumpSignal={jumpSignal}
        index={async () => {
          await mutate("log.index");
        }}
        onJump={jump}
        onHead={() => void navigate("HEAD")}
      />
      {hint && (
        <div className="log-hint" role="status">
          <span>{hint}</span>
          <IconButton title="关闭定位提示" onClick={() => setHint("")}>
            <X size={12} />
          </IconButton>
        </div>
      )}
      <div
        ref={scroll}
        className="log-scroll idea-log-scroll"
        role="listbox"
        aria-label="提交日志"
        tabIndex={0}
        aria-busy={loading}
        aria-activedescendant={
          selected &&
          model.hashToRow.has(selected) &&
          model.hashToRow.get(selected)! >= start &&
          model.hashToRow.get(selected)! < end
            ? `commit-${selected}`
            : undefined
        }
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const index = model.hashToRow.get(selected) ?? -1;
          const offsets: Record<string, number> = {
            ArrowUp: -1,
            ArrowDown: 1,
            PageUp: -Math.max(1, Math.floor(height / ROW) - 1),
            PageDown: Math.max(1, Math.floor(height / ROW) - 1),
          };
          if (
            event.key in offsets ||
            event.key === "Home" ||
            event.key === "End"
          ) {
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? model.items.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        model.items.length - 1,
                        index + offsets[event.key],
                      ),
                    );
            if (model.items[next]) select(model.items[next].commit.hash);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const hash =
              event.key === "ArrowLeft"
                ? selectedCommit?.parents[0]
                : commits.find((commit) => commit.parents.includes(selected))
                    ?.hash;
            if (hash) void navigate(hash);
            else if (selectedCommit)
              setHint(
                event.key === "ArrowLeft"
                  ? "此提交没有父提交。"
                  : "当前结果中没有可见子提交。",
              );
          } else if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "c" &&
            selectedCommit
          ) {
            event.preventDefault();
            copy(selectedCommit.hash, "提交哈希");
          } else if (
            ((event.key === "F10" && event.shiftKey) ||
              event.key === "ContextMenu") &&
            selectedCommit
          ) {
            event.preventDefault();
            const bounds = scroll.current!.getBoundingClientRect();
            openContext(
              selectedCommit,
              bounds.left + Math.min(width + 40, 180),
              bounds.top +
                Math.max(0, index * ROW - scroll.current!.scrollTop) +
                ROW,
            );
          } else if (event.key === "Enter" && selectedCommit)
            updateView({ details: true });
        }}
      >
        {error ? (
          <div className="log-query-error" role="alert">
            <strong>无法读取提交日志</strong>
            <span>{error}</span>
            <button className="small" onClick={refresh}>
              重试
            </button>
            {activeFilters && (
              <button className="small" onClick={clearFilters}>
                清除筛选
              </button>
            )}
          </div>
        ) : !s ? (
          <Empty title="尚未打开仓库" />
        ) : !commits.length ? (
          <Empty
            icon={loading ? <Spinner /> : <GitCommitHorizontal size={28} />}
            title={
              loading
                ? "正在读取历史…"
                : activeFilters
                  ? "没有匹配的提交"
                  : "没有提交记录"
            }
          >
            {activeFilters ? (
              <button className="small" onClick={clearFilters}>
                清除筛选
              </button>
            ) : (
              !loading && <span>在提交面板创建第一条提交</span>
            )}
          </Empty>
        ) : (
          <>
            <div
              className="idea-log-list"
              style={{
                minWidth:
                  Math.max(160, width + 120) +
                  (view.author ? view.authorWidth : 0) +
                  (view.date ? view.dateWidth : 0) +
                  (view.hash ? view.hashWidth : 0),
              }}
            >
              {view.headers && (
                <div className="idea-log-columns">
                  <span>提交</span>
                  {view.author && (
                    <span>
                      作者
                      <span
                        role="separator"
                        aria-label="调整作者列宽"
                        aria-orientation="vertical"
                        onPointerDown={(event) =>
                          resizeColumn(event, "authorWidth")
                        }
                      />
                    </span>
                  )}
                  {view.date && (
                    <span>
                      日期
                      <span
                        role="separator"
                        aria-label="调整日期列宽"
                        aria-orientation="vertical"
                        onPointerDown={(event) =>
                          resizeColumn(event, "dateWidth")
                        }
                      />
                    </span>
                  )}
                  {view.hash && (
                    <span>
                      哈希
                      <span
                        role="separator"
                        aria-label="调整哈希列宽"
                        aria-orientation="vertical"
                        onPointerDown={(event) =>
                          resizeColumn(event, "hashWidth")
                        }
                      />
                    </span>
                  )}
                </div>
              )}
              <div aria-hidden="true" style={{ height: start * ROW }} />
              {model.items.slice(start, end).map((item, offset) => {
                const i = start + offset,
                  commit = item.commit,
                  graph = model.graph[i],
                  collapsed = item.hidden.length > 0;
                const mine =
                  !!s.identity.email &&
                  commit.email.toLowerCase() === s.identity.email.toLowerCase();
                const byOther =
                  !!commit.committerEmail &&
                  commit.committerEmail !== commit.email;
                const labels = commit.refs ? (
                  <RefLabels
                    commit={commit}
                    tagNames={view.tagNames}
                    remotes={s.remotes.map((remote) => remote.name)}
                  />
                ) : null;
                return (
                  <div
                    id={`commit-${commit.hash}`}
                    key={item.id}
                    role="option"
                    aria-selected={selected === commit.hash}
                    aria-posinset={i + 1}
                    aria-setsize={model.items.length}
                    aria-label={
                      collapsed
                        ? `${item.hidden.length} 条折叠提交，点击展开`
                        : `${commit.subject}，${commit.author}，${logDate(view.commitTimestamp ? commit.commitDate || commit.date : commit.date)}`
                    }
                    className={`log-row idea-log-row ${selected === commit.hash ? "selected" : ""} ${view.highlightMine && mine ? "my-commit" : ""} ${view.highlightMerges && commit.parents.length > 1 ? "merge-commit" : ""} ${collapsed ? "collapsed-log-row" : ""}`}
                    onClick={() => {
                      if (collapsed)
                        setExpanded(
                          (current) => new Set([...current, item.id]),
                        );
                      else select(commit.hash);
                      scroll.current?.focus({ preventScroll: true });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openContext(commit, event.clientX, event.clientY);
                    }}
                  >
                    <div className="commit-subject">
                      <svg
                        className="commit-graph"
                        width={width}
                        height={ROW}
                        aria-hidden="true"
                      >
                        {graph.lines.map((line, j) => {
                          if (!view.longEdges && !line.start && !line.end)
                            return null;
                          const target = line.targetHash
                            ? model.hashToRow.get(line.targetHash)
                            : undefined;
                          const stub =
                            line.boundary ||
                            (!view.longEdges && line.start && target !== i + 1);
                          const incomingGap =
                            !view.longEdges &&
                            line.end &&
                            !model.graph[i - 1]?.lines.some(
                              (edge) =>
                                edge.start && edge.targetHash === commit.hash,
                            );
                          const missingIndex = line.boundary
                            ? graph.lines
                                .slice(0, j)
                                .filter((edge) => edge.boundary).length
                            : 0;
                          const x1 = line.from * 16 + 14,
                            x2 = stub
                              ? x1 + missingIndex * 6
                              : line.to * 16 + 14;
                          const y1 = line.start ? ROW / 2 : incomingGap ? 7 : 0,
                            y2 = stub ? ROW - 5 : line.end ? ROW / 2 : ROW;
                          const path =
                            x1 === x2
                              ? `M${x1} ${y1}V${y2}`
                              : `M${x1} ${y1}C${x1} ${ROW / 2} ${x2} ${ROW / 2} ${x2} ${y2}`;
                          return (
                            <g
                              key={j}
                              className={
                                line.start && line.targetHash
                                  ? "log-edge-link"
                                  : undefined
                              }
                              onClick={
                                line.start && line.targetHash
                                  ? (event) => {
                                      event.stopPropagation();
                                      void navigate(line.targetHash!);
                                    }
                                  : undefined
                              }
                            >
                              {line.targetHash && (
                                <title>
                                  {line.start
                                    ? `转到父提交 ${line.targetHash.slice(0, 8)}`
                                    : "提交图连接"}
                                </title>
                              )}
                              <path
                                d={path}
                                stroke={line.color}
                                strokeWidth="1.8"
                                fill="none"
                                strokeDasharray={
                                  collapsed || line.dashed || incomingGap
                                    ? "3 3"
                                    : undefined
                                }
                              />
                              {stub && (
                                <path
                                  d={`M${x2 - 3} ${y2 - 3}L${x2} ${y2}L${x2 + 3} ${y2 - 3}`}
                                  stroke={line.color}
                                  fill="none"
                                  strokeWidth="1.5"
                                />
                              )}
                              {incomingGap && (
                                <path
                                  d={`M${x1 - 3} ${y1 + 3}L${x1} ${y1}L${x1 + 3} ${y1 + 3}`}
                                  stroke={line.color}
                                  fill="none"
                                  strokeWidth="1.5"
                                />
                              )}
                              {line.start && line.targetHash && (
                                <path
                                  d={path}
                                  stroke="transparent"
                                  strokeWidth="8"
                                  fill="none"
                                />
                              )}
                            </g>
                          );
                        })}
                        <circle
                          cx={graph.lane * 16 + 14}
                          cy={ROW / 2}
                          r={collapsed ? 2.5 : 3.5}
                          fill={
                            commit.refs.includes("HEAD")
                              ? "var(--surface)"
                              : graph.color
                          }
                          stroke={graph.color}
                          strokeWidth="1.6"
                        />
                      </svg>
                      {view.refsLeft && labels}
                      <span
                        className="truncate log-subject-text"
                        title={
                          collapsed
                            ? `展开 ${item.hidden.length} 条线性提交`
                            : `${commit.subject}\n${commit.hash}`
                        }
                      >
                        {collapsed ? (
                          <>
                            <ChevronDown size={12} />
                            {item.hidden.length} 条线性提交
                          </>
                        ) : (
                          <Subject
                            text={commit.subject}
                            query={filters.search}
                            matchCase={filters.matchCase}
                            regex={filters.regex}
                          />
                        )}
                      </span>
                      {!view.refsLeft && labels}
                    </div>
                    {view.author && (
                      <span
                        className="log-author truncate"
                        title={`${commit.author} <${commit.email}>${byOther ? `\n提交者：${commit.committer} <${commit.committerEmail}>` : ""}`}
                      >
                        {collapsed ? (
                          ""
                        ) : (
                          <>
                            {commit.author}
                            {byOther && <sup>*</sup>}
                          </>
                        )}
                      </span>
                    )}
                    {view.date && (
                      <span
                        className="log-date truncate"
                        title={`${view.commitTimestamp ? "提交者时间" : "作者时间"}：${view.commitTimestamp ? commit.commitDate || commit.date : commit.date}`}
                      >
                        {collapsed
                          ? ""
                          : logDate(
                              view.commitTimestamp
                                ? commit.commitDate || commit.date
                                : commit.date,
                            )}
                      </span>
                    )}
                    {view.hash && (
                      <span className="log-hash mono">
                        {collapsed ? "" : commit.hash.slice(0, 8)}
                      </span>
                    )}
                  </div>
                );
              })}
              <div
                aria-hidden="true"
                style={{ height: (model.items.length - end) * ROW }}
              />
            </div>
            {s.hasMore && (
              <button
                className="load-more"
                disabled={loading}
                onClick={() =>
                  change({
                    limit: Math.min(
                      LOG_MAX_COUNT,
                      filters.limit + LOG_PAGE_SIZE,
                    ),
                  })
                }
              >
                {loading ? (
                  <>
                    <Spinner />
                    加载中…
                  </>
                ) : (
                  "加载更多提交"
                )}
              </button>
            )}
            {!s.hasMore && commits.length >= LOG_MAX_COUNT && (
              <div className="group-empty">
                已显示 {LOG_MAX_COUNT.toLocaleString()}{" "}
                条提交，请按分支、日期或路径缩小范围。
              </div>
            )}
          </>
        )}
      </div>
      {menu && contextCommit && (
        <>
          <span
            ref={contextAnchor}
            className="log-context-anchor"
            style={{ top: menu.y, left: menu.x }}
          />
          <LogPopup
            anchor={contextAnchor}
            title="日志提交操作"
            onClose={() => setMenu(null)}
            menu
          >
            <button
              role="menuitem"
              onClick={() => copy(contextCommit.hash, "提交哈希")}
            >
              <Copy size={13} />
              复制提交哈希
            </button>
            <button
              role="menuitem"
              onClick={() =>
                copy(
                  [contextCommit.subject, contextCommit.body]
                    .filter(Boolean)
                    .join("\n\n"),
                  "提交消息",
                )
              }
            >
              复制提交消息
            </button>
            <div className="menu-divider" />
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                createBranch(contextCommit.hash);
              }}
            >
              从此提交新建分支…
            </button>
            <button
              role="menuitem"
              onClick={() => contextAction("tag", contextCommit)}
            >
              新建标签…
            </button>
            <div className="menu-divider" />
            <button
              role="menuitem"
              disabled={busy || !!s?.operation}
              onClick={() => contextAction("cherry-pick", contextCommit)}
            >
              拣选此提交…
            </button>
            <button
              role="menuitem"
              disabled={busy || !!s?.operation}
              onClick={() => contextAction("revert", contextCommit)}
            >
              还原此提交…
            </button>
            <button
              role="menuitem"
              disabled={busy || !!s?.operation}
              onClick={() => contextAction("reset", contextCommit)}
            >
              重置当前分支到此处…
            </button>
            {!!contextCommit.parents.length && (
              <>
                <div className="menu-divider" />
                {contextCommit.parents.map((hash, i) => (
                  <button
                    role="menuitem"
                    key={hash}
                    onClick={() => {
                      setMenu(null);
                      void navigate(hash);
                    }}
                  >
                    转到父提交 {contextCommit.parents.length > 1 ? i + 1 : ""} ·{" "}
                    {hash.slice(0, 8)}
                  </button>
                ))}
              </>
            )}
          </LogPopup>
        </>
      )}
    </section>
  );
}
