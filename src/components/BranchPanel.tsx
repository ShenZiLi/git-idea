import { useState } from "react";
import {
  ChevronRight,
  Folder,
  GitBranch,
  GitMerge,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  Tag,
  X,
} from "lucide-react";
import type { Branch, RepoSnapshot } from "../../shared/types";
import { Group, IconButton } from "./ui";
export function BranchPanel({
  snapshot: s,
  filter,
  onFilter,
  checkout,
  create,
  manage,
  createTag,
  deleteTag,
  busy = false,
}: {
  snapshot: RepoSnapshot | null;
  filter: string;
  onFilter: (ref: string) => void;
  checkout: (branch: Branch) => void;
  create: () => void;
  manage: (
    branch: Branch,
    anchor: HTMLElement,
    point?: { x: number; y: number },
    initialAction?: string,
  ) => void;
  createTag: () => void;
  deleteTag: (name: string) => void;
  busy?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [local, setLocal] = useState(true),
    [remote, setRemote] = useState(true),
    [tags, setTags] = useState(true);
  const visible = (name: string) =>
    name.toLowerCase().includes(search.toLowerCase());
  const row = (branch: Branch) => (
    <div
      className={`branch-row ${filter === branch.ref ? "selected" : ""} ${branch.current ? "current" : ""}`}
      key={branch.ref}
    >
      <button
        aria-haspopup="menu"
        title={`${branch.name}${branch.upstream ? ` → ${branch.upstream}` : ""}\n单击筛选日志，双击检出`}
        onClick={() => onFilter(branch.ref === filter ? "" : branch.ref)}
        onDoubleClick={() => checkout(branch)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.currentTarget.focus();
          manage(branch, event.currentTarget, {
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.key === "F10" && event.shiftKey)
          ) {
            event.preventDefault();
            manage(branch, event.currentTarget);
          } else if (!busy && (event.key === "F2" || event.key === "Delete")) {
            event.preventDefault();
            manage(
              branch,
              event.currentTarget,
              undefined,
              event.key === "F2" ? "rename" : "delete",
            );
          }
        }}
      >
        {branch.current ? (
          <GitBranch size={14} className="gold" />
        ) : branch.name === "main" || branch.name === "master" ? (
          <Star size={14} className="gold" />
        ) : (
          <GitBranch size={14} />
        )}
        <span className="truncate">
          {branch.remote
            ? branch.name.split("/").slice(1).join("/")
            : branch.name}
        </span>
        {branch.current && <span className="tiny green">当前</span>}
        {branch.track && (
          <span className="tiny muted">
            {branch.track
              .replace("ahead ", "↑")
              .replace("behind ", "↓")
              .replace(/[\[\]]/g, "")}
          </span>
        )}
      </button>
      <IconButton
        title={`分支操作 ${branch.name}`}
        aria-haspopup="menu"
        onClick={(event) => manage(branch, event.currentTarget)}
      >
        <MoreHorizontal size={13} />
      </IconButton>
    </div>
  );
  return (
    <aside className="branches-panel">
      <div className="branch-search input-shell">
        <Search size={14} />
        <input
          aria-label="搜索分支或标签"
          placeholder="分支或标签"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <IconButton title="新建分支" disabled={!s} onClick={create}>
          <Plus size={14} />
        </IconButton>
      </div>
      <div className="branches-scroll">
        <button
          className={`head-branch ${!filter ? "selected-filter" : ""}`}
          onClick={() => onFilter("")}
        >
          <GitMerge size={14} />
          <span>所有分支</span>
          <span className="tiny muted">{s?.branches.length || 0}</span>
        </button>
        <button
          className={`head-branch ${filter === "HEAD" ? "selected-filter" : ""}`}
          onClick={() => onFilter(filter === "HEAD" ? "" : "HEAD")}
        >
          <GitBranch size={14} />
          <span>
            HEAD <span className="muted">(当前分支)</span>
          </span>
        </button>
        <Group
          name="本地"
          count={s?.branches.filter((b) => !b.remote).length || 0}
          open={local}
          onToggle={() => setLocal(!local)}
        >
          {s?.branches.filter((b) => !b.remote && visible(b.name)).map(row)}
        </Group>
        <Group
          name="远程"
          count={s?.remotes.length || 0}
          open={remote}
          onToggle={() => setRemote(!remote)}
        >
          {s?.remotes.map((r) => (
            <div key={r.name}>
              <div className="remote-title">
                <ChevronRight size={12} className="rotate" />
                <Folder size={14} />
                <span>{r.name}</span>
              </div>
              {s.branches
                .filter(
                  (b) =>
                    b.remote &&
                    b.name.startsWith(r.name + "/") &&
                    visible(b.name),
                )
                .map(row)}
            </div>
          ))}
        </Group>
        <Group
          name="标签"
          count={s?.tags.length || 0}
          open={tags}
          onToggle={() => setTags(!tags)}
        >
          {s?.tags
            .filter((t) => visible(t.name))
            .map((t) => (
              <div
                key={t.name}
                className={`branch-row ${filter === `refs/tags/${t.name}` ? "selected" : ""}`}
              >
                <button
                  onClick={() =>
                    onFilter(
                      `refs/tags/${t.name}` === filter
                        ? ""
                        : `refs/tags/${t.name}`,
                    )
                  }
                >
                  <Tag size={13} />
                  <span>{t.name}</span>
                </button>
                <IconButton
                  title={`删除标签 ${t.name}`}
                  onClick={() => deleteTag(t.name)}
                >
                  <X size={12} />
                </IconButton>
              </div>
            ))}
          <button
            className="tree-inline-action"
            disabled={!s?.commits.length}
            onClick={createTag}
          >
            <Plus size={12} />
            新建标签
          </button>
        </Group>
      </div>
    </aside>
  );
}
