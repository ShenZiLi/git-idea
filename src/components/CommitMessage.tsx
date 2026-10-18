import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock3, GitCommitHorizontal, Settings } from "lucide-react";
import type { RepoSnapshot } from "../../shared/types";
import type {
  CommitScope,
  WorkspaceState,
} from "../../shared/commit-workspace";
import { request } from "../api";
import { Modal } from "./Dialogs";
import { IconButton } from "./ui";
interface Preview {
  repo: string;
  generation: number;
  draftKey: string;
  scopeName: string;
  sourceLists: string[];
  revision: number;
  head: string;
  index: string;
  paths: string[];
  partial: string[];
  push: boolean;
  message: string;
  amend: boolean;
  scope: CommitScope;
}
interface Props {
  snapshot: RepoSnapshot | null;
  workspace: WorkspaceState | null;
  stagedCount: number;
  busy: boolean;
  scope: CommitScope;
  setScope: (scope: CommitScope) => void;
  selected: string[];
  mutate: (
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<boolean>;
  prepare: () => Promise<boolean>;
  refreshWorkspace: () => Promise<void>;
  settings: () => void;
  draftFlushRef?: { current: (() => Promise<void>) | null };
}
const fullMessage = (s: NonNullable<RepoSnapshot["head"]>) =>
  [s.subject, s.body].filter(Boolean).join("\n\n");
export function CommitMessage({
  snapshot: s,
  workspace,
  stagedCount,
  busy,
  scope,
  setScope,
  selected,
  mutate,
  prepare,
  refreshWorkspace,
  settings,
  draftFlushRef,
}: Props) {
  const [message, setMessage] = useState(""),
    [amend, setAmend] = useState(false),
    [error, setError] = useState(""),
    [submitting, setSubmitting] = useState(false),
    [preparing, setPreparing] = useState(false),
    [history, setHistory] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null);
  const drafts = useRef<Record<string, string>>({}),
    queue = useRef(Promise.resolve()),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    input = useRef<HTMLTextAreaElement>(null),
    root = useRef(s?.root),
    generation = useRef(0),
    submittingRef = useRef(false),
    preparingRef = useRef(false),
    pendingDraft = useRef<{ repo: string; key: string; text: string } | null>(
      null,
    ),
    failedDrafts = useRef(
      new Map<string, { repo: string; key: string; text: string }>(),
    ),
    failureKey = useRef<string | null>(null);
  if (root.current !== s?.root) {
    root.current = s?.root;
    generation.current++;
  }
  const key = amend
    ? "amend"
    : scope.kind === "changelist"
      ? scope.id
      : workspace?.activeListId || "default";
  const locked = busy || submitting || preparing || !!workspace?.pending.length;
  const draftId = (repo: string, draftKey: string) => `${repo}\0${draftKey}`;
  function remember(repo: string, draftKey: string, text: string) {
    drafts.current[draftId(repo, draftKey)] = text;
    try {
      localStorage.setItem(`git-idea-draft:${repo}:${draftKey}`, text);
    } catch {
      /* In-memory draft is retained. */
    }
  }
  function persist(repo: string, draftKey: string, text: string) {
    remember(repo, draftKey, text);
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const latest = await request<WorkspaceState>("commitWorkspace", repo);
          if (latest.pending.length)
            throw new Error("恢复待处理操作后可继续。草稿已保存在本机。");
          try {
            await request("mutate", repo, {
              action: "commit.draft",
              expectedRevision: latest.revision,
              id: draftKey,
              message: text,
            });
            failedDrafts.current.delete(draftId(repo, draftKey));
            failureKey.current = null;
            if (root.current === repo) void refreshWorkspace();
            return;
          } catch (e) {
            if (attempt) throw e;
          }
        }
      });
    void queue.current.catch((e) => {
      failureKey.current = draftId(repo, draftKey);
      if (drafts.current[draftId(repo, draftKey)] === text)
        failedDrafts.current.set(draftId(repo, draftKey), {
          repo,
          key: draftKey,
          text,
        });
      if (root.current === repo) setError(e.message);
    });
  }
  function flushDraft(retry = false) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pendingDraft.current) {
      const pending = pendingDraft.current;
      pendingDraft.current = null;
      persist(pending.repo, pending.key, pending.text);
    } else if (retry && s) {
      const failed = failedDrafts.current.get(draftId(s.root, key));
      if (failed) {
        failedDrafts.current.delete(draftId(s.root, key));
        persist(
          failed.repo,
          failed.key,
          drafts.current[draftId(s.root, key)] ?? failed.text,
        );
      }
    }
    return retry && s
      ? queue.current.catch((error) => {
          if (failureKey.current === draftId(s.root, key)) throw error;
        })
      : queue.current;
  }
  if (draftFlushRef) draftFlushRef.current = () => flushDraft(true);
  function edit(text: string) {
    if (!s) return;
    if (
      pendingDraft.current &&
      (pendingDraft.current.repo !== s.root || pendingDraft.current.key !== key)
    )
      void flushDraft();
    setMessage(text);
    setError("");
    remember(s.root, key, text);
    pendingDraft.current = { repo: s.root, key, text };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flushDraft();
    }, 450);
  }
  useEffect(() => {
    void flushDraft();
    setAmend(false);
    setPreview(null);
    setHistory(false);
    setSubmitting(false);
    setPreparing(false);
    submittingRef.current = false;
    preparingRef.current = false;
    setError("");
  }, [s?.root]);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = s
        ? localStorage.getItem(`git-idea-draft:${s.root}:${key}`)
        : null;
    } catch {}
    setMessage(
      (s ? drafts.current[draftId(s.root, key)] : undefined) ??
        stored ??
        workspace?.drafts[key] ??
        "",
    );
  }, [s?.root, key, !!workspace]);
  useEffect(
    () => () => {
      void flushDraft();
    },
    [],
  );
  async function submit(push = false) {
    if (
      !s ||
      !workspace ||
      locked ||
      submittingRef.current ||
      preparingRef.current
    )
      return;
    if (s.operation) {
      setError("当前 Git 操作尚未结束，请使用继续或中止入口。");
      return;
    }
    if (!message.trim()) {
      setError("请输入提交消息");
      input.current?.focus();
      return;
    }
    if (s.changes.some((c) => c.conflict)) {
      setError("请先解决所有文件冲突");
      return;
    }
    if (push && (!s.remotes.length || s.branch === "HEAD")) {
      setError("请先配置远程仓库并切换到本地分支");
      return;
    }
    const repo = s.root,
      session = generation.current;
    const commitScope =
      scope.kind === "files"
        ? { kind: "files" as const, paths: [...selected] }
        : scope;
    const draftKey = key,
      text = message.trim(),
      amendValue = amend;
    preparingRef.current = true;
    setPreparing(true);
    try {
      if (!(await prepare())) throw new Error("请先处理编辑器的自动保存提示");
      if (root.current !== repo || session !== generation.current) return;
      await flushDraft(true);
      if (root.current !== repo || session !== generation.current) return;
      const value = await request<
        Pick<Preview, "revision" | "head" | "index" | "paths" | "partial">
      >("commitScopePreview", repo, { scope: commitScope, amend: amendValue });
      if (root.current !== repo || session !== generation.current) return;
      if (
        !value.paths.length &&
        !(amendValue && commitScope.kind === "all-staged")
      )
        throw new Error("当前范围没有已暂存内容，请先勾选文件");
      setPreview({
        ...value,
        repo,
        generation: session,
        draftKey,
        scopeName:
          commitScope.kind === "all-staged"
            ? "全部已暂存内容"
            : commitScope.kind === "files"
              ? "所选文件"
              : workspace.lists.find((list) => list.id === commitScope.id)
                  ?.name || "更改列表",
        sourceLists: [
          ...new Set(
            value.paths.map((path) => {
              const change = s.changes.find(
                (item) => item.path === path || item.oldPath === path,
              );
              const listId =
                workspace.assignments[change?.path || path] ||
                workspace.activeListId;
              return (
                workspace.lists.find((list) => list.id === listId)?.name ||
                "更改"
              );
            }),
          ),
        ],
        push,
        message: text,
        amend: amendValue,
        scope: commitScope,
      });
    } catch (e) {
      if (root.current === repo && session === generation.current)
        setError((e as Error).message);
    } finally {
      if (root.current === repo && session === generation.current) {
        preparingRef.current = false;
        setPreparing(false);
      }
    }
  }
  async function commit(value: Preview) {
    if (
      !s ||
      busy ||
      submittingRef.current ||
      value.repo !== s.root ||
      value.generation !== generation.current
    )
      return;
    submittingRef.current = true;
    setSubmitting(true);
    const repo = value.repo,
      session = value.generation,
      draftKey = value.draftKey;
    try {
      if (
        !(await mutate("commit.scope", {
          scope: value.scope,
          message: value.message,
          amend: value.amend,
          expectedRevision: value.revision,
          expectedHead: value.head,
          expectedIndex: value.index,
        }))
      )
        return;
      if (root.current !== repo || session !== generation.current) return;
      try {
        const storage = `git-idea-commit-messages:${repo}`,
          old = JSON.parse(localStorage.getItem(storage) || "[]");
        localStorage.setItem(
          storage,
          JSON.stringify(
            [
              ...new Set([value.message, ...(Array.isArray(old) ? old : [])]),
            ].slice(0, 30),
          ),
        );
      } catch {
        /* History does not affect a completed commit. */
      }
      setMessage("");
      remember(repo, draftKey, "");
      setAmend(false);
      const after = await request<WorkspaceState>("commitWorkspace", repo);
      if (root.current !== repo || session !== generation.current) return;
      if (after.pending.length) {
        setError("提交已创建，请先完成恢复记录中的索引恢复。暂不推送。");
        return;
      }
      persist(repo, draftKey, "");
      if (value.push)
        await mutate(
          "push",
          s.upstream ? {} : { remote: s.remotes[0]?.name, branch: s.branch },
        );
    } catch (cause) {
      if (root.current === repo && session === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (root.current === repo && session === generation.current) {
        submittingRef.current = false;
        setSubmitting(false);
        setPreview(null);
        void refreshWorkspace();
      }
    }
  }
  const messages = Array.from(
    new Set([
      ...(s?.head ? [fullMessage(s.head)] : []),
      ...(s?.commits.map(fullMessage) || []),
    ]),
  );
  if (s)
    try {
      const saved = JSON.parse(
        localStorage.getItem(`git-idea-commit-messages:${s.root}`) || "[]",
      );
      if (Array.isArray(saved))
        for (const text of saved.reverse())
          if (typeof text === "string" && !messages.includes(text))
            messages.unshift(text);
    } catch {}
  const scopedStaged =
    s?.changes.filter(
      (change) =>
        change.index !== "?" &&
        change.index !== " " &&
        !change.conflict &&
        (scope.kind === "all-staged" ||
          (scope.kind === "files"
            ? selected.includes(change.path)
            : (workspace?.assignments[change.path] ||
                workspace?.activeListId) === scope.id)),
    ).length || 0;
  const canCommit = scopedStaged > 0 || (amend && scope.kind === "all-staged");
  return (
    <div className="commit-form">
      <select
        aria-label="提交范围"
        value={scope.kind === "changelist" ? scope.id : scope.kind}
        disabled={locked || !!s?.operation || !workspace}
        onChange={(e) => {
          void flushDraft();
          setScope(
            e.target.value === "all-staged"
              ? { kind: "all-staged" }
              : e.target.value === "files"
                ? { kind: "files", paths: selected }
                : { kind: "changelist", id: e.target.value },
          );
        }}
      >
        <option value="all-staged">全部已暂存内容</option>
        <option value="files">所选文件的已暂存内容（{selected.length}）</option>
        {workspace?.lists.map((list) => (
          <option key={list.id} value={list.id}>
            列表：{list.name}
          </option>
        ))}
      </select>
      <div className="commit-options">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={amend}
            disabled={locked || !s?.head || !!s.operation}
            onChange={(e) => {
              void flushDraft();
              if (
                e.target.checked &&
                s?.head &&
                !drafts.current[draftId(s.root, "amend")] &&
                !workspace?.drafts.amend
              )
                remember(s.root, "amend", fullMessage(s.head));
              setAmend(e.target.checked);
            }}
          />
          修订
        </label>
        <button
          disabled={locked || !s?.head}
          onClick={() => s?.head && edit(fullMessage(s.head))}
        >
          上次提交
        </button>
        <IconButton
          title="提交消息历史"
          disabled={locked}
          onClick={() => setHistory(true)}
        >
          <Clock3 size={15} />
        </IconButton>
        <span className="commit-selected-count">
          当前范围 {scopedStaged} / 全部 {stagedCount} 个已暂存
        </span>
      </div>
      <textarea
        ref={input}
        aria-label="提交信息"
        aria-invalid={!!error}
        value={message}
        maxLength={20000}
        onChange={(e) => edit(e.target.value)}
        onBlur={() => void flushDraft()}
        placeholder="提交消息"
        disabled={locked || !s}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {error && (
        <div className="form-error" role="alert">
          {error}
          {s && failedDrafts.current.has(draftId(s.root, key)) && (
            <button
              onClick={() =>
                void flushDraft(true)
                  .then(() => setError(""))
                  .catch(() => {})
              }
            >
              重试保存草稿
            </button>
          )}
        </div>
      )}
      {s && (!s.identity.name || !s.identity.email) && (
        <button className="identity-warning" onClick={settings}>
          设置提交者姓名和邮箱
        </button>
      )}
      <div className="commit-actions">
        <button
          className="primary"
          disabled={locked || !s || !workspace || !canCommit || !!s.operation}
          onClick={() => void submit()}
        >
          <GitCommitHorizontal size={14} />
          {submitting ? "正在提交…" : preparing ? "正在准备…" : "提交"}
          <span className="key-hint">Ctrl ↵</span>
        </button>
        <button
          disabled={
            locked ||
            !s?.remotes.length ||
            !canCommit ||
            !!s?.operation ||
            !workspace
          }
          onClick={() => void submit(true)}
        >
          提交并推送…
        </button>
        <IconButton title="提交设置" onClick={settings}>
          <Settings size={15} />
        </IconButton>
      </div>
      {createPortal(
        <>
          {preview && (
            <Modal
              title={preview.push ? "确认提交并推送" : "确认提交范围"}
              onClose={() => !submitting && setPreview(null)}
            >
              <p className="modal-description">
                提交以下 {preview.paths.length} 个文件的已暂存版本
                {preview.amend ? "，并修订上次提交" : ""}
                。未暂存内容保留在工作树。
              </p>
              <p>
                提交范围：{preview.scopeName}；来源列表：
                {preview.sourceLists.join("、") || "无文件（仅修订消息）"}
              </p>
              {preview.partial.length > 0 && (
                <p className="form-error">
                  {preview.partial.length}{" "}
                  个文件存在未暂存改动，本次仅提交暂存版本。
                </p>
              )}
              <div style={{ maxHeight: "32vh", overflow: "auto" }}>
                {preview.paths.map((path) => (
                  <div className="mono" key={path}>
                    {path}
                  </div>
                ))}
              </div>
              <pre style={{ whiteSpace: "pre-wrap" }}>{preview.message}</pre>
              {preview.push && (
                <p>
                  随后推送到{" "}
                  {s?.upstream || `${s?.remotes[0]?.name}/${s?.branch}`}
                </p>
              )}
              <div className="modal-actions">
                <button disabled={submitting} onClick={() => setPreview(null)}>
                  取消
                </button>
                <button
                  className="primary"
                  disabled={submitting}
                  onClick={() => void commit(preview)}
                >
                  确认提交
                </button>
              </div>
            </Modal>
          )}
          {history && (
            <Modal title="提交消息历史" onClose={() => setHistory(false)}>
              <div className="commit-message-history">
                {messages.slice(0, 30).map((text) => (
                  <button
                    key={text}
                    onClick={() => {
                      edit(text);
                      setHistory(false);
                    }}
                  >
                    <Clock3 size={14} />
                    <span>{text}</span>
                  </button>
                ))}
                {!messages.length && <p className="muted">暂无提交消息</p>}
              </div>
            </Modal>
          )}
        </>,
        document.body,
      )}
    </div>
  );
}
