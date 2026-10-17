import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Crosshair,
  FolderGit2,
  RefreshCw,
} from "lucide-react";
import { request } from "../api";
import type { Change, TreeEntry } from "../../shared/types";
import { Empty, FileIcon, IconButton, PanelHeader } from "./ui";

type TreeStatus = "untracked" | "added" | "modified" | "conflicted" | "ignored";

const treeStatusDetails: Record<TreeStatus, { label: string; badge: string }> =
  {
    untracked: { label: "未被 Git 托管", badge: "U" },
    added: { label: "新增，已加入 Git", badge: "A" },
    modified: { label: "已修改", badge: "M" },
    conflicted: { label: "存在冲突", badge: "!" },
    ignored: { label: "Git 已排除", badge: "I" },
  };

function collectTreeStatuses(changes: Change[]) {
  const statuses = new Map<string, TreeStatus>();
  const priority: Record<TreeStatus, number> = {
    ignored: 0,
    untracked: 1,
    added: 2,
    modified: 3,
    conflicted: 4,
  };
  const record = (path: string, status: TreeStatus) => {
    const previous = statuses.get(path);
    if (!previous || priority[status] > priority[previous]) {
      statuses.set(path, status);
    }
  };
  const recordPath = (path: string, status: TreeStatus) => {
    record(path, status);
    let separator = path.lastIndexOf("/");
    while (separator > 0) {
      record(path.slice(0, separator), status);
      separator = path.lastIndexOf("/", separator - 1);
    }
  };
  for (const change of changes) {
    const status: TreeStatus = change.conflict
      ? "conflicted"
      : change.index === "?"
        ? "untracked"
        : /[AC]/.test(change.index)
          ? "added"
          : "modified";
    recordPath(change.path, status);
    if (change.oldPath && /R/.test(change.index + change.worktree)) {
      recordPath(change.oldPath, "modified");
    }
  }
  return statuses;
}

function Directory({
  repo,
  directory = "",
  depth = 0,
  statuses,
  onFile,
  active,
  version,
  expanded,
  setExpanded,
}: {
  repo: string;
  directory?: string;
  depth?: number;
  statuses: Map<string, TreeStatus>;
  onFile: (path: string) => void;
  active?: string;
  version: number;
  expanded: Set<string>;
  setExpanded: (fn: (v: Set<string>) => Set<string>) => void;
}) {
  const [entries, setEntries] = useState<TreeEntry[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    request<TreeEntry[]>("tree", repo, { path: directory })
      .then((v) => {
        if (current) {
          setEntries(v);
          setError("");
        }
      })
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [repo, directory, version]);
  return (
    <>
      {error && <div className="tree-error">{error}</div>}
      {entries.map((entry) => {
        const open = expanded.has(entry.path),
          status = entry.ignored ? "ignored" : statuses.get(entry.path),
          details = status ? treeStatusDetails[status] : undefined,
          statusLabel = details
            ? `${entry.directory && status !== "ignored" ? "包含：" : ""}${details.label}`
            : "";
        return (
          <div key={entry.path}>
            <button
              title={`${entry.path}${statusLabel ? `（${statusLabel}）` : ""}`}
              className={`tree-row ${active === entry.path ? "selected" : ""}`}
              data-status={status}
              data-ignored={entry.ignored || undefined}
              aria-label={`${entry.name}${statusLabel ? `，${statusLabel}` : ""}`}
              aria-expanded={entry.directory ? open : undefined}
              style={{ paddingLeft: 12 + depth * 17 }}
              onClick={() =>
                entry.directory
                  ? setExpanded((v) => {
                      const next = new Set(v);
                      if (next.has(entry.path)) next.delete(entry.path);
                      else next.add(entry.path);
                      return next;
                    })
                  : onFile(entry.path)
              }
            >
              {entry.directory ? (
                <ChevronRight size={13} className={open ? "rotate" : ""} />
              ) : (
                <span className="tree-spacer" />
              )}
              <FileIcon
                name={entry.name}
                folder={entry.directory}
                open={open}
              />
              <span className="truncate">{entry.name}</span>
              {entry.symlink && <span className="muted">↗</span>}
              {details && (
                <span
                  className="file-status"
                  title={statusLabel}
                  aria-hidden="true"
                >
                  {details.badge}
                </span>
              )}
            </button>
            {entry.directory && open && (
              <Directory
                {...{
                  repo,
                  statuses,
                  onFile,
                  active,
                  version,
                  expanded,
                  setExpanded,
                }}
                directory={entry.path}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
export function ProjectTree({
  repo,
  name,
  changes,
  onFile,
  active,
  version,
  refresh,
}: {
  repo: string;
  name: string;
  changes: Change[];
  onFile: (path: string) => void;
  active?: string;
  version: number;
  refresh: () => void;
}) {
  const [expanded, setExpanded] = useState(new Set<string>()),
    [rootOpen, setRootOpen] = useState(true);
  const statuses = useMemo(() => collectTreeStatuses(changes), [changes]);
  useEffect(() => {
    setExpanded(new Set());
    setRootOpen(true);
  }, [repo]);
  return (
    <section className="project-panel panel">
      <PanelHeader title="项目">
        <IconButton title="刷新项目" onClick={refresh}>
          <RefreshCw size={14} />
        </IconButton>
        <IconButton title="收起所有目录" onClick={() => setExpanded(new Set())}>
          <ChevronsDownUp size={15} />
        </IconButton>
        <IconButton
          title="定位当前文件"
          disabled={!active}
          onClick={() => {
            const parts = active!.split("/");
            setExpanded(
              new Set(
                parts
                  .slice(0, -1)
                  .map((_, i) => parts.slice(0, i + 1).join("/")),
              ),
            );
            setRootOpen(true);
          }}
        >
          <Crosshair size={15} />
        </IconButton>
      </PanelHeader>
      <div className="project-scope">
        <span>项目文件</span>
        <ChevronDown size={12} />
        <span className="tiny muted">{name}</span>
      </div>
      {repo ? (
        <div className="tree-scroll">
          <button className="tree-root" onClick={() => setRootOpen(!rootOpen)}>
            <ChevronRight size={13} className={rootOpen ? "rotate" : ""} />
            <FolderGit2 size={17} className="folder-icon" />
            <strong>{name}</strong>
            <span className="tiny muted truncate">{repo}</span>
          </button>
          {rootOpen && (
            <Directory
              {...{
                repo,
                statuses,
                onFile,
                active,
                version,
                expanded,
                setExpanded,
              }}
              depth={1}
            />
          )}
        </div>
      ) : (
        <Empty title="尚未打开仓库" />
      )}
      <div className="panel-foot">
        <span className="status-dot" />
        本地文件系统
      </div>
    </section>
  );
}
