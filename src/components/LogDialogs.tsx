import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import type { Commit, RepoSnapshot } from "../../shared/types";
import type { LogFilters, LogLocation, LogPerson } from "../../shared/log";
import { request } from "../api";
import { IconButton, Spinner } from "./ui";

export function LogPopup({
  anchor,
  title,
  onClose,
  children,
  menu = false,
}: {
  anchor: RefObject<HTMLElement | null>;
  title: string;
  onClose: () => void;
  children: ReactNode;
  menu?: boolean;
}) {
  const node = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({ top: 8, left: 8 });
  useLayoutEffect(() => {
    const previous = anchor.current?.matches(
      "button,input,textarea,select,[tabindex]",
    )
      ? anchor.current
      : (document.activeElement as HTMLElement | null);
    const popupElement = node.current;
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect(),
        popup = node.current;
      if (!rect || !popup) return;
      const top =
        rect.bottom + popup.offsetHeight + 8 <= innerHeight
          ? rect.bottom + 5
          : Math.max(8, rect.top - popup.offsetHeight - 5);
      const left = Math.max(
        8,
        Math.min(rect.left, innerWidth - popup.offsetWidth - 8),
      );
      setPosition((current) =>
        current.top === top && current.left === left ? current : { top, left },
      );
    };
    update();
    const first =
      node.current?.querySelector<HTMLElement>(
        "input:not(:disabled),textarea:not(:disabled)",
      ) || node.current?.querySelector<HTMLElement>("button:not(:disabled)");
    first?.focus();
    const observer = new ResizeObserver(update);
    if (node.current) observer.observe(node.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      const active = document.activeElement;
      if (
        previous?.isConnected &&
        (popupElement?.contains(active) ||
          active === document.body ||
          active?.classList.contains("log-popup-dismiss"))
      )
        previous.focus({ preventScroll: true });
    };
  }, [anchor]);
  return createPortal(
    <>
      <button
        className="log-popup-dismiss"
        tabIndex={-1}
        aria-label={`关闭${title}`}
        onClick={onClose}
      />
      <div
        ref={node}
        className={`log-popup ${menu ? "log-action-menu" : ""}`}
        role={menu ? "menu" : "dialog"}
        aria-label={title}
        style={position}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close.current();
          }
          if (
            menu &&
            ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          ) {
            const buttons = Array.from(
              node.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) || [],
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            event.preventDefault();
            buttons[next]?.focus();
          }
          if (event.key === "Tab") {
            const inputs = Array.from(
              node.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
              ) || [],
            );
            const first = inputs[0],
              last = inputs.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        {!menu && (
          <div className="log-popup-title">
            <strong>{title}</strong>
            <IconButton title={`关闭${title}`} onClick={onClose}>
              <X size={14} />
            </IconButton>
          </div>
        )}
        {children}
      </div>
    </>,
    document.body,
  );
}

export type FilterKind = "branch" | "author" | "date" | "path";
const names: Record<FilterKind, string> = {
  branch: "筛选分支",
  author: "筛选用户",
  date: "筛选日期",
  path: "筛选路径",
};
export function LogFilterPopup({
  kind,
  anchor,
  snapshot,
  filters,
  currentPath,
  apply,
  onClose,
}: {
  kind: FilterKind;
  anchor: RefObject<HTMLElement | null>;
  snapshot: RepoSnapshot;
  filters: LogFilters;
  currentPath?: string;
  apply: (patch: Partial<LogFilters>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(
    kind === "branch"
      ? [filters.ref, ...(filters.refs || [])].filter(Boolean)
      : [filters.author, ...(filters.authors || [])].filter(Boolean),
  );
  const [people, setPeople] = useState<LogPerson[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [since, setSince] = useState(filters.since),
    [until, setUntil] = useState(filters.until || "");
  const [paths, setPaths] = useState(
    [filters.file, ...(filters.paths || [])].filter(Boolean).join("\n"),
  );
  const [count, setCount] = useState(150);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (kind !== "author") return;
    let current = true;
    setLoading(true);
    setError("");
    request<LogPerson[]>("logPeople", snapshot.root)
      .then((value) => {
        if (current) setPeople(value);
      })
      .catch((cause) => {
        if (current) setError(cause.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [kind, snapshot.root, reload]);
  const options =
    kind === "branch"
      ? [
          { value: "HEAD", label: "HEAD（当前分支）", hint: "" },
          ...snapshot.branches.map((branch) => ({
            value: branch.ref,
            label: branch.name,
            hint: branch.remote ? "远程" : "本地",
          })),
          ...snapshot.tags.map((tag) => ({
            value: `refs/tags/${tag.name}`,
            label: tag.name,
            hint: "标签",
          })),
        ]
      : Array.from(
          new Map(
            [
              ...selected.map((value) => ({
                value,
                label:
                  people.find((person) => person.email === value)?.name ||
                  value,
                hint: "",
              })),
              ...people.map((person) => ({
                value: person.email || person.name,
                label: person.name,
                hint: person.email,
              })),
            ].map((item) => [item.value, item]),
          ).values(),
        );
  const visible = options.filter((item) =>
    `${item.label} ${item.hint}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const nameOnly = (value: string) =>
    kind === "author" &&
    (filters.author === value ||
      (!snapshot.identity.email && snapshot.identity.name === value) ||
      people.some((person) => !person.email && person.name === value)) &&
    !people.some((person) => person.email === value);
  const update = (value: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...new Set([...current, value])]
        : current.filter((item) => item !== value),
    );
  const done = (patch: Partial<LogFilters>) => {
    apply(patch);
    onClose();
  };
  const day = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return (
    <LogPopup anchor={anchor} title={names[kind]} onClose={onClose}>
      {kind === "branch" || kind === "author" ? (
        <>
          <div className="input-shell log-popup-search">
            <Search size={14} />
            <input
              aria-label={kind === "branch" ? "搜索分支或标签" : "搜索作者"}
              placeholder={kind === "branch" ? "分支或标签" : "作者或邮箱"}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCount(150);
              }}
            />
          </div>
          <div className="log-filter-presets">
            <button onClick={() => setSelected([])}>全部</button>
            <button
              onClick={() =>
                setSelected(
                  kind === "branch"
                    ? ["HEAD"]
                    : [
                        snapshot.identity.email || snapshot.identity.name,
                      ].filter(Boolean),
                )
              }
            >
              {kind === "branch" ? "当前分支" : "当前用户"}
            </button>
          </div>
          {loading ? (
            <div className="inline-loading">
              <Spinner />
              读取作者…
            </div>
          ) : error ? (
            <div className="log-popup-error error-text" role="alert">
              {error}
              <button
                className="small"
                onClick={() => setReload((value) => value + 1)}
              >
                重试
              </button>
            </div>
          ) : (
            <div className="log-filter-options">
              {visible.slice(0, count).map((item) => (
                <label className="log-filter-choice" key={item.value}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.value)}
                    disabled={
                      !selected.includes(item.value) &&
                      (selected.length >= 100 ||
                        (nameOnly(item.value) &&
                          !selected.includes(item.value) &&
                          selected.some(nameOnly)))
                    }
                    onChange={(event) =>
                      update(item.value, event.target.checked)
                    }
                  />
                  <span className="truncate">{item.label}</span>
                  <small className="muted truncate">
                    {nameOnly(item.value) ? "无邮箱，按姓名匹配" : item.hint}
                  </small>
                </label>
              ))}
              {!visible.length && <div className="group-empty">没有匹配项</div>}
              {visible.length > count && (
                <button
                  className="load-more"
                  onClick={() => setCount((value) => value + 150)}
                >
                  显示更多
                </button>
              )}
            </div>
          )}
          <div className="log-popup-actions">
            <span className="muted">
              {selected.length ? `已选 ${selected.length} 项` : "全部"}
            </span>
            <button
              className="primary small"
              disabled={
                kind === "author" && selected.length > 0 && (loading || !!error)
              }
              onClick={() =>
                done(
                  kind === "branch"
                    ? { ref: selected[0] || "", refs: selected.slice(1) }
                    : {
                        author: selected.find(nameOnly) || "",
                        authors: selected.filter((value) => !nameOnly(value)),
                      },
                )
              }
            >
              应用
            </button>
          </div>
        </>
      ) : kind === "date" ? (
        <>
          <div className="log-date-presets">
            {[
              ["全部", -1],
              ["今天", 0],
              ["近 7 天", 6],
              ["近 30 天", 29],
            ].map(([label, days]) => (
              <button
                className="small"
                key={label}
                onClick={() => {
                  const now = new Date(),
                    start = new Date(now);
                  start.setDate(now.getDate() - Number(days));
                  done({
                    since: Number(days) < 0 ? "" : day(start),
                    until: Number(days) < 0 ? "" : day(now),
                  });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="log-field">
            开始日期
            <input
              type="date"
              aria-label="起始日期"
              value={since}
              onChange={(event) => {
                setSince(event.target.value);
                setError("");
              }}
            />
          </label>
          <label className="log-field">
            结束日期
            <input
              type="date"
              aria-label="结束日期"
              value={until}
              onChange={(event) => {
                setUntil(event.target.value);
                setError("");
              }}
            />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="log-popup-actions">
            <span className="muted">包含结束日期当天</span>
            <button
              className="primary small"
              onClick={() => {
                if (since && until && since > until)
                  setError("结束日期不能早于开始日期");
                else done({ since, until });
              }}
            >
              应用
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="log-field">
            文件或目录
            <textarea
              autoFocus
              aria-label="筛选文件路径"
              placeholder={"每行一个仓库内相对路径\n例如：src/components"}
              value={paths}
              rows={5}
              onChange={(event) => setPaths(event.target.value)}
            />
          </label>
          <div className="log-filter-presets">
            <button onClick={() => setPaths("")}>全部路径</button>
            <button
              disabled={!currentPath}
              onClick={() => setPaths(currentPath || "")}
            >
              当前文件
            </button>
          </div>
          <p className="muted tiny">按字面路径匹配；多个路径取并集。</p>
          <div className="log-popup-actions">
            <button
              className="primary small"
              onClick={() => {
                const values = [
                  ...new Set(
                    paths
                      .split("\n")
                      .map((path) => path.replace(/\r$/, ""))
                      .filter(Boolean),
                  ),
                ];
                done({ file: values[0] || "", paths: values.slice(1) });
              }}
            >
              应用
            </button>
          </div>
        </>
      )}
    </LogPopup>
  );
}

export function LogJumpPopup({
  repo,
  snapshot,
  anchor,
  onClose,
  onJump,
}: {
  repo: string;
  snapshot: RepoSnapshot;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  onJump: (location: LogLocation, commit: Commit) => void;
}) {
  const [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const jump = async (ref: string) => {
    if (!ref.trim() || busy) return;
    const id = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const commit = await request<Commit>("logResolve", repo, {
        ref: ref.trim(),
      });
      const location = await request<LogLocation>("logLocate", repo, {
        ref: commit.hash,
      });
      if (id !== generation.current) return;
      onJump(location, commit);
      onClose();
    } catch (cause) {
      if (id === generation.current) setError((cause as Error).message);
    } finally {
      if (id === generation.current) setBusy(false);
    }
  };
  const choices = [
    ...snapshot.branches.map((branch) => ({
      value: branch.ref,
      name: branch.name,
    })),
    ...snapshot.tags.map((tag) => ({
      value: `refs/tags/${tag.name}`,
      name: tag.name,
    })),
  ]
    .filter((item) =>
      item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .slice(0, 80);
  return (
    <LogPopup anchor={anchor} title="转到哈希 / 分支 / 标签" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void jump(query);
        }}
      >
        <div className="input-shell log-popup-search">
          <Search size={14} />
          <input
            autoFocus
            aria-label="目标提交或引用"
            placeholder="提交哈希、分支或标签"
            value={query}
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value);
              setError("");
            }}
          />
        </div>
        {error && (
          <div className="log-popup-error error-text" role="alert">
            {error}
          </div>
        )}
        <div className="log-jump-options">
          <button
            type="button"
            disabled={busy}
            onClick={() => void jump("HEAD")}
          >
            HEAD · 当前提交
          </button>
          {choices.map((choice) => (
            <button
              type="button"
              disabled={busy}
              key={choice.value}
              title={choice.value}
              onClick={() => void jump(choice.value)}
            >
              {choice.name}
            </button>
          ))}
        </div>
        <div className="log-popup-actions">
          <button
            className="primary small"
            type="submit"
            disabled={busy || !query.trim()}
          >
            {busy && <Spinner />}转到
          </button>
        </div>
      </form>
    </LogPopup>
  );
}
