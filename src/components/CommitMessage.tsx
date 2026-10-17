import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  GitCommitHorizontal,
  Settings,
} from "lucide-react";
import type { RepoSnapshot } from "../../shared/types";
import { Modal, Popover } from "./Dialogs";
import { Presence } from "./Motion";
import { Empty, IconButton, Spinner } from "./ui";

const historyKey = (root: string) => `git-idea-commit-messages:${root}`;
function readHistory(root: string): string[] {
  try {
    const values: unknown = JSON.parse(
      localStorage.getItem(historyKey(root)) || "[]",
    );
    return Array.isArray(values)
      ? values
          .filter(
            (value): value is string =>
              typeof value === "string" && Boolean(value.trim()),
          )
          .slice(0, 30)
      : [];
  } catch {
    return [];
  }
}
const commitMessage = (commit: NonNullable<RepoSnapshot["head"]>) =>
  [commit.subject, commit.body].filter(Boolean).join("\n\n");

export function CommitMessage({
  snapshot: s,
  stagedCount,
  busy,
  mutate,
  confirm,
  settings,
}: {
  snapshot: RepoSnapshot | null;
  stagedCount: number;
  busy: boolean;
  mutate: (
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<boolean>;
  confirm: (
    title: string,
    message: string,
    action: () => Promise<unknown>,
  ) => void;
  settings: () => void;
}) {
  const [message, setMessage] = useState(""),
    [amend, setAmend] = useState(false);
  const [error, setError] = useState(""),
    [submitting, setSubmitting] = useState(false);
  const [lastMenu, setLastMenu] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false);
  const [savedMessages, setSavedMessages] = useState<string[]>([]);
  const messageRef = useRef<HTMLTextAreaElement>(null),
    lastAnchor = useRef<HTMLDivElement>(null);
  const previousDraft = useRef(""),
    submittingRef = useRef(false),
    rootRef = useRef(s?.root);
  rootRef.current = s?.root;
  const locked = busy || submitting;
  const conflicts = s?.changes.filter((c) => c.conflict).length || 0;
  const history = useMemo(
    () =>
      Array.from(
        new Set([
          ...savedMessages,
          ...(s?.head ? [commitMessage(s.head)] : []),
          ...(s?.commits.map(commitMessage) || []),
        ]),
      )
        .filter(Boolean)
        .slice(0, 30),
    [savedMessages, s?.head, s?.commits],
  );
  useEffect(() => {
    rootRef.current = s?.root;
    setMessage("");
    setAmend(false);
    setError("");
    setLastMenu(false);
    setHistoryOpen(false);
    previousDraft.current = "";
    setSavedMessages(s?.root ? readHistory(s.root) : []);
    return () => {
      rootRef.current = undefined;
    };
  }, [s?.root]);
  useEffect(() => setError(""), [stagedCount, amend]);

  function toggleAmend(value: boolean) {
    if (value && s?.head) {
      previousDraft.current = message;
      setMessage(commitMessage(s.head));
    } else setMessage(previousDraft.current);
    setAmend(value);
    setError("");
  }
  function validate() {
    if (!s || locked || submittingRef.current) return false;
    const reason = !message.trim()
      ? "请输入提交消息"
      : conflicts
        ? "请先解决所有文件冲突"
        : !stagedCount && !amend
          ? "请先勾选并暂存要提交的文件"
          : "";
    setError(reason);
    if (reason) {
      messageRef.current?.focus();
      return false;
    }
    return true;
  }
  async function commit(push = false) {
    if (!validate() || !s) return;
    const root = s.root,
      text = message.trim(),
      target = s.upstream
        ? {}
        : { remote: s.remotes[0]?.name, branch: s.branch };
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (!(await mutate("commit", { message: text, amend }))) return;
      const saved = Array.from(new Set([text, ...readHistory(root)]))
        .filter((value) => value.length <= 20000)
        .slice(0, 30);
      try {
        localStorage.setItem(historyKey(root), JSON.stringify(saved));
      } catch {
        /* Committing does not depend on history storage. */
      }
      if (rootRef.current !== root) return;
      setSavedMessages(saved);
      setMessage("");
      setAmend(false);
      previousDraft.current = "";
      if (push) await mutate("push", target);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }
  function submit(push = false) {
    if (!validate() || !s) return;
    if (push) {
      if (!s.remotes.length || s.branch === "HEAD") {
        setError("请先配置远程仓库并切换到本地分支");
        return;
      }
      const root = s.root;
      confirm(
        "提交并推送",
        `提交 ${stagedCount} 个已暂存文件${amend ? "并修订上次提交" : ""}，然后推送到 ${s.upstream || `${s.remotes[0].name}/${s.branch}`}。`,
        async () => {
          if (rootRef.current === root) await commit(true);
        },
      );
    } else void commit();
  }
  const cannotCommit =
    locked || !s || Boolean(conflicts) || (!stagedCount && !amend);
  return (
    <div className="commit-form">
      <div className="commit-options">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={amend}
            disabled={!s?.head || locked || Boolean(s?.operation)}
            onChange={(e) => toggleAmend(e.target.checked)}
          />
          修订
        </label>
        <div className="popover-anchor" ref={lastAnchor}>
          <button
            className="last-commit-button"
            disabled={!s?.head || locked}
            aria-haspopup="menu"
            aria-expanded={lastMenu}
            title={
              s?.head
                ? `${s.head.hash.slice(0, 8)} ${s.head.subject}`
                : "暂无提交"
            }
            onClick={() => setLastMenu(!lastMenu)}
          >
            上次提交
            <ChevronDown size={12} />
          </button>
          <Popover
            open={lastMenu}
            onClose={() => setLastMenu(false)}
            label="上次提交操作"
            anchor={lastAnchor}
            above
            className="last-commit-menu"
          >
            <div className="menu-caption">
              {s?.head?.hash.slice(0, 8)} · {s?.head?.subject}
            </div>
            <button
              role="menuitem"
              disabled={locked}
              onClick={() => {
                if (s?.head) setMessage(commitMessage(s.head));
                setLastMenu(false);
                setError("");
              }}
            >
              使用上次提交消息
            </button>
            <button
              role="menuitem"
              disabled={!s?.head || locked || amend || Boolean(s?.operation)}
              onClick={() => {
                toggleAmend(true);
                setLastMenu(false);
              }}
            >
              修订上次提交
            </button>
          </Popover>
        </div>
        <IconButton
          title="提交消息历史"
          disabled={!s || locked}
          onClick={() => setHistoryOpen(true)}
        >
          <Clock3 size={15} />
        </IconButton>
        <span
          className="commit-selected-count"
          title="仅提交 Git 暂存区中的内容"
        >
          {stagedCount} 个待提交
        </span>
      </div>
      <textarea
        ref={messageRef}
        aria-label="提交信息"
        aria-describedby={error ? "commit-message-error" : undefined}
        aria-invalid={Boolean(error)}
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          setError("");
        }}
        placeholder="提交消息"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        disabled={locked || !s}
      />
      {error && (
        <div id="commit-message-error" className="form-error" role="alert">
          {error}
        </div>
      )}
      {s && (!s.identity.name || !s.identity.email) && (
        <button
          className="identity-warning"
          disabled={locked}
          onClick={settings}
        >
          <AlertTriangle size={12} />
          设置提交者姓名和邮箱
        </button>
      )}
      <div className="commit-actions">
        <button
          className="primary"
          disabled={cannotCommit}
          onClick={() => submit()}
        >
          {locked ? <Spinner /> : <GitCommitHorizontal size={14} />}提交
          <span className="key-hint">Ctrl ↵</span>
        </button>
        <button
          disabled={cannotCommit || !s?.remotes.length || s.branch === "HEAD"}
          onClick={() => submit(true)}
        >
          提交并推送…
        </button>
        <IconButton title="提交设置" disabled={locked} onClick={settings}>
          <Settings size={15} />
        </IconButton>
      </div>
      {createPortal(
        <Presence>
          {historyOpen && (
            <Modal title="提交消息历史" onClose={() => setHistoryOpen(false)}>
              <p className="modal-description">
                选择消息填入编辑区。包含本仓库最近使用的消息和当前日志中的提交。
              </p>
              <div className="commit-message-history">
                {history.map((text, i) => (
                  <button
                    key={text}
                    disabled={locked}
                    title={text}
                    onClick={() => {
                      setMessage(text);
                      setError("");
                      setHistoryOpen(false);
                    }}
                  >
                    <Clock3 size={14} />
                    <span>
                      <strong>{text.split("\n")[0]}</strong>
                      {text.includes("\n") && (
                        <small>
                          {text.slice(text.indexOf("\n") + 1).trim()}
                        </small>
                      )}
                    </span>
                    <span className="tiny muted">{i + 1}</span>
                  </button>
                ))}
                {!history.length && <Empty title="暂无提交消息" />}
              </div>
            </Modal>
          )}
        </Presence>,
        document.body,
      )}
    </div>
  );
}
