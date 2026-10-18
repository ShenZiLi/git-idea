import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Hash,
  MoreHorizontal,
  Tag,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type {
  CommandLog,
  Commit,
  CommitDetail,
  Stash,
} from "../../shared/types";
import { request } from "../api";
import { Modal, Popover } from "./Dialogs";
import { ReadonlyDiff } from "./BranchCompare";
import type { DiffData } from "../../shared/types";
import {
  BranchLabel,
  dateTime,
  Empty,
  FileIcon,
  IconButton,
  Spinner,
} from "./ui";

export { LogTable } from "./LogTable";
export type { LogFilters } from "../../shared/log";
export function CommitDetails({
  repo,
  hash,
  detail: cachedDetail,
  setDetail,
  openDiff,
  action,
  notify,
}: {
  repo: string;
  hash: string;
  detail: CommitDetail | null;
  setDetail: (v: CommitDetail | null) => void;
  openDiff: (path: string, hash: string, oldPath?: string) => void;
  action: (name: string, commit: Commit) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [menu, setMenu] = useState(false);
  const [resolved, setResolved] = useState("");
  const detail =
    !error &&
    resolved === `${repo}\0${hash}` &&
    cachedDetail?.commit.hash === hash
      ? cachedDetail
      : null;
  useEffect(() => {
    if (!repo || !hash) {
      setDetail(null);
      return;
    }
    let current = true;
    setMenu(false);
    setDetail(null);
    setLoading(true);
    setError("");
    request<CommitDetail>("commitDetail", repo, { hash })
      .then((v) => {
        if (current) {
          setDetail(v);
          setResolved(`${repo}\0${hash}`);
        }
      })
      .catch((e) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [repo, hash]);
  if (!hash)
    return (
      <aside className="details-panel">
        <Empty icon={<GitCommitHorizontal size={26} />} title="选择一条提交">
          <span>查看文件更改和提交详情</span>
        </Empty>
      </aside>
    );
  return (
    <aside className="details-panel">
      <div className="panel-toolbar">
        <span className="tiny muted">提交详情</span>
        <span className="spacer" />
        <IconButton
          title="复制提交哈希"
          onClick={() => {
            navigator.clipboard
              .writeText(hash)
              .then(() => notify("已复制提交哈希"))
              .catch(() => notify("复制失败", true));
          }}
        >
          <Copy size={13} />
        </IconButton>
        <div className="popover-anchor">
          <IconButton
            title="更多提交操作"
            aria-haspopup="menu"
            aria-expanded={menu}
            disabled={!detail || loading}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={16} />
          </IconButton>
          <Popover
            open={menu && !!detail}
            onClose={() => setMenu(false)}
            label="提交菜单"
            className="commit-menu"
          >
            {[
              ["cherry-pick", "拣选此提交"],
              ["revert", "还原此提交"],
              ["reset", "重置到此提交…"],
              ["tag", "创建标签…"],
            ].map(([name, label]) => (
              <button
                role="menuitem"
                key={name}
                onClick={() => {
                  if (detail) action(name, detail.commit);
                  setMenu(false);
                }}
              >
                {label}
              </button>
            ))}
          </Popover>
        </div>
      </div>
      {loading ? (
        <div className="inline-loading">
          <Spinner />
          读取提交…
        </div>
      ) : error ? (
        <div className="inline-warning">{error}</div>
      ) : (
        detail && (
          <>
            <div className="detail-files">
              <div className="detail-repo">
                <ChevronDown size={12} />
                <span className="repo-square">G</span>
                <strong>{repo.split(/[/\\]/).at(-1)}</strong>
                <span className="tiny muted">{detail.files.length} 个文件</span>
              </div>
              {detail.files.map((file) => (
                <button
                  key={file.path}
                  title={file.path}
                  className="detail-file"
                  onClick={() => openDiff(file.path, hash, file.oldPath)}
                >
                  <FileIcon name={file.path} />
                  <span
                    className={`truncate ${file.status === "A" ? "green" : file.status === "D" ? "red" : "modified"}`}
                  >
                    {file.path}
                  </span>
                  <span className="diff-stat">
                    <span className="green">+{file.additions}</span>
                    <span className="red">−{file.deletions}</span>
                  </span>
                </button>
              ))}
              {!detail.files.length && (
                <div className="group-empty">
                  此提交与首个父提交之间没有文件改动
                </div>
              )}
            </div>
            <div className="commit-description">
              <h3>{detail.commit.subject}</h3>
              {detail.commit.body && <pre>{detail.commit.body}</pre>}
              <div className="commit-author">
                <span className="avatar">
                  {detail.commit.author.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{detail.commit.author}</strong>
                  <span className="muted">{detail.commit.email}</span>
                </div>
              </div>
              <div className="commit-meta">
                <Hash size={12} />
                <span className="mono">{hash.slice(0, 12)}</span>
              </div>
              <div className="commit-meta">{dateTime(detail.commit.date)}</div>
              {detail.commit.parents.length > 0 && (
                <div className="tiny muted">
                  父提交 ·{" "}
                  {detail.commit.parents.map((p) => p.slice(0, 8)).join(", ")}
                </div>
              )}
              {detail.commit.refs && (
                <div className="detail-refs">
                  {detail.commit.refs.split(", ").map((ref) => (
                    <BranchLabel key={ref} name={ref.replace("HEAD -> ", "")} />
                  ))}
                </div>
              )}
            </div>
          </>
        )
      )}
    </aside>
  );
}
export function ConsolePanel({ logs }: { logs: CommandLog[] }) {
  const [all, setAll] = useState(false);
  const visible = logs.filter(
    (log) =>
      all ||
      !/git (status|rev-parse|symbolic-ref|for-each-ref|log |show |cat-file|diff |remote$|remote get-url|config --get|--version|stash list|hash-object)/.test(
        log.command,
      ),
  );
  return (
    <section className="console-panel">
      <div className="panel-toolbar">
        <Terminal size={14} />
        <span>Git 命令执行记录</span>
        <span className="spacer" />
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          包含读取命令
        </label>
      </div>
      <div className="console-scroll">
        {visible.map((log) => (
          <details
            className={`console-entry ${!log.success ? "error" : ""}`}
            key={log.id}
            open={!log.success}
          >
            <summary>
              <span className={log.success ? "green" : "red"}>
                {log.success ? "✓" : "×"}
              </span>
              <time>{dateTime(log.date, true)}</time>
              <code>{log.command}</code>
              <span className="tiny muted">{log.duration} ms</span>
            </summary>
            <pre>{log.output || "执行成功"}</pre>
          </details>
        ))}
        {!visible.length && (
          <Empty icon={<Terminal size={28} />} title="命令记录会显示在这里" />
        )}
      </div>
    </section>
  );
}
export function StashPanel({
  repo,
  stashes,
  busy,
  mutate,
  confirm,
}: {
  repo: string;
  stashes: Stash[];
  busy: boolean;
  mutate: (action: string, p?: Record<string, unknown>) => Promise<boolean>;
  confirm: (
    title: string,
    message: string,
    action: () => Promise<unknown>,
  ) => void;
}) {
  const [preview, setPreview] = useState<Stash | null>(null),
    [files, setFiles] = useState<
      { path: string; untracked: boolean; staged: boolean; working: boolean }[]
    >([]),
    [data, setData] = useState<DiffData | null>(null),
    [error, setError] = useState("");
  const session = useRef(repo),
    lookup = useRef(0);
  session.current = repo;
  useEffect(() => {
    setPreview(null);
    return () => {
      session.current = "";
      lookup.current++;
    };
  }, [repo]);
  useEffect(() => {
    let current = true;
    lookup.current++;
    setFiles([]);
    setData(null);
    setError("");
    if (preview)
      void request<
        {
          path: string;
          untracked: boolean;
          staged: boolean;
          working: boolean;
        }[]
      >("stashFiles", repo, {
        hash: preview.hash,
      })
        .then((v) => {
          if (current) setFiles(v);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [repo, preview]);
  return (
    <section className="stash-panel">
      <div className="panel-toolbar">
        <Archive size={14} />
        <strong>储藏</strong>
        <span className="count">{stashes.length}</span>
        <span className="spacer" />
        <span className="tiny muted">临时保存未完成的工作</span>
      </div>
      <div className="stash-scroll">
        {stashes.map((stash) => (
          <article className="stash-row" key={stash.ref}>
            <Archive size={18} className="muted" />
            <div>
              <strong>{stash.message}</strong>
              <span className="tiny muted">
                {stash.ref} · {dateTime(stash.date)}
              </span>
            </div>
            <button disabled={!stash.hash} onClick={() => setPreview(stash)}>
              预览
            </button>
            <button
              disabled={busy}
              onClick={() =>
                confirm(
                  "应用储藏",
                  `将 ${stash.message} 应用到工作树，保留储藏记录？`,
                  () =>
                    session.current === repo
                      ? mutate("stash.apply", { hash: stash.hash })
                      : Promise.resolve(false),
                )
              }
            >
              <ArrowDownToLine size={13} />
              应用
            </button>
            <button
              disabled={busy}
              onClick={() =>
                confirm(
                  "弹出储藏",
                  `将 ${stash.message} 应用到工作树，成功后删除该储藏？`,
                  () =>
                    session.current === repo
                      ? mutate("stash.pop", { hash: stash.hash })
                      : Promise.resolve(false),
                )
              }
            >
              <ArrowUpFromLine size={13} />
              弹出
            </button>
            <IconButton
              title={`删除 ${stash.ref}`}
              disabled={busy}
              onClick={() =>
                confirm(
                  "删除储藏",
                  `永久删除 ${stash.ref}：${stash.message}？`,
                  () =>
                    session.current === repo
                      ? mutate("stash.drop", { hash: stash.hash })
                      : Promise.resolve(false),
                )
              }
            >
              <Trash2 size={14} />
            </IconButton>
          </article>
        ))}
        {!stashes.length && (
          <Empty icon={<Archive size={30} />} title="没有储藏记录">
            <span>使用顶部的「储藏更改」保存当前工作</span>
          </Empty>
        )}
      </div>
      {preview && (
        <Modal
          title={`储藏预览 · ${preview.message}`}
          onClose={() => {
            lookup.current++;
            setPreview(null);
          }}
          wide
        >
          <div style={{ maxHeight: "65vh", overflow: "auto" }}>
            {error && <p className="form-error">{error}</p>}
            <div className="panel-toolbar" style={{ flexWrap: "wrap" }}>
              {files.flatMap((file) =>
                (file.staged
                  ? [true, ...(file.working ? [false] : [])]
                  : [false]
                ).map((staged) => (
                  <button
                    key={file.path + staged}
                    onClick={() => {
                      setError("");
                      const id = ++lookup.current;
                      void request<DiffData>("stashDiff", repo, {
                        hash: preview.hash,
                        path: file.path,
                        staged,
                      })
                        .then((value) => {
                          if (id === lookup.current && session.current === repo)
                            setData(value);
                        })
                        .catch((e) => {
                          if (id === lookup.current && session.current === repo)
                            setError(e.message);
                        });
                    }}
                  >
                    {file.path}
                    {file.untracked ? " · 未托管" : ""}
                    {staged ? " · 暂存" : file.staged ? " · 工作区" : ""}
                  </button>
                )),
              )}
            </div>
            {data && <ReadonlyDiff data={data} />}
          </div>
        </Modal>
      )}
    </section>
  );
}
