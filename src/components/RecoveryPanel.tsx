import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  RefreshCw,
} from "lucide-react";
import type { OperationSummary } from "../../shared/commit-workspace";
import { request } from "../api";
import type { ShelfPanelProps } from "./ShelfPanel";
import { dateTime, Empty, IconButton, Spinner } from "./ui";
import "../shelf.css";

export type RecoveryPanelProps = Pick<
  ShelfPanelProps,
  | "repo"
  | "workspace"
  | "busy"
  | "mutate"
  | "openPreview"
  | "saveArchive"
  | "confirm"
>;
const complete = (record: OperationSummary) =>
  ["completed", "rolled-back"].includes(record.state);
const kindNames: Record<string, string> = {
  "shelf.create": "搁置清理",
  "shelf.apply": "搁置恢复",
  "file.trash": "文件回收",
  "file.rollback": "文件回滚",
  commit: "提交索引同步",
  corrupted: "损坏的恢复记录",
};
const stageNames: Record<string, string> = {
  prepared: "备份已准备",
  applying: "文件改写中",
  completed: "已完成",
  "rolled-back": "已回滚",
  "recovery-required": "需要恢复",
  "committed-index-pending": "提交已创建，待同步索引",
  corrupted: "记录损坏",
};
const kindName = (kind: string) => kindNames[kind] || kind;
const stageName = (state: string) => stageNames[state] || state;

export function RecoveryPanel(props: RecoveryPanelProps) {
  return <RecoverySession key={props.repo} {...props} />;
}
function RecoverySession({
  repo,
  workspace,
  busy,
  mutate,
  openPreview,
  saveArchive,
  confirm,
}: RecoveryPanelProps) {
  const [records, setRecords] = useState<OperationSummary[]>(workspace.pending),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [expanded, setExpanded] = useState<string[]>([]),
    [showHistory, setShowHistory] = useState(false),
    [limit, setLimit] = useState(100);
  const [fileLimits, setFileLimits] = useState<Record<string, number>>({});
  const session = useRef({ active: true, generation: 0 });
  const mutationInFlight = useRef(false);
  const live = useRef({ workspace, records, busy });
  live.current = { workspace, records, busy };
  useEffect(() => {
    session.current.active = true;
    return () => {
      session.current.active = false;
      session.current.generation++;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void request<OperationSummary[]>("operationRecovery", repo)
      .then((value) => {
        if (current) setRecords(value);
      })
      .catch((reason) => {
        if (current) setError(reason.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [repo, workspace.revision, workspace.pending, busy, reload]);
  const pending = [
    ...workspace.pending,
    ...records.filter(
      (record) =>
        !complete(record) &&
        !workspace.pending.some((item) => item.id === record.id),
    ),
  ];
  const history = records.filter(complete),
    visible = [...pending, ...(showHistory ? history.slice(0, limit) : [])];
  function recover(record: OperationSummary, direction: "before" | "after") {
    const token = session.current.generation;
    let applied = false;
    confirm(
      direction === "after" ? "完成中断操作" : "恢复操作前内容",
      direction === "after"
        ? `继续“${kindName(record.kind)}”，完成 ${record.paths.length} 条路径的操作。${record.commitHash ? `提交 ${record.commitHash.slice(0, 12)} 已创建，只会同步索引。` : ""}执行前会再次校验内容；存在外部新改动时停止。`
        : `从备份恢复“${kindName(record.kind)}”之前的 ${record.paths.length} 条路径内容及索引。执行前会校验当前内容，存在外部新改动时停止。`,
      async () => {
        if (!session.current.active || session.current.generation !== token)
          throw new Error("仓库或页面已变化，请关闭确认后重新操作。");
        if (applied || mutationInFlight.current || live.current.busy)
          return false;
        const current = [
          ...live.current.workspace.pending,
          ...live.current.records,
        ].find((item) => item.id === record.id);
        if (!current || current.state !== record.state)
          throw new Error("操作状态已变化，请取消后刷新并重新确认。");
        if (complete(record) && live.current.workspace.pending.length > 0)
          throw new Error("请先处理未完成的操作，再恢复历史备份。");
        mutationInFlight.current = true;
        try {
          const ok = await mutate("operation.recover", {
            id: record.id,
            direction,
            expectedRevision: workspace.revision,
          });
          applied = ok;
          if (ok && session.current.active) setReload((value) => value + 1);
          if (!ok)
            throw new Error(
              "恢复未完成，请查看操作提示；材料仍保留，可刷新后重试。",
            );
          return ok;
        } finally {
          mutationInFlight.current = false;
        }
      },
    );
  }
  return (
    <section
      className={`recovery-panel ${pending.length ? "has-pending" : ""}`}
      aria-label="操作恢复与备份"
    >
      <header className="recovery-heading">
        <ArchiveRestore size={15} />
        <strong>
          {pending.length ? `待恢复操作 · ${pending.length}` : "恢复与备份"}
        </strong>
        <IconButton
          title="刷新恢复记录"
          disabled={loading}
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw size={13} />
        </IconButton>
      </header>
      {pending.length > 0 && (
        <p className="shelf-notice">
          操作尚未完成，Git
          写操作已暂停。请选择完成操作或从备份回滚；已创建的提交只能完成索引同步。
        </p>
      )}
      {error && (
        <div className="shelf-notice error" role="alert">
          {error}
          <button onClick={() => setReload((value) => value + 1)}>重试</button>
        </div>
      )}
      {loading && records.length === 0 && (
        <div className="group-empty">
          <Spinner /> 正在读取备份…
        </div>
      )}
      <div className="recovery-records">
        {!loading && !error && !pending.length && !showHistory && (
          <Empty title="没有待恢复操作">
            已完成的回收和回滚备份可在下方展开。
          </Empty>
        )}
        {visible.map((record) => {
          const open = expanded.includes(record.id),
            corrupted = record.kind === "corrupted",
            done = complete(record),
            paths = record.paths || [],
            fileLimit = fileLimits[record.id] || 100;
          return (
            <article key={record.id} className="recovery-record">
              <button
                className="recovery-record-title"
                aria-expanded={open}
                onClick={() =>
                  setExpanded((previous) =>
                    open
                      ? previous.filter((id) => id !== record.id)
                      : [...previous, record.id],
                  )
                }
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>{kindName(record.kind)}</span>
                <span className={`recovery-stage ${done ? "muted" : ""}`}>
                  {stageName(record.state)}
                </span>
              </button>
              <div className="recovery-meta">
                {dateTime(record.createdAt)} · {paths.length} 条路径
                {record.commitHash && (
                  <span className="recovery-hash">
                    提交 {record.commitHash}
                  </span>
                )}
              </div>
              {open && (
                <div className="recovery-detail">
                  <p className={corrupted ? "shelf-error" : "muted"}>
                    {record.message || "原始备份已保留。"}
                  </p>
                  {corrupted ? (
                    <p className="muted">
                      记录无法读取，已禁用自动恢复。请保留原始备份材料。
                    </p>
                  ) : (
                    <>
                      <div className="shelf-actions">
                        {!done && (
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => recover(record, "after")}
                          >
                            完成操作
                          </button>
                        )}
                        {record.kind !== "commit" && (
                          <button
                            disabled={busy || (done && pending.length > 0)}
                            onClick={() => recover(record, "before")}
                          >
                            {done ? "从备份恢复…" : "回滚操作…"}
                          </button>
                        )}
                      </div>
                      {paths.slice(0, fileLimit).map((path) => (
                        <div className="recovery-file" key={path}>
                          <span title={path}>{path}</span>
                          {record.kind !== "commit" && (
                            <>
                              <IconButton
                                title={`预览 ${path} 的备份差异`}
                                onClick={() =>
                                  openPreview({
                                    kind: "operation",
                                    id: record.id,
                                    path,
                                  })
                                }
                              >
                                <Eye size={13} />
                              </IconButton>
                              <IconButton
                                title={`另存 ${path} 的操作前内容`}
                                onClick={() =>
                                  saveArchive({
                                    source: "operation",
                                    id: record.id,
                                    path,
                                    version: "before",
                                  })
                                }
                              >
                                <Download size={13} />
                              </IconButton>
                              <button
                                title="另存操作目标内容"
                                onClick={() =>
                                  saveArchive({
                                    source: "operation",
                                    id: record.id,
                                    path,
                                    version: "after",
                                  })
                                }
                              >
                                目标
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                      {paths.length > fileLimit && (
                        <button
                          className="shelf-more"
                          onClick={() =>
                            setFileLimits((previous) => ({
                              ...previous,
                              [record.id]: fileLimit + 100,
                            }))
                          }
                        >
                          再显示 100 条路径（还有 {paths.length - fileLimit}{" "}
                          条）
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <button
        className="recovery-history-toggle"
        aria-expanded={showHistory}
        onClick={() => setShowHistory((value) => !value)}
      >
        {showHistory ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        已完成操作的备份（{history.length}）
      </button>
      {showHistory && history.length === 0 && !loading && (
        <p className="group-empty">还没有可用的操作备份。</p>
      )}
      {showHistory && history.length > limit && (
        <button
          className="shelf-more"
          onClick={() => setLimit((value) => value + 100)}
        >
          再显示 100 条记录
        </button>
      )}
    </section>
  );
}
