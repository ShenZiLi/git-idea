import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowRightLeft,
  GitCompareArrows,
  RefreshCw,
  Search,
} from "lucide-react";
import type { BranchCompareResult } from "../../shared/branch-compare";
import type {
  Branch,
  ChangedFile,
  CommitDetail,
  DiffData,
} from "../../shared/types";
import { request } from "../api";
import { diffRows } from "../diff";
import { Modal } from "./Dialogs";
import { dateTime, Empty, FileIcon, IconButton, Spinner } from "./ui";
import "../branch-compare.css";

interface Props {
  repo: string;
  branch: Branch;
  mode: "branches" | "worktree";
  onClose: () => void;
}
export function BranchCompare(props: Props) {
  const [reverse, setReverse] = useState(false);
  return (
    <Modal
      title={props.mode === "branches" ? "比较分支" : "显示与工作树的差异"}
      onClose={props.onClose}
      wide
    >
      <CompareSession
        key={`${props.repo}\0${props.branch.ref}\0${props.mode}\0${reverse}`}
        {...props}
        reverse={reverse}
        swap={() => setReverse((value) => !value)}
      />
    </Modal>
  );
}
function CompareSession({
  repo,
  branch,
  mode,
  reverse,
  swap,
}: Props & { reverse: boolean; swap: () => void }) {
  const [result, setResult] = useState<BranchCompareResult | null>(null);
  const [limit, setLimit] = useState(300);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commitHash, setCommitHash] = useState("");
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRevision, setDetailRevision] = useState(0);
  const [file, setFile] = useState<ChangedFile | null>(null);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<DiffData | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [fileRevision, setFileRevision] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setResult(null);
    setFile(null);
    setData(null);
    setCommitHash("");
    request<BranchCompareResult>("branchCompare", repo, {
      ref: branch.ref,
      mode,
      reverse,
      limit,
    })
      .then((value) => {
        if (current) {
          setResult(value);
          setFile(value.files[0] ?? null);
        }
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [repo, branch.ref, mode, reverse, limit, revision]);

  useEffect(() => {
    let current = true;
    setDetail(null);
    setDetailError("");
    setData(null);
    if (!commitHash) {
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    setFile(null);
    request<CommitDetail>("commitDetail", repo, { hash: commitHash })
      .then((value) => {
        if (current) {
          setDetail(value);
          setFile(value.files[0] ?? null);
        }
      })
      .catch((cause: Error) => {
        if (current) setDetailError(cause.message);
      })
      .finally(() => {
        if (current) setDetailLoading(false);
      });
    return () => {
      current = false;
    };
  }, [repo, commitHash, revision, detailRevision]);

  useEffect(() => {
    let current = true;
    setData(null);
    setFileError("");
    setFileLoading(false);
    if (!result || !file || (commitHash && detail?.commit.hash !== commitHash))
      return;
    setFileLoading(true);
    const query = commitHash
      ? request<DiffData>("diff", repo, {
          path: file.path,
          oldPath: file.oldPath,
          commit: commitHash,
        })
      : request<DiffData>("branchCompareFile", repo, {
          path: file.path,
          oldPath: file.oldPath,
          mode: result.mode,
          reverse: result.reverse,
          base: result.base,
          target: result.target,
        });
    query
      .then((value) => {
        if (current) setData(value);
      })
      .catch((cause: Error) => {
        if (current) setFileError(cause.message);
      })
      .finally(() => {
        if (current) setFileLoading(false);
      });
    return () => {
      current = false;
    };
  }, [repo, result, file, commitHash, detail, fileRevision]);

  const files = commitHash
    ? detail?.commit.hash === commitHash
      ? detail.files
      : []
    : (result?.files ?? []);
  const visibleFiles = files.filter((entry) =>
    `${entry.path}\n${entry.oldPath ?? ""}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  const totals = files.reduce(
    (sum, entry) => ({
      add: sum.add + entry.additions,
      del: sum.del + entry.deletions,
    }),
    { add: 0, del: 0 },
  );
  const refresh = () => {
    setResult(null);
    setFile(null);
    setData(null);
    setCommitHash("");
    setRevision((v) => v + 1);
  };
  const chooseCommit = (hash: string) => {
    if (hash === commitHash) return;
    setFile(null);
    setData(null);
    setDetail(null);
    setCommitHash(hash);
  };
  const allFiles = () => {
    if (!commitHash) return;
    setCommitHash("");
    setData(null);
    setFile(result?.files[0] ?? null);
  };
  return (
    <div className="branch-compare">
      <div className="compare-toolbar">
        <GitCompareArrows size={17} />
        <div className="compare-direction">
          <strong title={result?.base.hash}>
            {result?.base.label ??
              (mode === "worktree"
                ? reverse
                  ? "工作树"
                  : branch.name
                : reverse
                  ? branch.name
                  : "当前分支")}
          </strong>
          <ArrowRight size={15} />
          <strong title={result?.target.hash}>
            {result?.target.label ??
              (mode === "worktree"
                ? reverse
                  ? branch.name
                  : "工作树"
                : reverse
                  ? "当前分支"
                  : branch.name)}
          </strong>
        </div>
        <button onClick={swap}>
          <ArrowRightLeft size={14} />
          交换方向
        </button>
        <IconButton title="刷新比较" onClick={refresh}>
          <RefreshCw size={14} />
        </IconButton>
      </div>
      {loading ? (
        <div className="compare-status" role="status">
          <Spinner />
          读取比较…
        </div>
      ) : error ? (
        <div className="compare-status" role="alert">
          <span>{error}</span>
          <button onClick={refresh}>重试</button>
        </div>
      ) : (
        result && (
          <>
            <div className="compare-caption">
              {mode === "branches" ? (
                <span>
                  提交范围{" "}
                  <code>
                    {result.base.hash.slice(0, 8)}..
                    {result.target.hash.slice(0, 8)}
                  </code>{" "}
                  · 文件显示两端提交的差异
                </span>
              ) : (
                <span>
                  选中分支与磁盘内容比较 · 包含已暂存、未暂存和未托管文件 · 只读
                </span>
              )}
            </div>
            <div
              className={`compare-layout ${mode === "worktree" ? "worktree" : ""}`}
            >
              {mode === "branches" && (
                <section
                  className="compare-commits"
                  aria-label="比较范围的提交"
                >
                  <div className="compare-section-title">
                    <strong>提交</strong>
                    <span className="muted">
                      {result.commits.length}
                      {result.hasMore ? "+" : ""}
                    </span>
                  </div>
                  <button
                    className={`compare-all ${!commitHash ? "selected" : ""}`}
                    onClick={allFiles}
                  >
                    全部分支差异
                  </button>
                  <div className="compare-commit-scroll">
                    {result.commits.map((commit) => (
                      <button
                        key={commit.hash}
                        className={`compare-commit ${commitHash === commit.hash ? "selected" : ""}`}
                        onClick={() => chooseCommit(commit.hash)}
                        title={`${commit.subject}\n${commit.author} · ${dateTime(commit.date)}`}
                      >
                        <strong>{commit.subject}</strong>
                        <span>
                          <code>{commit.hash.slice(0, 8)}</code> ·{" "}
                          {commit.author}
                        </span>
                        <time>{dateTime(commit.date, true)}</time>
                      </button>
                    ))}
                    {!result.commits.length && (
                      <div className="group-empty">
                        目标分支没有独有提交；仍可查看两端文件差异。
                      </div>
                    )}
                    {result.hasMore && (
                      <button
                        className="compare-load"
                        onClick={() => {
                          setResult(null);
                          setLimit((v) => Math.min(5000, v + 300));
                        }}
                      >
                        加载更多提交
                      </button>
                    )}
                    {result.commits.length >= 5000 && (
                      <div className="group-empty">已显示前 5,000 条提交</div>
                    )}
                  </div>
                </section>
              )}
              <section className="compare-files" aria-label="比较文件">
                <div className="compare-section-title">
                  <strong>
                    {commitHash ? `提交 ${commitHash.slice(0, 8)}` : "文件"}
                  </strong>
                  <span className="muted">{files.length}</span>
                </div>
                <label className="compare-search">
                  <Search size={14} />
                  <input
                    aria-label="搜索比较文件"
                    placeholder="搜索文件…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <div className="compare-file-summary">
                  <span className="green">+{totals.add}</span>
                  <span className="red">−{totals.del}</span>
                  <span className="muted">只读</span>
                </div>
                <div className="compare-file-scroll">
                  {detailLoading ? (
                    <div className="inline-loading">
                      <Spinner />
                      读取提交…
                    </div>
                  ) : detailError ? (
                    <div className="inline-warning" role="alert">
                      {detailError}
                      <button onClick={() => setDetailRevision((v) => v + 1)}>
                        重试
                      </button>
                    </div>
                  ) : (
                    visibleFiles.map((entry) => (
                      <button
                        key={entry.path}
                        className={`compare-file ${file?.path === entry.path ? "selected" : ""}`}
                        title={
                          entry.oldPath
                            ? `${entry.oldPath} → ${entry.path}`
                            : entry.path
                        }
                        onClick={() => {
                          if (entry === file) return;
                          setData(null);
                          setFile(entry);
                        }}
                      >
                        <FileIcon name={entry.path} />
                        <span className="compare-file-path">
                          {entry.path}
                          {entry.oldPath && <small>← {entry.oldPath}</small>}
                        </span>
                        <span className="compare-file-stat">
                          <span>{entry.status}</span>
                          <span className="green">+{entry.additions}</span>
                          <span className="red">−{entry.deletions}</span>
                        </span>
                      </button>
                    ))
                  )}
                  {!detailLoading && !detailError && !visibleFiles.length && (
                    <div className="group-empty">
                      {search ? "没有匹配的文件" : "没有文件差异"}
                    </div>
                  )}
                </div>
                {detail?.commit.hash === commitHash && (
                  <div className="compare-description">
                    <strong>{detail.commit.subject}</strong>
                    <span>
                      {detail.commit.author} · {dateTime(detail.commit.date)}
                    </span>
                    {detail.commit.body && <pre>{detail.commit.body}</pre>}
                  </div>
                )}
              </section>
              <section className="compare-diff" aria-label="只读文件差异">
                <div className="compare-section-title">
                  <strong title={file?.path}>{file?.path ?? "文件差异"}</strong>
                  <span className="muted">只读</span>
                </div>
                {fileLoading ? (
                  <div className="compare-status">
                    <Spinner />
                    读取差异…
                  </div>
                ) : fileError ? (
                  <div className="compare-status" role="alert">
                    <span>{fileError}</span>
                    <button onClick={() => setFileRevision((v) => v + 1)}>
                      重试
                    </button>
                  </div>
                ) : data ? (
                  <ReadonlyDiff data={data} />
                ) : (
                  <Empty title="选择文件查看差异" />
                )}
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
}
function ReadonlyDiff({ data }: { data: DiffData }) {
  const tooManyLines =
    data.before.split("\n").length + data.after.split("\n").length > 20000;
  const rows = useMemo(
    () =>
      data.binary || data.truncated || tooManyLines
        ? []
        : diffRows(data.before, data.after),
    [data, tooManyLines],
  );
  if (data.binary)
    return (
      <Empty title="二进制或非 UTF-8 文件">此文件不支持文本差异预览。</Empty>
    );
  if (data.truncated || tooManyLines)
    return (
      <Empty title="文件过大">
        文本预览上限为 2 MB，每次最多比较 20,000 行；请使用外部工具查看。
      </Empty>
    );
  return (
    <>
      <div className="compare-diff-labels">
        <span>− {data.beforeLabel}</span>
        <span>+ {data.afterLabel}</span>
      </div>
      <div className="compare-code" tabIndex={0} aria-label="只读差异内容">
        {!rows.length && (
          <div className="group-empty">
            没有文本内容变化；文件状态、权限或路径可能已变化。
          </div>
        )}
        {rows.map((row, index) =>
          row.kind === "same" ? (
            <div className="compare-code-line" key={index}>
              <span>{row.oldNumber}</span>
              <span>{row.newNumber}</span>
              <span> </span>
              <code>{row.after || " "}</code>
            </div>
          ) : (
            <div key={index}>
              {row.before !== undefined && (
                <div className="compare-code-line removed">
                  <span>{row.oldNumber}</span>
                  <span />
                  <span>−</span>
                  <code>{row.before || " "}</code>
                </div>
              )}
              {row.after !== undefined && (
                <div className="compare-code-line added">
                  <span />
                  <span>{row.newNumber}</span>
                  <span>+</span>
                  <code>{row.after || " "}</code>
                </div>
              )}
            </div>
          ),
        )}
      </div>
    </>
  );
}
