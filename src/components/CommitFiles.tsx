import { useMemo, useState, type Ref } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  RotateCcw,
  Search,
} from "lucide-react";
import type { Change } from "../../shared/types";
import { Modal } from "./Dialogs";
import { Empty, FileIcon, IconButton } from "./ui";

export const isStaged = (c: Change) =>
  c.index !== " " && c.index !== "?" && !c.conflict;
export const isUnstaged = (c: Change) => c.worktree !== " " || c.conflict;

export function StageCheckbox({
  label,
  checked,
  mixed = false,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      title={label}
      checked={checked}
      aria-checked={mixed ? "mixed" : checked}
      ref={(node) => {
        if (node) node.indeterminate = mixed;
      }}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function ChangeFileRow({
  change: c,
  busy,
  selected,
  onSelect,
  onStage,
  onDiff,
  onDiscard,
  onResolve,
  rowRef,
}: {
  change: Change;
  busy: boolean;
  selected: boolean;
  onSelect: () => void;
  onStage: (stage: boolean) => void;
  onDiff: (staged: boolean) => void;
  onDiscard: () => void;
  onResolve: () => void;
  rowRef?: Ref<HTMLDivElement>;
}) {
  const staged = isStaged(c),
    working = isUnstaged(c),
    partial = staged && working;
  const status = c.conflict
    ? "conflicted"
    : c.index === "?"
      ? "untracked"
      : /[AC]/.test(c.index)
        ? "added"
        : "modified";
  const letter = c.conflict
    ? "!"
    : c.index === "?"
      ? "U"
      : staged
        ? c.index
        : c.worktree;
  const label = c.conflict
    ? "存在冲突"
    : c.index === "?"
      ? "未被 Git 托管"
      : partial
        ? "部分暂存"
        : staged
          ? "已暂存"
          : "未暂存";
  const parent = c.path.includes("/")
    ? c.path.slice(0, c.path.lastIndexOf("/"))
    : "";
  return (
    <div
      ref={rowRef}
      className={`change-row ${selected ? "selected" : ""}`}
      data-status={status}
      onFocusCapture={onSelect}
    >
      <StageCheckbox
        label={`${staged ? "取消暂存" : "暂存"} ${c.path}${partial ? "（部分暂存）" : ""}`}
        checked={staged}
        mixed={partial}
        disabled={busy || c.conflict}
        onChange={onStage}
      />
      <button
        className="change-file"
        title={`${c.oldPath ? `${c.oldPath} → ` : ""}${c.path}（${label}）`}
        aria-label={`查看 ${c.path} 的${working ? "工作区" : "已暂存"}差异`}
        onClick={() => {
          onSelect();
          onDiff(!working && staged);
        }}
      >
        <FileIcon name={c.path} />
        <span className="change-name truncate">{c.path.split("/").at(-1)}</span>
        {parent && <span className="change-directory truncate">{parent}</span>}
        {partial && (
          <span className="partial-stage" title="暂存区和工作区都有改动">
            部分暂存
          </span>
        )}
        <span className="change-letter" title={label}>
          {letter}
        </span>
      </button>
      {partial && (
        <IconButton
          title={`查看 ${c.path} 的已暂存差异`}
          onClick={() => onDiff(true)}
        >
          <Eye size={13} />
        </IconButton>
      )}
      {c.conflict ? (
        <IconButton
          title={`标记 ${c.path} 已解决`}
          disabled={busy}
          onClick={onResolve}
        >
          <Check size={13} />
        </IconButton>
      ) : (
        working && (
          <IconButton
            title={`丢弃 ${c.path} 的未暂存改动`}
            disabled={busy}
            onClick={onDiscard}
          >
            <RotateCcw size={13} />
          </IconButton>
        )
      )}
    </div>
  );
}

const PAGE_SIZE = 100;

export function UntrackedBrowser({
  changes,
  busy,
  initialPath,
  selected,
  onSelect,
  mutate,
  openDiff,
  onDiscard,
  onClose,
}: {
  changes: Change[];
  busy: boolean;
  initialPath?: string;
  selected: string;
  onSelect: (path: string) => void;
  mutate: (
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<boolean>;
  openDiff: (path: string, staged?: boolean) => void;
  onDiscard: (change: Change) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [requestedPage, setPage] = useState(() =>
    Math.max(
      0,
      Math.floor(changes.findIndex((c) => c.path === initialPath) / PAGE_SIZE),
    ),
  );
  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return value
      ? changes.filter((c) => c.path.toLocaleLowerCase().includes(value))
      : changes;
  }, [changes, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pages - 1);
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return (
    <Modal title="未进行版本管理的文件" onClose={onClose} wide>
      <div className="untracked-browser">
        <label className="commit-file-search input-shell">
          <Search size={15} />
          <input
            aria-label="筛选未托管文件"
            placeholder="按文件名或路径筛选…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="untracked-browser-toolbar">
          <span className="muted">
            {filtered.length.toLocaleString("zh-CN")} /{" "}
            {changes.length.toLocaleString("zh-CN")} 个文件
          </span>
          <button
            disabled={busy || !visible.length}
            onClick={() =>
              void mutate("stage", { paths: visible.map((c) => c.path) })
            }
          >
            暂存本页 {visible.length} 个文件
          </button>
        </div>
        <div className="untracked-files">
          {visible.map((c) => (
            <ChangeFileRow
              key={c.path}
              change={c}
              busy={busy}
              selected={selected === c.path}
              onSelect={() => onSelect(c.path)}
              onStage={() => void mutate("stage", { paths: [c.path] })}
              onDiff={() => {
                openDiff(c.path);
                onClose();
              }}
              onDiscard={() => onDiscard(c)}
              onResolve={() => {}}
            />
          ))}
          {!visible.length && (
            <Empty title={query ? "没有匹配的文件" : "没有未托管文件"} />
          )}
        </div>
        <div className="untracked-browser-footer">
          <span className="muted">勾选后加入 Git 暂存区</span>
          <IconButton
            title="上一页未托管文件"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={15} />
          </IconButton>
          <span>
            {page + 1} / {pages}
          </span>
          <IconButton
            title="下一页未托管文件"
            disabled={page + 1 >= pages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={15} />
          </IconButton>
        </div>
      </div>
    </Modal>
  );
}
