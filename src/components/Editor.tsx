import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FileCode2,
  GitCompareArrows,
  Search,
  WrapText,
  X,
} from "lucide-react";
import type { DiffData } from "../../shared/types";
import { request } from "../api";
import { diffRows } from "../diff";
import { lineChanges, type LineChange } from "../../shared/line-changes";
import { useFileAutosave } from "../useFileAutosave";
import { EditorSearch, type SearchSelection } from "./EditorSearch";
import { Empty, FileIcon, IconButton, Spinner } from "./ui";

export interface EditorTab {
  id: string;
  path: string;
  kind: "file" | "diff";
  staged?: boolean;
  commit?: string;
  oldPath?: string;
}
interface DisplayLine {
  text: string;
  oldNumber?: number;
  newNumber?: number;
  kind: "same" | "added" | "removed";
}
interface MarkRange {
  start: number;
  end: number;
  active: boolean;
}
const normalizeLines = (text: string) => text.replaceAll("\r\n", "\n");
function Highlight({ text }: { text: string }) {
  const parts = text.split(
    /(\/\/.*$|#[^#].*$|"[^"\n]*"|'[^'\n]*'|\b(?:const|let|export|import|from|return|async|await|function|interface|type|if|else|true|false|null|class|new)\b|\b\d+(?:\.\d+)?\b)/g,
  );
  return (
    <>
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            /^['"]/.test(part)
              ? "syntax-string"
              : /^(\/\/|#)/.test(part)
                ? "syntax-comment"
                : /^\d/.test(part)
                  ? "syntax-number"
                  : /^(const|let|export|import|from|return|async|await|function|interface|type|if|else|true|false|null|class|new)$/.test(
                        part,
                      )
                    ? "syntax-keyword"
                    : undefined
          }
        >
          {part}
        </span>
      ))}
    </>
  );
}
function LineMarker({ change }: { change?: LineChange }) {
  if (
    !change ||
    (!change.kind && !change.deletedBefore && !change.deletedAfter)
  )
    return null;
  const label = [
    change.kind === "add"
      ? "新增"
      : change.kind === "change"
        ? "修改"
        : change.kind === "format"
          ? "仅格式变化，不提交 Git"
          : "",
    change.deletedBefore ? `此处之前删除 ${change.deletedBefore} 行` : "",
    change.deletedAfter ? `此处之后删除 ${change.deletedAfter} 行` : "",
  ]
    .filter(Boolean)
    .join("；");
  return (
    <span
      className={`line-change-mark ${change.kind || ""}`}
      title={label}
      role="img"
      aria-label={label}
      data-deleted-before={change.deletedBefore || undefined}
      data-deleted-after={change.deletedAfter || undefined}
    />
  );
}

function MarkedCode({
  text,
  ranges = [],
}: {
  text: string;
  ranges?: MarkRange[];
}) {
  let cursor = 0;
  const parts: React.ReactNode[] = [];
  ranges.forEach((range, i) => {
    parts.push(
      <Highlight key={`text-${i}`} text={text.slice(cursor, range.start)} />,
    );
    parts.push(
      <mark key={`match-${i}`} className={range.active ? "active-match" : ""}>
        <Highlight text={text.slice(range.start, range.end) || "\u200b"} />
      </mark>,
    );
    cursor = range.end;
  });
  parts.push(<Highlight key="tail" text={text.slice(cursor)} />);
  return <>{parts}</>;
}
export function Editor({
  repo,
  tab,
  tabs,
  active,
  onSelect,
  onClose,
  onCloseAll,
  version,
  onSaved,
  onDirty,
  flushRef,
  notify,
  confirm,
  welcome,
}: {
  repo: string;
  tab?: EditorTab;
  tabs: EditorTab[];
  active: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  version: number;
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
  flushRef: RefObject<(() => Promise<boolean>) | null>;
  notify: (message: string, error?: boolean) => void;
  welcome: React.ReactNode;
  confirm: (
    title: string,
    message: string,
    action: () => Promise<unknown>,
  ) => void;
}) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [wrap, setWrap] = useState(false),
    [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [findOpen, setFindOpen] = useState(false),
    [replaceOpen, setReplaceOpen] = useState(false);
  const [findFocus, setFindFocus] = useState(0);
  const [selection, setSelection] = useState<SearchSelection>({
    matches: [],
    active: 0,
  });
  const [showAll, setShowAll] = useState(false);
  const autosave = useFileAutosave(onSaved);
  const { draft, dirty, saving } = autosave;
  const loadedTab = useRef("");
  const edit =
    !!tab &&
    loadedTab.current === `${repo}:${tab.id}` &&
    !tab.commit &&
    !tab.staged &&
    !!data &&
    !data.binary &&
    !data.truncated &&
    !data.readOnly &&
    !loading &&
    !error;
  const panel = useRef<HTMLElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null),
    mirror = useRef<HTMLDivElement>(null);
  const code = useRef<HTMLDivElement>(null),
    readScroll = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  useLayoutEffect(() => {
    onDirty(dirty || saving);
  }, [dirty, saving, onDirty]);
  useLayoutEffect(() => {
    flushRef.current = autosave.flush;
    return () => {
      flushRef.current = null;
    };
  }, [flushRef, autosave.flush]);
  useEffect(() => {
    if (!tab || !repo) {
      setData(null);
      setLoading(false);
      autosave.load("", "", "", false);
      loadedTab.current = "";
      return;
    }
    if (autosave.isDirty()) return;
    let current = true;
    const context = `${repo}:${tab.id}`;
    const changing = loadedTab.current !== context;
    if (changing) {
      setLoading(true);
      setData(null);
      setShowAll(false);
      setSelection({ matches: [], active: 0 });
    }
    setError("");
    const revision = autosave.getRevision();
    const query =
      tab.kind === "diff"
        ? request<DiffData>("diff", repo, {
            path: tab.path,
            staged: tab.staged,
            commit: tab.commit,
            oldPath: tab.oldPath,
          })
        : request<{
            text: string;
            binary: boolean;
            truncated: boolean;
            baseline?: string;
          }>("file", repo, { path: tab.path, baseline: true }).then(
            (file) =>
              ({
                path: tab.path,
                before: file.baseline ?? "",
                after: file.text,
                raw: "",
                binary: file.binary,
                truncated: file.truncated,
                baselineAvailable: file.baseline !== undefined,
                beforeLabel: "HEAD",
                afterLabel: "工作区",
              }) as DiffData,
          );
    query
      .then((value) => {
        if (
          !current ||
          autosave.isDirty() ||
          revision !== autosave.getRevision()
        )
          return;
        loadedTab.current = context;
        setData(value);
        autosave.load(
          repo,
          tab.path,
          value.after,
          !tab.commit &&
            !tab.staged &&
            !value.binary &&
            !value.truncated &&
            !value.readOnly,
        );
      })
      .catch((cause) => {
        if (current && !autosave.isDirty()) setError(cause.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [
    repo,
    tab?.id,
    version,
    autosave.load,
    autosave.isDirty,
    autosave.getRevision,
  ]);

  const draftLines = useMemo(() => draft.split("\n"), [draft]);
  const changes = useMemo(
    () =>
      data &&
      data.baselineAvailable !== false &&
      !data.binary &&
      !data.truncated
        ? lineChanges(data.before, edit ? draft : data.after).markers
        : [],
    [data, edit, draft],
  );
  const displayLines = useMemo<DisplayLine[]>(() => {
    if (!data) return [];
    if (tab?.kind !== "diff")
      return normalizeLines(data.after)
        .split("\n")
        .map((text, i) => ({ text, newNumber: i + 1, kind: "same" }));
    const rows = diffRows(data.before, data.after, ignoreWhitespace);
    const lines: DisplayLine[] = [];
    // Keep removed and added blocks together in the single-column diff.
    for (let i = 0; i < rows.length;) {
      const row = rows[i];
      if (row.kind === "same") {
        lines.push({
          text: row.after ?? "",
          oldNumber: row.oldNumber,
          newNumber: row.newNumber,
          kind: "same",
        });
        i++;
        continue;
      }
      let end = i + 1;
      while (end < rows.length && rows[end].kind !== "same") end++;
      for (const changed of rows.slice(i, end))
        if (changed.before !== undefined)
          lines.push({
            text: changed.before,
            oldNumber: changed.oldNumber,
            kind: "removed",
          });
      for (const changed of rows.slice(i, end))
        if (changed.after !== undefined)
          lines.push({
            text: changed.after,
            newNumber: changed.newNumber,
            kind: "added",
          });
      i = end;
    }
    return lines;
  }, [data, tab?.kind, ignoreWhitespace]);
  const visibleText = useMemo(
    () => (edit ? draft : displayLines.map((line) => line.text).join("\n")),
    [edit, draft, displayLines],
  );
  const searchRanges = useMemo(() => {
    const lines = visibleText.split("\n"),
      ranges: MarkRange[][] = lines.map(() => []);
    let line = 0,
      offset = 0;
    selection.matches.forEach((match, index) => {
      while (
        line < lines.length - 1 &&
        offset + lines[line].length < match.start
      )
        offset += lines[line++].length + 1;
      let next = line,
        start = offset;
      while (next < lines.length && start <= match.end) {
        const end = start + lines[next].length;
        if (match.start <= end && match.end >= start)
          ranges[next].push({
            start: Math.max(0, match.start - start),
            end: Math.min(lines[next].length, match.end - start),
            active: selection.active === index,
          });
        if (match.end <= end) break;
        start = end + 1;
        next++;
      }
    });
    return ranges;
  }, [visibleText, selection]);

  const syncScroll = () => {
    const input = textarea.current;
    if (!input) return;
    if (gutter.current) gutter.current.scrollTop = input.scrollTop;
    if (code.current) {
      code.current.style.width = wrap
        ? `${input.clientWidth}px`
        : "max-content";
      code.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    }
  };
  useLayoutEffect(syncScroll, [wrap, edit, loading, draft]);
  useLayoutEffect(() => {
    if (!edit || !wrap || !textarea.current || !mirror.current) return;
    const input = textarea.current,
      measure = mirror.current;
    const update = () => {
      measure.style.width = `${input.clientWidth}px`;
      const heights = Array.from(
        measure.children,
        (line) => line.getBoundingClientRect().height,
      );
      setLineHeights((current) =>
        current.length === heights.length &&
        current.every((height, i) => height === heights[i])
          ? current
          : heights,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(input);
    Array.from(measure.children).forEach((line) => observer.observe(line));
    update();
    return () => observer.disconnect();
  }, [draftLines, edit, wrap, loading]);

  const reveal = (next: SearchSelection) => {
    setSelection(next);
    const match = next.matches[next.active];
    if (!match) return;
    const line = visibleText.slice(0, match.start).split("\n").length - 1;
    if (edit && textarea.current) {
      const input = textarea.current;
      input.setSelectionRange(match.start, match.end);
      const top = wrap
        ? lineHeights.slice(0, line).reduce((sum, height) => sum + height, 0)
        : line * 22;
      input.scrollTop = Math.max(0, top - input.clientHeight / 2 + 22);
      if (!wrap) {
        const lineStart = visibleText.lastIndexOf("\n", match.start - 1) + 1;
        const prefix = visibleText.slice(lineStart, match.start);
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d");
        if (ctx) {
          const style = getComputedStyle(input);
          ctx.font = `${style.fontSize} ${style.fontFamily}`;
          input.scrollLeft = Math.max(
            0,
            ctx.measureText(prefix.replaceAll("\t", "  ")).width -
              input.clientWidth / 2,
          );
        }
      }
      syncScroll();
    } else {
      setShowAll(true);
      requestAnimationFrame(() =>
        readScroll.current
          ?.querySelectorAll(".code-line")
          [line]?.scrollIntoView({ block: "center", inline: "nearest" }),
      );
    }
  };
  const closeSearch = () => {
    setFindOpen(false);
    setSelection({ matches: [], active: 0 });
    (textarea.current ?? readScroll.current)?.focus();
  };
  const replaceText = (text: string) => {
    const input = textarea.current;
    if (!input || text === draft) return;
    // Insert through the native editor so replace remains one undoable operation.
    let start = 0,
      end = draft.length,
      replacementEnd = text.length;
    while (
      start < end &&
      start < replacementEnd &&
      draft[start] === text[start]
    )
      start++;
    while (
      end > start &&
      replacementEnd > start &&
      draft[end - 1] === text[replacementEnd - 1]
    ) {
      end--;
      replacementEnd--;
    }
    const focused = document.activeElement as HTMLElement | null;
    input.focus({ preventScroll: true });
    input.setSelectionRange(start, end);
    document.execCommand(
      "insertText",
      false,
      text.slice(start, replacementEnd),
    );
    autosave.change(text);
    focused?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        !tab ||
        !data ||
        data.binary ||
        error ||
        loading ||
        document.querySelector('[role="dialog"]')
      )
        return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input,textarea,[contenteditable=true]") &&
        !panel.current?.contains(target)
      )
        return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "f" || key === "h") {
        event.preventDefault();
        setFindOpen(true);
        setReplaceOpen(key === "h");
        setFindFocus((value) => value + 1);
      } else if (key === "s" && edit) {
        event.preventDefault();
        void autosave.flush();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [tab?.id, data, error, loading, edit, autosave.flush]);
  const jump = (direction: number) => {
    if (edit && textarea.current) {
      const input = textarea.current,
        current = draft.slice(0, input.selectionStart).split("\n").length - 1;
      const lines = changes.flatMap((change, i) =>
        change.kind || change.deletedBefore || change.deletedAfter ? [i] : [],
      );
      const next =
        direction > 0
          ? (lines.find((line) => line > current) ?? lines[0])
          : ([...lines].reverse().find((line) => line < current) ??
            lines.at(-1));
      if (next !== undefined) {
        const start = draftLines
          .slice(0, next)
          .reduce((sum, line) => sum + line.length + 1, 0);
        reveal({
          matches: [{ start, end: start, replacement: "" }],
          active: 0,
        });
        setSelection({ matches: [], active: 0 });
        input.focus();
      }
    } else {
      const lines = Array.from(
        readScroll.current?.querySelectorAll<HTMLElement>(".code-line") ?? [],
      );
      const changes = lines.filter(
        (line) =>
          line.classList.contains("added") ||
          line.classList.contains("removed"),
      );
      const top = readScroll.current?.getBoundingClientRect().top ?? 0;
      const next =
        direction > 0
          ? (changes.find(
              (line) => line.getBoundingClientRect().top > top + 24,
            ) ?? changes[0])
          : ([...changes]
              .reverse()
              .find((line) => line.getBoundingClientRect().top < top - 1) ??
            changes.at(-1));
      next?.scrollIntoView({ block: "start", inline: "nearest" });
    }
  };

  return (
    <section ref={panel} className="editor-panel panel">
      <div className="editor-tabs">
        {tabs.map((item) => (
          <div
            className={`editor-tab ${active === item.id ? "active" : ""}`}
            key={item.id}
          >
            <button title={item.path} onClick={() => onSelect(item.id)}>
              <FileIcon name={item.path} />
              <span>{item.path.split("/").at(-1)}</span>
              {item.id === tab?.id && dirty && (
                <span
                  className="editor-dirty"
                  aria-label="正在等待自动保存"
                  title="正在等待自动保存"
                >
                  ●
                </span>
              )}
              {item.kind === "diff" && (
                <GitCompareArrows size={12} className="muted" />
              )}
              {item.commit && (
                <span className="tiny muted">{item.commit.slice(0, 7)}</span>
              )}
              {item.staged && <span className="tiny muted">暂存</span>}
            </button>
            <IconButton
              title={`关闭 ${item.path.split("/").at(-1)}`}
              onClick={() => onClose(item.id)}
            >
              <X size={12} />
            </IconButton>
          </div>
        ))}
        <div className="editor-tabs-fill" />
        <IconButton
          title="关闭所有标签"
          disabled={!tabs.length}
          onClick={onCloseAll}
        >
          <X size={14} />
        </IconButton>
      </div>
      {!tab ? (
        welcome
      ) : (
        <>
          <div className="editor-toolbar">
            <span className="truncate editor-path" title={tab.path}>
              {tab.path.split("/").join(" / ")}
            </span>
            {edit && (
              <span className="editor-save-status muted" role="status">
                {autosave.error
                  ? "保存失败"
                  : saving
                    ? "正在保存…"
                    : dirty
                      ? "等待保存…"
                      : "已自动保存"}
              </span>
            )}
            {!edit && data && !data.binary && (
              <span className="editor-save-status muted">只读</span>
            )}
            {tab.kind === "diff" && (
              <>
                <IconButton title="上一个差异" onClick={() => jump(-1)}>
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton title="下一个差异" onClick={() => jump(1)}>
                  <ArrowDown size={14} />
                </IconButton>
                {!edit && (
                  <label className="checkbox-label editor-whitespace">
                    <input
                      type="checkbox"
                      checked={ignoreWhitespace}
                      onChange={(event) =>
                        setIgnoreWhitespace(event.target.checked)
                      }
                    />
                    忽略空白
                  </label>
                )}
              </>
            )}
            <IconButton
              title="查找（Ctrl+F）"
              disabled={!data || data.binary || loading}
              active={findOpen}
              onClick={() => {
                setFindOpen(!findOpen);
                if (findOpen) closeSearch();
                else setFindFocus((value) => value + 1);
              }}
            >
              <Search size={14} />
            </IconButton>
            <IconButton
              title="自动换行"
              active={wrap}
              onClick={() => setWrap(!wrap)}
            >
              <WrapText size={15} />
            </IconButton>
            <IconButton
              title="复制文件内容"
              disabled={!data}
              onClick={() => {
                navigator.clipboard
                  .writeText(edit ? draft : data?.after || "")
                  .then(() => notify("已复制文件内容"))
                  .catch(() => notify("复制失败，请使用系统复制快捷键", true));
              }}
            >
              <Copy size={14} />
            </IconButton>
          </div>
          {autosave.error && edit && (
            <div className="editor-save-error" role="alert">
              <span>
                自动保存失败：{autosave.error}
                。草稿仍保留在当前标签，可先复制内容再重新载入。
              </span>
              <button
                className="small"
                disabled={saving}
                onClick={() => void autosave.flush()}
              >
                重试
              </button>
              <button
                className="small"
                disabled={saving}
                onClick={() =>
                  confirm(
                    "重新载入文件",
                    "将丢弃当前未保存的草稿，并读取磁盘上的最新内容。请先复制需要保留的内容。",
                    async () => {
                      try {
                        const file = await request<{
                          text: string;
                          binary: boolean;
                          truncated: boolean;
                        }>("file", repo, { path: tab.path });
                        setData((current) =>
                          current
                            ? {
                                ...current,
                                after: file.text,
                                binary: file.binary,
                                truncated: file.truncated,
                              }
                            : current,
                        );
                        autosave.load(
                          repo,
                          tab.path,
                          file.text,
                          !file.binary && !file.truncated,
                        );
                      } catch (cause) {
                        notify((cause as Error).message, true);
                      }
                    },
                  )
                }
              >
                重新载入
              </button>
            </div>
          )}
          {findOpen && data && !data.binary && !loading && !error && (
            <EditorSearch
              key={`${repo}:${tab.id}`}
              text={visibleText}
              writable={edit}
              expanded={replaceOpen}
              focusVersion={findFocus}
              onExpand={setReplaceOpen}
              onClose={closeSearch}
              onSelect={reveal}
              onChange={replaceText}
            />
          )}
          {loading ? (
            <div className="editor-loading">
              <Spinner />
              读取文件…
            </div>
          ) : error ? (
            <Empty title="无法显示文件">
              <span className="error-text">{error}</span>
            </Empty>
          ) : data?.binary ? (
            <Empty icon={<FileCode2 size={30} />} title="二进制文件">
              <span>此文件无法显示文本差异</span>
            </Empty>
          ) : edit ? (
            <div className="edit-area">
              <div className={`edit-body ${wrap ? "wrap-code" : ""}`}>
                <div
                  ref={gutter}
                  className="edit-line-numbers"
                  aria-label="行号与改动标记"
                >
                  {draftLines.map((_, i) => (
                    <div
                      key={i}
                      className="edit-line-number"
                      style={{ height: wrap ? lineHeights[i] || 22 : 22 }}
                    >
                      {i + 1}
                      <LineMarker change={changes[i]} />
                    </div>
                  ))}
                </div>
                {wrap && (
                  <div
                    ref={mirror}
                    className="edit-line-mirror"
                    aria-hidden="true"
                  >
                    {draftLines.map((line, i) => (
                      <div key={i}>{line || "\u200b"}</div>
                    ))}
                  </div>
                )}
                <div className="edit-code-surface">
                  <div className="edit-highlight" aria-hidden="true">
                    <div ref={code} className="edit-highlight-lines">
                      {draftLines.map((line, i) => (
                        <div key={i}>
                          <MarkedCode text={line} ranges={searchRanges[i]} />
                          {!line && "\u200b"}
                        </div>
                      ))}
                    </div>
                  </div>
                  <textarea
                    ref={textarea}
                    aria-label="文件内容"
                    aria-description="修改后自动保存；Ctrl+F 查找，Ctrl+H 替换"
                    wrap={wrap ? "soft" : "off"}
                    spellCheck={false}
                    value={draft}
                    onScroll={syncScroll}
                    onBlur={() => void autosave.flush()}
                    onCompositionStart={() => {
                      autosave.composing.current = true;
                    }}
                    onCompositionEnd={(event) => {
                      autosave.composing.current = false;
                      autosave.change(event.currentTarget.value);
                      void autosave.flush();
                    }}
                    onChange={(event) => autosave.change(event.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <>
              {tab.kind === "diff" && (
                <div className="diff-labels">
                  <span>
                    <span className="diff-dot old" />
                    {data?.beforeLabel}
                    <small>原始版本</small>
                  </span>
                  <span>
                    <span className="diff-dot new" />
                    {data?.afterLabel}
                    <small>{tab.commit ? "提交版本" : "修改后的内容"}</small>
                  </span>
                </div>
              )}
              <div
                ref={readScroll}
                tabIndex={0}
                aria-label="只读文件内容"
                className={`code-scroll ${wrap ? "wrap-code" : ""}`}
              >
                {data?.truncated && (
                  <div className="inline-warning">
                    文件超过 2 MB，内容已限制。请使用外部编辑器处理完整文件。
                  </div>
                )}
                {displayLines.length ? (
                  <div
                    className={
                      tab.kind === "diff"
                        ? "diff-content unified"
                        : "code-document"
                    }
                  >
                    {displayLines
                      .slice(0, showAll ? undefined : 3000)
                      .map((line, i) => (
                        <div key={i} className={`code-line ${line.kind}`}>
                          {tab.kind === "diff" && (
                            <span className="line-number">
                              {line.oldNumber}
                            </span>
                          )}
                          <span className="line-number">
                            {line.newNumber}
                            {tab.kind === "file" && (
                              <LineMarker change={changes[i]} />
                            )}
                          </span>
                          {tab.kind === "diff" && (
                            <span className="diff-sign">
                              {line.kind === "added"
                                ? "+"
                                : line.kind === "removed"
                                  ? "−"
                                  : " "}
                            </span>
                          )}
                          <code>
                            <MarkedCode
                              text={line.text}
                              ranges={searchRanges[i]}
                            />
                          </code>
                        </div>
                      ))}
                  </div>
                ) : (
                  <Empty icon={<Check size={26} />} title="内容相同" />
                )}
                {!showAll && displayLines.length > 3000 && (
                  <button
                    className="load-more"
                    onClick={() => setShowAll(true)}
                  >
                    显示全部行
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
