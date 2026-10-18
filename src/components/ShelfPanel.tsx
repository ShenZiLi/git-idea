import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import type {
  ShelfFile,
  ShelfPage,
  ShelfRecord,
  WorkspacePreview,
  WorkspaceState,
} from "../../shared/commit-workspace";
import { request } from "../api";
import { Modal } from "./Dialogs";
import { LogPopup } from "./LogDialogs";
import { dateTime, Empty, FileIcon, IconButton, Spinner } from "./ui";
import "../shelf.css";

export interface ShelfPanelProps {
  repo: string;
  workspace: WorkspaceState;
  busy: boolean;
  prepare?: () => Promise<boolean>;
  mutate: (
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<boolean>;
  refresh: () => void;
  openPreview: (source: Record<string, unknown>) => void;
  saveArchive: (params: Record<string, unknown>) => void;
  confirm: (
    title: string,
    message: string,
    action: () => Promise<unknown>,
  ) => void;
}
type ApplySelection = {
  record: ShelfRecord;
  files: ShelfFile[];
  preview: WorkspacePreview;
  targetListId: string;
  copy: boolean;
  restoreIndex: boolean;
};
const states = [
  { id: "active", label: "搁置记录" },
  { id: "applied", label: "已应用" },
  { id: "deleted", label: "最近删除" },
] as const;
const statusNames = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  renamed: "重命名",
};

export function ShelfPanel(props: ShelfPanelProps) {
  // The keyed session also discards selections and in-flight reads on repository changes.
  return <ShelfSession key={props.repo} {...props} />;
}
function ShelfSession({
  repo,
  workspace,
  busy,
  prepare,
  mutate,
  refresh,
  openPreview,
  saveArchive,
  confirm,
}: ShelfPanelProps) {
  const [state, setState] = useState<ShelfRecord["state"]>("active");
  const [page, setPage] = useState<ShelfPage>({
    records: [],
    total: 0,
    hasMore: false,
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0),
    [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [limit, setLimit] = useState(100);
  const [rename, setRename] = useState<ShelfRecord | null>(null),
    [name, setName] = useState("");
  const [preparing, setPreparing] = useState(false),
    [apply, setApply] = useState<ApplySelection | null>(null);
  const [menu, setMenu] = useState<ShelfRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const session = useRef({ active: true, generation: 0 });
  const mutationInFlight = useRef(false),
    preparationInFlight = useRef(false);
  const pageReadInFlight = useRef(false);
  const live = useRef({ workspace, busy, state, activeId, selected, page });
  live.current = { workspace, busy, state, activeId, selected, page };
  useEffect(() => {
    session.current.active = true;
    return () => {
      session.current.active = false;
      session.current.generation++;
    };
  }, []);
  const generation = useRef(0),
    anchor = useRef("");
  const working = busy || submitting;
  const locked = working || preparing || workspace.pending.length > 0;
  useEffect(() => {
    let current = true;
    const token = ++generation.current;
    setLoading(true);
    setError("");
    setMenu(null);
    void request<ShelfPage>("shelves", repo, { state })
      .then((value) => {
        if (!current || token !== generation.current) return;
        setPage(value);
        setActiveId((id) =>
          value.records.some((record) => record.id === id) ? id : "",
        );
        setSelected((previous) =>
          previous.filter((id) =>
            value.records.some((item) =>
              item.files.some((file) => file.id === id),
            ),
          ),
        );
        setLimit(100);
      })
      .catch((reason) => {
        if (current && token === generation.current) setError(reason.message);
      })
      .finally(() => {
        if (current && token === generation.current) setLoading(false);
      });
    return () => {
      current = false;
      generation.current++;
    };
  }, [repo, state, reload, workspace.revision, busy]);
  const record = page.records.find((item) => item.id === activeId);
  const needle = query.trim().toLocaleLowerCase();
  const records = useMemo(
    () =>
      page.records.filter(
        (item) =>
          !needle ||
          item.name.toLocaleLowerCase().includes(needle) ||
          item.files.some((file) =>
            `${file.path}\n${file.oldPath || ""}`
              .toLocaleLowerCase()
              .includes(needle),
          ),
      ),
    [page.records, needle],
  );
  const files =
    record?.files.filter(
      (file) =>
        !needle ||
        record.name.toLocaleLowerCase().includes(needle) ||
        `${file.path}\n${file.oldPath || ""}`
          .toLocaleLowerCase()
          .includes(needle),
    ) || [];
  const selectedFiles =
    record?.files.filter((file) => selected.includes(file.id)) || [];
  const hiddenCount = selectedFiles.filter(
    (file) => !files.some((visible) => visible.id === file.id),
  ).length;
  function refreshHere() {
    setReload((value) => value + 1);
    refresh();
  }
  async function update(
    action: string,
    item: ShelfRecord,
    extra: Record<string, unknown> = {},
  ) {
    if (
      !session.current.active ||
      mutationInFlight.current ||
      live.current.busy
    )
      return false;
    if (live.current.workspace.pending.length > 0) {
      setError("有未完成的操作，请先在恢复面板处理。");
      return false;
    }
    if (
      live.current.workspace.revision !==
      (extra.expectedRevision ?? workspace.revision)
    ) {
      setError("更改列表已变化，请取消后刷新并重新确认。");
      return false;
    }
    mutationInFlight.current = true;
    setSubmitting(true);
    setError("");
    try {
      const ok = await mutate(action, {
        id: item.id,
        expectedRevision: workspace.revision,
        expectedShelfRevision: item.revision,
        ...extra,
      });
      if (!session.current.active) return false;
      if (ok) setReload((value) => value + 1);
      else setError("操作未完成，请查看操作提示；如记录已变化，请取消后刷新。");
      return ok;
    } catch (reason) {
      if (session.current.active) setError((reason as Error).message);
      return false;
    } finally {
      mutationInFlight.current = false;
      if (session.current.active) setSubmitting(false);
    }
  }
  function selectRecord(item: ShelfRecord) {
    if (activeId === item.id) {
      setActiveId("");
      setSelected([]);
      return;
    }
    setActiveId(item.id);
    setSelected(
      item.files
        .filter((file) => item.state !== "active" || !file.applied)
        .map((file) => file.id),
    );
    setLimit(100);
    anchor.current = "";
  }
  function openMenu(item: ShelfRecord, target: HTMLElement, file?: ShelfFile) {
    menuAnchor.current = target;
    if (activeId !== item.id) {
      setActiveId(item.id);
      setSelected(
        item.files
          .filter((entry) => item.state !== "active" || !entry.applied)
          .map((entry) => entry.id),
      );
    }
    if (file && !selected.includes(file.id)) setSelected([file.id]);
    setMenu(item);
  }
  function menuAction(action: () => void) {
    setMenu(null);
    action();
  }
  function selectFile(file: ShelfFile, shift: boolean, additive: boolean) {
    if (shift && anchor.current) {
      const start = files.findIndex((item) => item.id === anchor.current),
        end = files.findIndex((item) => item.id === file.id);
      if (start >= 0 && end >= 0) {
        const range = files
          .slice(Math.min(start, end), Math.max(start, end) + 1)
          .map((item) => item.id);
        setSelected((previous) =>
          additive ? [...new Set([...previous, ...range])] : range,
        );
        return;
      }
    }
    anchor.current = file.id;
    setSelected((previous) =>
      additive
        ? previous.includes(file.id)
          ? previous.filter((id) => id !== file.id)
          : [...previous, file.id]
        : [file.id],
    );
  }
  async function prepareApply(copy: boolean) {
    if (
      !record ||
      !selectedFiles.length ||
      locked ||
      record.corrupted ||
      preparationInFlight.current
    )
      return;
    const token = session.current.generation;
    const fileIds = selectedFiles.map((file) => file.id);
    const current = () =>
      session.current.active &&
      token === session.current.generation &&
      live.current.state === state &&
      live.current.activeId === record.id &&
      live.current.selected.length === fileIds.length &&
      fileIds.every((id) => live.current.selected.includes(id));
    const paths = [
      ...new Set(
        selectedFiles.flatMap((file) => [
          file.path,
          ...(file.oldPath ? [file.oldPath] : []),
        ]),
      ),
    ];
    setPreparing(true);
    preparationInFlight.current = true;
    setError("");
    try {
      if (prepare && !(await prepare())) {
        if (current()) setError("自动保存未完成，请先处理编辑器的保存提示。");
        return;
      }
      if (!current()) return;
      if (live.current.busy || live.current.workspace.pending.length > 0)
        throw new Error("仓库正忙或有待恢复操作，请处理后重新确认。");
      const preview = await request<WorkspacePreview>(
        "workspacePreview",
        repo,
        { paths },
      );
      if (!current()) return;
      if (preview.revision !== live.current.workspace.revision)
        throw new Error("更改列表已变化，请刷新后重新确认。");
      setApply({
        record,
        files: selectedFiles,
        preview,
        targetListId: live.current.workspace.activeListId,
        copy,
        restoreIndex: false,
      });
    } catch (reason) {
      if (current()) setError((reason as Error).message);
    } finally {
      preparationInFlight.current = false;
      if (session.current.active) setPreparing(false);
    }
  }
  async function loadMore() {
    if (pageReadInFlight.current || loading) return;
    pageReadInFlight.current = true;
    const token = generation.current;
    setLoading(true);
    setError("");
    try {
      const value = await request<ShelfPage>("shelves", repo, {
        state,
        offset: page.records.length,
      });
      if (token === generation.current)
        setPage((previous) => ({
          ...value,
          records: [
            ...previous.records,
            ...value.records.filter(
              (item) =>
                !previous.records.some((existing) => existing.id === item.id),
            ),
          ],
        }));
    } catch (reason) {
      if (token === generation.current) setError((reason as Error).message);
    } finally {
      pageReadInFlight.current = false;
      if (token === generation.current) setLoading(false);
    }
  }
  function deleteRecord(item: ShelfRecord) {
    const token = session.current.generation;
    const revision = workspace.revision;
    const remove = async () => {
      if (!session.current.active || token !== session.current.generation)
        throw new Error("仓库或页面已变化，请关闭确认后重新操作。");
      if (live.current.workspace.revision !== revision)
        throw new Error("更改列表已变化，请取消后刷新并重新确认。");
      return update(
        item.state === "deleted" ? "shelf.purge" : "shelf.delete",
        item,
        item.state === "deleted" ? { confirmPermanent: true } : {},
      );
    };
    if (item.state === "deleted")
      confirm(
        "永久删除搁置",
        `永久删除“${item.name}”及其所有补丁和原始内容备份？此操作无法恢复，不会删除工作区文件。`,
        remove,
      );
    else
      confirm(
        "移到最近删除",
        `将“${item.name}”移到最近删除？归档内容仍会保留，可在最近删除中恢复。`,
        remove,
      );
  }
  const preview = (file: ShelfFile, staged = false) =>
    record &&
    openPreview({ kind: "shelf", id: record.id, fileId: file.id, staged });
  return (
    <section className="shelf-panel" aria-label="搁置管理">
      <div className="shelf-tabs" role="tablist" aria-label="搁置状态">
        {states.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={state === tab.id}
            className={state === tab.id ? "active" : ""}
            onClick={() => {
              setState(tab.id);
              setActiveId("");
              setSelected([]);
            }}
          >
            {tab.label}
          </button>
        ))}
        <IconButton title="刷新搁置" onClick={refreshHere} disabled={loading}>
          <RefreshCw size={14} />
        </IconButton>
      </div>
      <div className="shelf-search">
        <Search size={14} />
        <input
          aria-label="搜索搁置名称或路径"
          placeholder="搜索名称或路径"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(100);
          }}
        />
      </div>
      {needle && page.hasMore && (
        <div className="shelf-search-hint">
          正在搜索已加载的 {page.records.length}{" "}
          条记录；加载更多可扩大搜索范围。
        </div>
      )}
      {error && (
        <div className="shelf-notice error" role="alert">
          {error}
          <button onClick={refreshHere}>重试</button>
        </div>
      )}
      {workspace.pending.length > 0 && (
        <div className="shelf-notice">
          有未完成的操作，请先在恢复面板处理。搁置内容仍可预览和另存。
        </div>
      )}
      <div
        className="shelf-records"
        aria-busy={loading}
        onKeyDown={(event) => {
          if (
            (event.target as HTMLElement).matches("input,select,textarea") ||
            !record
          )
            return;
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "d" &&
            selectedFiles.length === 1 &&
            !record.corrupted
          ) {
            event.preventDefault();
            preview(selectedFiles[0]);
          }
        }}
      >
        {loading && !page.records.length ? (
          <div className="group-empty">
            <Spinner /> 正在读取搁置…
          </div>
        ) : !records.length ? (
          <Empty
            icon={<Archive size={23} />}
            title={
              query
                ? "没有匹配的搁置"
                : state === "deleted"
                  ? "最近删除为空"
                  : state === "applied"
                    ? "还没有已应用的记录"
                    : "还没有搁置记录"
            }
          >
            {state === "active" && !query
              ? "在提交页选择已托管文件，使用“搁置”保存改动。"
              : undefined}
          </Empty>
        ) : (
          records.map((item) => (
            <div
              key={item.id}
              className={`shelf-record ${activeId === item.id ? "selected" : ""}`}
            >
              <button
                className="shelf-record-title"
                aria-expanded={activeId === item.id}
                onClick={() => selectRecord(item)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openMenu(item, event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (event.key === "F2" && !locked && !item.corrupted) {
                    event.preventDefault();
                    setRename(item);
                    setName(item.name);
                  }
                  if (event.key === "Delete" && !locked && !item.corrupted) {
                    event.preventDefault();
                    deleteRecord(item);
                  }
                  if (
                    (event.shiftKey && event.key === "F10") ||
                    event.key === "ContextMenu"
                  ) {
                    event.preventDefault();
                    openMenu(item, event.currentTarget);
                  }
                }}
              >
                {activeId === item.id ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )}
                <Archive size={14} />
                <span className="shelf-record-name">{item.name}</span>
                <span className="count">{item.files.length}</span>
              </button>
              <div className="shelf-record-meta">
                {item.corrupted ? (
                  <span className="shelf-error">
                    内容损坏 · {item.corrupted}
                  </span>
                ) : (
                  <>
                    <span>{item.sourceBranch}</span>
                    <time>{dateTime(item.createdAt)}</time>
                    {item.files.some((file) => file.applied) && (
                      <span>
                        已应用{" "}
                        {item.files.filter((file) => file.applied).length}
                      </span>
                    )}
                  </>
                )}
              </div>
              {activeId === item.id && !item.corrupted && (
                <div
                  className="shelf-file-list"
                  role="group"
                  aria-label={`${item.name}的文件`}
                >
                  <label className="shelf-select-all">
                    <input
                      type="checkbox"
                      checked={
                        files.length > 0 &&
                        files.every((file) => selected.includes(file.id))
                      }
                      ref={(input) => {
                        if (input)
                          input.indeterminate =
                            files.some((file) => selected.includes(file.id)) &&
                            !files.every((file) => selected.includes(file.id));
                      }}
                      onChange={(event) =>
                        setSelected((previous) =>
                          event.target.checked
                            ? [
                                ...new Set([
                                  ...previous,
                                  ...files.map((file) => file.id),
                                ]),
                              ]
                            : previous.filter(
                                (id) => !files.some((file) => file.id === id),
                              ),
                        )
                      }
                    />
                    选择匹配文件<span className="muted">{files.length}</span>
                  </label>
                  {files.slice(0, limit).map((file) => (
                    <div
                      key={file.id}
                      className={`shelf-file ${selected.includes(file.id) ? "selected" : ""}`}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openMenu(
                          item,
                          event.currentTarget.querySelector<HTMLButtonElement>(
                            ".shelf-file-name",
                          )!,
                          file,
                        );
                      }}
                    >
                      <input
                        type="checkbox"
                        aria-label={`选择${file.path}`}
                        checked={selected.includes(file.id)}
                        onChange={() => selectFile(file, false, true)}
                      />
                      <button
                        className="shelf-file-name"
                        title={
                          file.oldPath
                            ? `${file.oldPath} → ${file.path}`
                            : file.path
                        }
                        onClick={(event) => {
                          selectFile(
                            file,
                            event.shiftKey,
                            event.ctrlKey || event.metaKey,
                          );
                          if (
                            !event.shiftKey &&
                            !event.ctrlKey &&
                            !event.metaKey
                          )
                            preview(file);
                        }}
                        onKeyDown={(event) => {
                          if (
                            (event.shiftKey && event.key === "F10") ||
                            event.key === "ContextMenu"
                          ) {
                            event.preventDefault();
                            openMenu(item, event.currentTarget, file);
                          }
                          if (event.key === "F2" && !locked) {
                            event.preventDefault();
                            setRename(item);
                            setName(item.name);
                          }
                          if (event.key === "Delete" && !locked) {
                            event.preventDefault();
                            deleteRecord(item);
                          }
                        }}
                      >
                        <FileIcon name={file.path} />
                        <span>
                          {file.oldPath && <small>{file.oldPath} → </small>}
                          {file.path}
                        </span>
                      </button>
                      <span className="shelf-file-status">
                        {file.applied ? "已应用" : statusNames[file.status]}
                        {file.binary ? " · 二进制" : ""}
                      </span>
                    </div>
                  ))}
                  {files.length > limit && (
                    <button
                      className="shelf-more"
                      onClick={() => setLimit((value) => value + 100)}
                    >
                      再显示 100 个文件（还有 {files.length - limit} 个）
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        {page.hasMore && (
          <button
            className="shelf-more"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            加载更多记录（已加载 {page.records.length} / {page.total}）
          </button>
        )}
      </div>
      {record && (
        <footer className="shelf-summary">
          <div className="shelf-summary-name">{record.name}</div>
          {record.corrupted ? (
            <p className="shelf-error">
              归档损坏，恢复和删除已禁用。请保留原始材料。
            </p>
          ) : (
            <>
              <div className="muted">
                已选 {selectedFiles.length} / {record.files.length} 个文件
                {hiddenCount > 0 ? `（其中 ${hiddenCount} 个被搜索隐藏）` : ""}
              </div>
              <div className="shelf-actions">
                {record.state === "deleted" ? (
                  <button
                    disabled={locked}
                    onClick={() => void update("shelf.restore", record)}
                  >
                    <Undo2 size={13} />
                    恢复到搁置
                  </button>
                ) : (
                  <>
                    <button
                      className="primary"
                      disabled={
                        locked ||
                        !selectedFiles.length ||
                        selectedFiles.every((file) => file.applied)
                      }
                      onClick={() => void prepareApply(false)}
                    >
                      <Undo2 size={13} />
                      取消搁置…
                    </button>
                    <button
                      disabled={locked || !selectedFiles.length}
                      onClick={() => void prepareApply(true)}
                    >
                      <Copy size={13} />
                      复制到工作区…
                    </button>
                  </>
                )}
                <IconButton
                  title="重命名搁置 F2"
                  disabled={locked}
                  onClick={() => {
                    setRename(record);
                    setName(record.name);
                  }}
                >
                  <Pencil size={14} />
                </IconButton>
                <IconButton
                  title={
                    record.state === "deleted" ? "永久删除…" : "移到最近删除…"
                  }
                  disabled={locked}
                  onClick={() => deleteRecord(record)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <div className="shelf-actions secondary">
                <button
                  disabled={selectedFiles.length !== 1}
                  onClick={() => preview(selectedFiles[0])}
                >
                  <Eye size={13} />
                  预览
                </button>
                <button
                  disabled={selectedFiles.length !== 1}
                  onClick={() => preview(selectedFiles[0], true)}
                >
                  暂存版本
                </button>
                <button
                  disabled={selectedFiles.length !== 1}
                  onClick={() =>
                    saveArchive({
                      source: "shelf",
                      id: record.id,
                      fileId: selectedFiles[0].id,
                      version: "working",
                    })
                  }
                >
                  <Download size={13} />
                  另存内容
                </button>
                <button
                  disabled={!selectedFiles.length}
                  onClick={() =>
                    saveArchive({
                      source: "shelf",
                      id: record.id,
                      fileIds: selectedFiles.map((file) => file.id),
                      format: "patch",
                    })
                  }
                >
                  导出补丁
                </button>
              </div>
            </>
          )}
        </footer>
      )}
      {menu && (
        <LogPopup
          anchor={menuAnchor}
          title="搁置操作"
          menu
          onClose={() => setMenu(null)}
        >
          <button
            role="menuitem"
            disabled={!!menu.corrupted || selectedFiles.length !== 1}
            onClick={() => menuAction(() => preview(selectedFiles[0]))}
          >
            预览差异<span>Ctrl+D</span>
          </button>
          {menu.state === "deleted" ? (
            <button
              role="menuitem"
              disabled={locked || !!menu.corrupted}
              onClick={() =>
                menuAction(() => {
                  void update("shelf.restore", menu);
                })
              }
            >
              恢复到搁置
            </button>
          ) : (
            <>
              <button
                role="menuitem"
                disabled={
                  locked ||
                  !!menu.corrupted ||
                  !selectedFiles.length ||
                  selectedFiles.every((file) => file.applied)
                }
                onClick={() =>
                  menuAction(() => {
                    void prepareApply(false);
                  })
                }
              >
                取消搁置…
              </button>
              <button
                role="menuitem"
                disabled={locked || !!menu.corrupted || !selectedFiles.length}
                onClick={() =>
                  menuAction(() => {
                    void prepareApply(true);
                  })
                }
              >
                复制到工作区…
              </button>
            </>
          )}
          <button
            role="menuitem"
            disabled={!!menu.corrupted || !selectedFiles.length}
            onClick={() =>
              menuAction(() =>
                saveArchive({
                  source: "shelf",
                  id: menu.id,
                  fileIds: selectedFiles.map((file) => file.id),
                  format: "patch",
                }),
              )
            }
          >
            导出补丁
          </button>
          <button
            role="menuitem"
            disabled={locked || !!menu.corrupted}
            onClick={() =>
              menuAction(() => {
                setRename(menu);
                setName(menu.name);
              })
            }
          >
            重命名<span>F2</span>
          </button>
          <button
            role="menuitem"
            disabled={locked || !!menu.corrupted}
            onClick={() => menuAction(() => deleteRecord(menu))}
          >
            {menu.state === "deleted" ? "永久删除…" : "移到最近删除…"}
            <span>Delete</span>
          </button>
        </LogPopup>
      )}
      {rename && (
        <Modal title="重命名搁置" onClose={() => !working && setRename(null)}>
          <form
            className="shelf-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void update("shelf.rename", rename, { name: name.trim() }).then(
                (ok) => {
                  if (ok) setRename(null);
                },
              );
            }}
          >
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <label>
              名称
              <input
                maxLength={100}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => setRename(null)}
                disabled={working}
              >
                取消
              </button>
              <button className="primary" disabled={working || !name.trim()}>
                保存
              </button>
            </div>
          </form>
        </Modal>
      )}
      {apply && (
        <Modal
          title={apply.copy ? "复制搁置到工作区" : "取消搁置并恢复"}
          onClose={() => !working && setApply(null)}
        >
          <form
            className="shelf-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                working ||
                workspace.pending.length > 0 ||
                workspace.revision !== apply.preview.revision
              )
                return;
              void update("shelf.apply", apply.record, {
                fileIds: apply.files.map((file) => file.id),
                targetListId: apply.targetListId,
                copy: apply.copy,
                restoreIndex: apply.restoreIndex,
                preview: apply.preview,
                expectedRevision: apply.preview.revision,
              }).then((ok) => {
                if (ok) setApply(null);
              });
            }}
          >
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {workspace.revision !== apply.preview.revision && (
              <div className="form-error" role="alert">
                更改列表已变化，请取消后刷新并重新确认。
              </div>
            )}
            <p>
              将“{apply.record.name}”的 {apply.files.length}{" "}
              个文件恢复到工作区。
              {apply.copy
                ? "原搁置保持可用。"
                : "成功恢复的文件会标记为已应用。"}
            </p>
            <label>
              目标更改列表
              <select
                value={apply.targetListId}
                onChange={(event) =>
                  setApply({ ...apply, targetListId: event.target.value })
                }
              >
                {workspace.lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                    {workspace.activeListId === list.id ? "（活动）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="shelf-check">
              <input
                type="checkbox"
                checked={apply.restoreIndex}
                onChange={(event) =>
                  setApply({ ...apply, restoreIndex: event.target.checked })
                }
              />
              同时恢复原暂存状态
            </label>
            <p className="muted">
              {apply.restoreIndex
                ? "所选目标路径的暂存区必须干净，其他文件的暂存内容会保留。"
                : "内容恢复到工作区，不自动暂存。"}
              若内容发生变化或不能安全应用，整批停止，请查看差异后手动合并。
            </p>
            <ul className="shelf-confirm-files">
              {apply.files.slice(0, 100).map((file) => (
                <li key={file.id}>
                  {file.oldPath ? `${file.oldPath} → ` : ""}
                  {file.path}
                </li>
              ))}
              {apply.files.length > 100 && (
                <li>另有 {apply.files.length - 100} 个文件</li>
              )}
            </ul>
            <div className="dialog-actions">
              <button
                type="button"
                disabled={working}
                onClick={() => setApply(null)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={
                  working ||
                  workspace.pending.length > 0 ||
                  workspace.revision !== apply.preview.revision
                }
              >
                {working ? "正在恢复…" : "确认恢复"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
