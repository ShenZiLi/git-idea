import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import type { SearchMatch, SearchResult } from "../editor-search.worker";
import { IconButton } from "./ui";

export interface SearchSelection {
  matches: SearchMatch[];
  active: number;
}
export function EditorSearch({
  text,
  writable,
  expanded,
  focusVersion,
  onExpand,
  onClose,
  onSelect,
  onChange,
}: {
  text: string;
  writable: boolean;
  expanded: boolean;
  focusVersion: number;
  onExpand: (expanded: boolean) => void;
  onClose: () => void;
  onSelect: (selection: SearchSelection) => void;
  onChange: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<SearchResult>({ matches: [] });
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const select = useRef(onSelect);
  const current = useRef(0);
  select.current = onSelect;
  current.current = active;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusVersion]);
  useEffect(() => {
    setPending(!!query);
    setResult({ matches: [] });
    select.current({ matches: [], active: 0 });
    if (!query) return;
    const worker = new Worker(
      new URL("../editor-search.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = window.setTimeout(() => {
      worker.terminate();
      setPending(false);
      setResult({ matches: [], error: "查找耗时过长，请简化正则表达式" });
    }, 1500);
    worker.onmessage = ({ data }: MessageEvent<SearchResult>) => {
      clearTimeout(timeout);
      worker.terminate();
      setPending(false);
      setResult(data);
      const next = Math.min(
        current.current,
        Math.max(0, data.matches.length - 1),
      );
      setActive(next);
      select.current({ matches: data.matches, active: next });
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      setPending(false);
      setResult({ matches: [], error: "查找失败，请重新输入" });
    };
    worker.postMessage({
      text,
      query,
      replacement,
      caseSensitive,
      wholeWord,
      regex,
    });
    return () => {
      clearTimeout(timeout);
      worker.terminate();
    };
  }, [text, query, replacement, caseSensitive, wholeWord, regex]);

  const navigate = (direction: number) => {
    if (!result.matches.length || pending) return;
    const next =
      (active + direction + result.matches.length) % result.matches.length;
    setActive(next);
    onSelect({ matches: result.matches, active: next });
  };
  const replace = (all: boolean) => {
    if (!writable || pending || !result.matches.length) return;
    const matches = all ? result.matches : [result.matches[active]];
    let output = "",
      cursor = 0;
    for (const match of matches) {
      output += text.slice(cursor, match.start) + match.replacement;
      cursor = match.end;
    }
    onChange(output + text.slice(cursor));
  };

  return (
    <div
      className="editor-find"
      role="search"
      aria-label="文件内查找与替换"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="editor-find-row">
        <IconButton
          title={expanded ? "收起替换" : "展开替换"}
          aria-expanded={expanded}
          onClick={() => onExpand(!expanded)}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </IconButton>
        <div className="editor-find-input input-shell">
          <Search size={15} />
          <input
            ref={input}
            aria-label="查找文本"
            placeholder="搜索"
            value={query}
            aria-invalid={!!result.error}
            onChange={(event) => {
              setActive(0);
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                navigate(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <IconButton
            title="区分大小写"
            active={caseSensitive}
            onClick={() => setCaseSensitive(!caseSensitive)}
          >
            Cc
          </IconButton>
          <IconButton
            title="全字匹配"
            active={wholeWord}
            onClick={() => setWholeWord(!wholeWord)}
          >
            W
          </IconButton>
          <IconButton
            title="正则表达式"
            active={regex}
            onClick={() => setRegex(!regex)}
          >
            .*
          </IconButton>
        </div>
        <span className="editor-find-count" role="status">
          {pending
            ? "查找中…"
            : result.matches.length
              ? `${active + 1} / ${result.matches.length}${result.limited ? "+" : ""}`
              : "0 个结果"}
        </span>
        <IconButton
          title="上一个匹配（Shift+Enter）"
          disabled={pending || !result.matches.length}
          onClick={() => navigate(-1)}
        >
          <ArrowUp size={15} />
        </IconButton>
        <IconButton
          title="下一个匹配（Enter）"
          disabled={pending || !result.matches.length}
          onClick={() => navigate(1)}
        >
          <ArrowDown size={15} />
        </IconButton>
        <span className="spacer" />
        <IconButton title="关闭查找（Esc）" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      {expanded && (
        <div className="editor-find-row editor-replace-row">
          <div className="editor-find-input input-shell">
            <Search size={15} />
            <input
              aria-label="替换为"
              placeholder="替换为"
              value={replacement}
              disabled={!writable}
              onChange={(event) => setReplacement(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  replace(false);
                }
              }}
            />
          </div>
          <button
            className="small"
            disabled={!writable || pending || !result.matches.length}
            onClick={() => replace(false)}
          >
            替换
          </button>
          <button
            className="small"
            disabled={
              !writable || pending || !result.matches.length || result.limited
            }
            onClick={() => replace(true)}
          >
            全部替换
          </button>
          {!writable && <span className="muted">此版本只读</span>}
        </div>
      )}
      {result.error && (
        <div className="editor-find-error error-text" role="alert">
          {result.error}
        </div>
      )}
      {result.limited && (
        <div className="editor-find-error muted">
          仅显示前 20,000 个匹配，请缩小查找范围后全部替换。
        </div>
      )}
    </div>
  );
}
