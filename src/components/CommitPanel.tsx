import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  Eye,
  MoreVertical,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import type { Change, RepoSnapshot } from "../../shared/types";
import { Popover } from "./Dialogs";
import {
  ChangeFileRow,
  isStaged,
  isUnstaged,
  StageCheckbox,
  UntrackedBrowser,
} from "./CommitFiles";
import { CommitMessage } from "./CommitMessage";
import { Presence } from "./Motion";
import { Empty, IconButton, PanelHeader } from "./ui";

export { isStaged, isUnstaged } from "./CommitFiles";

export function CommitPanel({
  snapshot: s,
  busy,
  mutate,
  openDiff,
  refresh,
  confirm,
  settings,
  stash,
  activePath,
}: {
  snapshot: RepoSnapshot | null;
  busy: boolean;
  mutate: (
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<boolean>;
  openDiff: (path: string, staged?: boolean) => void;
  refresh: () => void;
  confirm: (
    title: string,
    message: string,
    action: () => Promise<unknown>,
  ) => void;
  settings: () => void;
  stash: () => void;
  activePath?: string;
}) {
  const [workingOpen, setWorkingOpen] = useState(true),
    [visibleCount, setVisibleCount] = useState(100);
  const [selected, setSelected] = useState(""),
    [moreOpen, setMoreOpen] = useState(false);
  const [browser, setBrowser] = useState<{ path?: string } | null>(null);
  const menuAnchor = useRef<HTMLDivElement>(null),
    rows = useRef(new Map<string, HTMLDivElement>());
  const pendingLocate = useRef("");
  const { tracked, untracked, staged, unstaged } = useMemo(() => {
    const changes = s?.changes || [];
    return {
      tracked: changes.filter((c) => c.index !== "?"),
      untracked: changes.filter((c) => c.index === "?"),
      staged: changes.filter(isStaged),
      unstaged: changes.filter(isUnstaged),
    };
  }, [s?.changes]);
  const eligible = tracked.filter((c) => !c.conflict),
    included = eligible.filter(isStaged);
  const allStaged =
    Boolean(eligible.length) &&
    eligible.every((c) => isStaged(c) && !isUnstaged(c));
  const mixed = Boolean(included.length) && !allStaged;
  const current = s?.changes.find((c) => c.path === selected),
    active = s?.changes.find((c) => c.path === activePath);
  useEffect(() => {
    setSelected("");
    setMoreOpen(false);
    setBrowser(null);
    setWorkingOpen(true);
    setVisibleCount(100);
    pendingLocate.current = "";
  }, [s?.root]);
  useLayoutEffect(() => {
    const node = rows.current.get(pendingLocate.current);
    if (node) {
      node.scrollIntoView({ block: "nearest" });
      node
        .querySelector<HTMLButtonElement>(".change-file")
        ?.focus({ preventScroll: true });
      pendingLocate.current = "";
    }
  }, [workingOpen, visibleCount, selected]);
  function discard(change: Change) {
    confirm(
      "丢弃未暂存改动",
      `文件：${change.path}\n${change.index === "?" ? "该文件尚未被 Git 托管，将从磁盘删除。" : "未暂存的改动将被丢弃，已暂存的内容会保留。"}`,
      () => mutate("discard", { paths: [change.path] }),
    );
  }
  function resolve(change: Change) {
    confirm(
      "标记冲突已解决",
      `确认已编辑并保存 ${change.path}，且已经移除所有冲突标记？`,
      () => mutate("resolve", { paths: [change.path] }),
    );
  }
  function locate() {
    if (!active) return;
    setSelected(active.path);
    if (active.index === "?") setBrowser({ path: active.path });
    else {
      pendingLocate.current = active.path;
      setWorkingOpen(true);
      setVisibleCount(Math.max(visibleCount, tracked.indexOf(active) + 1));
      const node = rows.current.get(active.path);
      if (node) {
        node.scrollIntoView({ block: "nearest" });
        node
          .querySelector<HTMLButtonElement>(".change-file")
          ?.focus({ preventScroll: true });
        pendingLocate.current = "";
      }
    }
  }
  return (
    <section className="commit-panel panel">
      <PanelHeader title="提交" count={s?.changes.length || 0}>
        <div className="popover-anchor" ref={menuAnchor}>
          <IconButton
            title="更多更改操作"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            <MoreVertical size={15} />
          </IconButton>
          <Popover
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            label="更改操作"
            anchor={menuAnchor}
            className="commit-panel-menu"
          >
            <button
              role="menuitem"
              disabled={busy || !unstaged.some((c) => !c.conflict)}
              onClick={() => {
                setMoreOpen(false);
                const paths = unstaged
                  .filter((c) => !c.conflict)
                  .map((c) => c.path);
                if (paths.length) void mutate("stage", { paths });
              }}
            >
              暂存所有更改（含未托管文件）
            </button>
            <button
              role="menuitem"
              disabled={busy || !staged.length}
              onClick={() => {
                setMoreOpen(false);
                void mutate("unstage");
              }}
            >
              取消全部暂存
            </button>
            <button
              role="menuitem"
              disabled={!untracked.length}
              onClick={() => {
                setMoreOpen(false);
                setBrowser({});
              }}
            >
              浏览未托管文件…
            </button>
            <div className="menu-divider" />
            <button
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                settings();
              }}
            >
              提交设置…
            </button>
          </Popover>
        </div>
      </PanelHeader>
      <div className="panel-toolbar commit-toolbar">
        <IconButton title="刷新更改" disabled={busy || !s} onClick={refresh}>
          <RefreshCw size={15} />
        </IconButton>
        <IconButton
          title="回滚选中文件的未暂存改动…"
          disabled={
            busy || !current || !isUnstaged(current) || current.conflict
          }
          onClick={() => current && discard(current)}
        >
          <RotateCcw size={15} />
        </IconButton>
        <IconButton
          title={
            current && isStaged(current) ? "取消暂存选中文件" : "暂存选中文件"
          }
          disabled={busy || !current || current.conflict}
          onClick={() =>
            current &&
            void mutate(isStaged(current) ? "unstage" : "stage", {
              paths: [current.path],
            })
          }
        >
          <ArrowLeftRight size={16} />
        </IconButton>
        <IconButton
          title="储藏全部更改…"
          disabled={
            busy ||
            !s?.changes.length ||
            s.changes.some((c) => c.conflict) ||
            Boolean(s.operation)
          }
          onClick={stash}
        >
          <Archive size={15} />
        </IconButton>
        <IconButton
          title="查看选中文件差异"
          disabled={!current}
          onClick={() =>
            current &&
            openDiff(current.path, !isUnstaged(current) && isStaged(current))
          }
        >
          <Eye size={16} />
        </IconButton>
        <span className="toolbar-divider" />
        <IconButton
          title="定位当前文件的更改"
          disabled={!active}
          onClick={locate}
        >
          <Crosshair size={15} />
        </IconButton>
        <IconButton
          title="展开所有更改"
          disabled={!tracked.length}
          onClick={() => {
            setWorkingOpen(true);
          }}
        >
          <ChevronsUpDown size={15} />
        </IconButton>
        <IconButton
          title="收起所有更改"
          disabled={!tracked.length}
          onClick={() => setWorkingOpen(false)}
        >
          <ChevronsDownUp size={15} />
        </IconButton>
      </div>
      {s?.operation && (
        <div className="operation-banner">
          <AlertTriangle size={14} />
          <span>正在进行 {s.operation}</span>
          <button
            disabled={busy}
            onClick={() =>
              confirm(
                "中止 Git 操作",
                `中止当前的 ${s.operation} 操作并恢复原状态？`,
                () => mutate("operation.abort", { operation: s.operation }),
              )
            }
          >
            中止
          </button>
          <button
            disabled={busy || s.changes.some((c) => c.conflict)}
            onClick={() =>
              void mutate("operation.continue", { operation: s.operation })
            }
          >
            继续
          </button>
        </div>
      )}
      <div className="changes-scroll">
        {Boolean(tracked.length) && (
          <section className="commit-change-group">
            <div className="commit-group-heading">
              <IconButton
                title={workingOpen ? "收起更改" : "展开更改"}
                aria-expanded={workingOpen}
                onClick={() => setWorkingOpen(!workingOpen)}
              >
                <ChevronRight
                  size={13}
                  className={workingOpen ? "rotate" : ""}
                />
              </IconButton>
              <StageCheckbox
                label="暂存或取消暂存全部已托管更改"
                checked={allStaged}
                mixed={mixed}
                disabled={busy || !eligible.length}
                onChange={(checked) => {
                  const paths = (
                    checked ? eligible.filter(isUnstaged) : included
                  ).map((c) => c.path);
                  if (paths.length)
                    void mutate(checked ? "stage" : "unstage", { paths });
                }}
              />
              <button
                className="commit-group-label"
                aria-expanded={workingOpen}
                onClick={() => setWorkingOpen(!workingOpen)}
              >
                更改
                <span className="muted">
                  {tracked.length.toLocaleString("zh-CN")} 个文件
                </span>
              </button>
            </div>
            {workingOpen &&
              tracked.slice(0, visibleCount).map((c) => (
                <ChangeFileRow
                  key={c.path}
                  change={c}
                  busy={busy}
                  selected={selected === c.path}
                  rowRef={(node) => {
                    if (node) rows.current.set(c.path, node);
                    else rows.current.delete(c.path);
                  }}
                  onSelect={() => setSelected(c.path)}
                  onStage={(stage) =>
                    void mutate(stage ? "stage" : "unstage", {
                      paths: [c.path],
                    })
                  }
                  onDiff={(stage) => openDiff(c.path, stage)}
                  onDiscard={() => discard(c)}
                  onResolve={() => resolve(c)}
                />
              ))}
            {workingOpen && tracked.length > visibleCount && (
              <button
                className="more-changes"
                onClick={() => setVisibleCount(visibleCount + 100)}
              >
                显示更多（剩余{" "}
                {(tracked.length - visibleCount).toLocaleString("zh-CN")} 个）
              </button>
            )}
          </section>
        )}
        {Boolean(untracked.length) && (
          <div className="untracked-summary">
            <span>未进行版本管理的文件</span>
            <span className="muted">
              {untracked.length.toLocaleString("zh-CN")} 个文件
            </span>
            <button onClick={() => setBrowser({})}>浏览</button>
          </div>
        )}
        {s && !s.changes.length && (
          <Empty
            icon={<Check size={26} className="green" />}
            title="工作区干净"
          >
            <span>所有更改均已提交</span>
          </Empty>
        )}
        {!s && <Empty title="尚未打开仓库" />}
      </div>
      <CommitMessage
        snapshot={s}
        stagedCount={staged.length}
        {...{ busy, mutate, confirm, settings }}
      />
      {createPortal(
        <Presence>
          {browser && (
            <UntrackedBrowser
              changes={untracked}
              busy={busy}
              initialPath={browser.path}
              selected={selected}
              onSelect={setSelected}
              {...{ mutate, openDiff }}
              onDiscard={(c) => {
                setBrowser(null);
                discard(c);
              }}
              onClose={() => setBrowser(null)}
            />
          )}
        </Presence>,
        document.body,
      )}
    </section>
  );
}
