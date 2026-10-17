import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  Database,
  Download,
  FileDiff,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitPullRequestArrow,
  LayoutPanelLeft,
  Maximize2,
  Menu,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Square,
  Upload,
  X,
} from "lucide-react";
import type {
  Bootstrap,
  Branch,
  CommandLog,
  Commit,
  CommitDetail,
  RepoSnapshot,
} from "../shared/types";
import { normalizeUiScale, UI_SCALE_OPTIONS } from "../shared/types";
import { request } from "./api";
import { ProjectTree } from "./components/ProjectTree";
import { SidebarIcon } from "./components/SidebarIcon";
import { CommitPanel } from "./components/CommitPanel";
import { Editor, type EditorTab } from "./components/Editor";
import { BranchPanel } from "./components/BranchPanel";
import {
  CommitDetails,
  ConsolePanel,
  LogTable,
  StashPanel,
  type LogFilters,
} from "./components/LogPanel";
import {
  BranchSwitcher,
  ConfirmDialog,
  FormDialog,
  Modal,
  Popover,
  type ConfirmSpec,
  type FormSpec,
} from "./components/Dialogs";
import { BranchLabel, Empty, IconButton, Spinner } from "./components/ui";
import {
  IconSwap,
  Presence,
  useInputModality,
  useTheme,
} from "./components/Motion";
import {
  Notification,
  type NotificationMessage,
} from "./components/Notification";

const initialFilters: LogFilters = {
  search: "",
  ref: "",
  author: "",
  since: "",
  file: "",
  limit: 300,
};
export default function App() {
  const [repo, setRepo] = useState(""),
    [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null),
    [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [version, setVersion] = useState(0);
  const [tabs, setTabs] = useState<EditorTab[]>([]),
    [activeTab, setActiveTab] = useState(""),
    [selectedCommit, setSelectedCommit] = useState(""),
    [detail, setDetail] = useState<CommitDetail | null>(null);
  const [filters, setFilters] = useState<LogFilters>(initialFilters),
    [logs, setLogs] = useState<CommandLog[]>([]),
    [bottomTab, setBottomTab] = useState("log");
  const [projectVisible, setProjectVisible] = useState(true),
    [commitVisible, setCommitVisible] = useState(true),
    [logVisible, setLogVisible] = useState(true);
  const [form, setForm] = useState<FormSpec | null>(null),
    [confirmation, setConfirmation] = useState<ConfirmSpec | null>(null),
    [switcher, setSwitcher] = useState(false),
    [branchManage, setBranchManage] = useState<Branch | null>(null),
    [repoMenu, setRepoMenu] = useState(false),
    [mainMenu, setMainMenu] = useState(false),
    [help, setHelp] = useState(false);
  const [remoteDialog, setRemoteDialog] = useState(false),
    [editorDirty, setEditorDirty] = useState(false);
  const [toast, setToast] = useState<NotificationMessage | null>(null),
    [theme, setTheme] = useState("dark"),
    [uiScale, setUiScale] = useState(100),
    [fontSize, setFontSize] = useState(13),
    [uiFontFamily, setUiFontFamily] = useState(""),
    [editorFontFamily, setEditorFontFamily] = useState(""),
    [status, setStatus] = useState("就绪");
  const [widths, setWidths] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("git-idea-panels") || "{}") as {
        left?: number;
        right?: number;
        top?: number;
      };
    } catch {
      return {};
    }
  });
  const workbench = useRef<HTMLDivElement>(null),
    identityWrites = useRef<Promise<void>>(Promise.resolve()),
    refreshSequence = useRef(0),
    repoRef = useRef(""),
    filtersRef = useRef(filters),
    busyRef = useRef(false);
  useInputModality();
  useTheme(theme);
  filtersRef.current = filters;
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
  }, []);
  const refresh = useCallback(
    async (target = repoRef.current, values = filters, files = true) => {
      if (!target) return;
      const id = ++refreshSequence.current;
      setLoading(true);
      try {
        const next = await request<RepoSnapshot>("snapshot", target, {
          ...values,
        });
        if (id !== refreshSequence.current || target !== repoRef.current)
          return;
        setSnapshot(next);
        setSelectedCommit((current) =>
          next.commits.some((c) => c.hash === current)
            ? current
            : next.commits[0]?.hash || "",
        );
        if (files) setVersion((v) => v + 1);
        setStatus("已同步本地仓库");
        setLogs(await request<CommandLog[]>("logs"));
      } catch (e) {
        if (id === refreshSequence.current) notify((e as Error).message, true);
      } finally {
        if (id === refreshSequence.current) setLoading(false);
      }
    },
    [filters, notify],
  );
  async function openRepository(target: string) {
    try {
      if (editorDirty)
        throw new Error("请先保存或取消当前文件的编辑，再切换仓库。");
      const root = await request<string>("open", undefined, { path: target });
      repoRef.current = root;
      setRepo(root);
      setTabs([]);
      setActiveTab("");
      setSelectedCommit("");
      setDetail(null);
      setSnapshot(null);
      setFilters(initialFilters);
      setRecent((r) => [root, ...r.filter((p) => p !== root)].slice(0, 12));
      await refresh(root, initialFilters);
      setRepoMenu(false);
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    }
  }
  useEffect(() => {
    request<Bootstrap>("bootstrap")
      .then(async (boot) => {
        setRecent(boot.preferences.recent);
        setTheme(boot.preferences.theme || "dark");
        setUiScale(normalizeUiScale(boot.preferences.uiScale));
        setFontSize(boot.preferences.fontSize || 13);
        setUiFontFamily(boot.preferences.uiFontFamily || "");
        setEditorFontFamily(boot.preferences.editorFontFamily || "");
        const target = boot.defaultRepo || boot.preferences.lastRepo;
        if (target) await openRepository(target);
      })
      .catch((e) => notify(e.message, true));
  }, []);
  useEffect(() => {
    if (!repo) return;
    const timer = setTimeout(() => void refresh(repo, filters, false), 220);
    return () => clearTimeout(timer);
  }, [filters]);
  useEffect(() => {
    const focus = () => {
      if (
        repoRef.current &&
        !busyRef.current &&
        !document.querySelector('[role="dialog"]')
      )
        void refresh();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
  useEffect(() => {
    document.documentElement.style.setProperty("--font-size", `${fontSize}px`);
  }, [fontSize]);
  useEffect(() => {
    const root = document.documentElement;
    const applyFont = (property: string, value: string, fallback: string) => {
      const names = value
        .split(",")
        .map((name) => name.trim().replace(/^(['"])(.*)\1$/, "$2"))
        .filter(Boolean)
        .map((name) => JSON.stringify(name));
      root.style.setProperty(property, [...names, fallback].join(", "));
    };
    applyFont("--ui-font", uiFontFamily, "var(--default-ui-font)");
    applyFont("--code-font", editorFontFamily, "var(--default-code-font)");
  }, [uiFontFamily, editorFontFamily]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (editorDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editorDirty]);
  const mutate = useCallback(
    async (action: string, params: Record<string, unknown> = {}) => {
      if (busyRef.current || !repoRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setStatus(`正在执行 ${action}…`);
      let completed = false;
      try {
        const output = await request<string>("mutate", repoRef.current, {
          ...params,
          action,
        });
        completed = true;
        notify(output.trim().slice(0, 500) || "操作成功");
        return true;
      } catch (e) {
        notify((e as Error).message, true);
        return false;
      } finally {
        const current = filtersRef.current;
        let next = current;
        if (completed) {
          const targetRef =
            action === "tag.delete"
              ? `refs/tags/${params.name}`
              : `refs/heads/${params.name}`;
          if (
            ["branch.delete", "tag.delete", "branch.rename"].includes(action) &&
            current.ref === targetRef
          ) {
            next = {
              ...current,
              ref:
                action === "branch.rename"
                  ? `refs/heads/${params.newName}`
                  : "",
            };
            setFilters(next);
          }
        }
        await refresh(repoRef.current, next);
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refresh, notify],
  );
  const confirm = (
    title: string,
    message: string,
    action: () => Promise<unknown>,
  ) => setConfirmation({ title, message, action });
  function guardDraft(action: () => void) {
    if (editorDirty)
      confirm(
        "放弃未保存的编辑",
        "当前文件还有未保存的编辑，确认放弃并继续？",
        async () => {
          setEditorDirty(false);
          action();
        },
      );
    else action();
  }
  function openFile(file: string, options: Partial<EditorTab> = {}) {
    const tab: EditorTab = {
      path: file,
      kind: "file",
      ...options,
      id: `${options.kind || "file"}:${file}:${options.commit || ""}:${options.staged ? "staged" : ""}`,
    };
    guardDraft(() => {
      setTabs((current) =>
        current.some((t) => t.id === tab.id) ? current : [...current, tab],
      );
      setActiveTab(tab.id);
    });
  }
  const openDiff = (file: string, staged = false) =>
    openFile(file, { kind: "diff", staged });
  const closeTab = (id: string) =>
    guardDraft(() => {
      setTabs((current) => current.filter((t) => t.id !== id));
      setActiveTab((current) => (current === id ? "" : current));
    });
  function repoDialog(kind: "open" | "init" | "clone") {
    setRepoMenu(false);
    setMainMenu(false);
    setForm({
      title:
        kind === "open"
          ? "打开 Git 仓库"
          : kind === "init"
            ? "初始化 Git 仓库"
            : "克隆 Git 仓库",
      description:
        kind === "clone"
          ? "使用本机 Git 的 SSH 密钥或凭证管理器进行身份验证。"
          : kind === "init"
            ? "在目标目录创建 Git 仓库，默认分支为 main。"
            : "选择已有 Git 仓库的工作目录。",
      submitLabel:
        kind === "clone"
          ? "克隆并打开"
          : kind === "init"
            ? "初始化并打开"
            : "打开",
      fields: [
        ...(kind === "clone"
          ? [
              {
                key: "url",
                label: "仓库地址",
                placeholder: "https://… 或 git@…",
              },
            ]
          : []),
        {
          key: "path",
          label: kind === "clone" ? "目标目录" : "仓库目录",
          browse: true,
          placeholder: "输入完整的本地路径",
          value: kind === "open" ? repo : "",
        },
      ],
      onSubmit: async (values) => {
        if (kind === "open") return openRepository(values.path);
        const root = await request<string>(kind, undefined, values);
        return openRepository(root);
      },
    });
  }
  function createBranch(start = "") {
    setForm({
      title: "新建分支",
      description: "创建后自动切换到新分支。",
      submitLabel: "创建并检出",
      fields: [
        { key: "name", label: "分支名称", placeholder: "feature/my-change" },
        {
          key: "start",
          label: "起始提交或分支",
          value: start || (snapshot?.head ? "HEAD" : ""),
          required: false,
        },
      ],
      onSubmit: (values) => mutate("branch.create", values),
    });
  }
  function checkout(branch: Branch) {
    if (branch.current) return;
    void mutate("branch.checkout", {
      name: branch.name,
      remote: branch.remote,
    });
  }
  function createTag(hash = "HEAD") {
    setForm({
      title: "创建标签",
      fields: [
        { key: "name", label: "标签名称", placeholder: "v1.0.0" },
        { key: "ref", label: "提交或分支", value: hash },
      ],
      submitLabel: "创建标签",
      onSubmit: (values) => mutate("tag.create", values),
    });
  }
  function stash() {
    setForm({
      title: "储藏更改",
      description: "保存工作区和暂存区的更改，包含未跟踪文件。",
      fields: [
        {
          key: "message",
          label: "说明",
          placeholder: "正在进行的工作",
          required: false,
        },
      ],
      submitLabel: "储藏",
      onSubmit: async (values) => {
        const ok = await mutate("stash.save", values);
        if (ok) {
          setBottomTab("stash");
          setLogVisible(true);
        }
        return ok;
      },
    });
  }
  function push() {
    if (!snapshot) return;
    if (!snapshot.remotes.length) {
      remoteSettings();
      return;
    }
    if (snapshot.upstream)
      confirm(
        "推送提交",
        `将 ${snapshot.branch} 推送到 ${snapshot.upstream}。`,
        () => mutate("push"),
      );
    else
      setForm({
        title: "推送并设置上游",
        fields: [
          {
            key: "remote",
            label: "远程仓库",
            value: snapshot.remotes[0].name,
            options: snapshot.remotes.map((r) => ({
              value: r.name,
              label: `${r.name} · ${r.url}`,
            })),
          },
          { key: "branch", label: "本地分支", value: snapshot.branch },
        ],
        submitLabel: "推送",
        onSubmit: (values) => mutate("push", values),
      });
  }
  function remoteSettings() {
    setRemoteDialog(true);
  }
  function addRemote() {
    setRemoteDialog(false);
    setForm({
      title: "添加远程仓库",
      fields: [
        {
          key: "name",
          label: "远程名称",
          value: snapshot?.remotes.length ? "" : "origin",
        },
        { key: "url", label: "远程地址", placeholder: "https://… 或 git@…" },
      ],
      submitLabel: "添加远程",
      onSubmit: (values) => mutate("remote.add", values),
    });
  }
  function settings() {
    setMainMenu(false);
    const settingsRepo = repoRef.current;
    const persist = async (writing: Promise<unknown>) => {
      try {
        await writing;
      } catch (error) {
        notify(`设置未保存：${(error as Error).message}`, true);
        throw error;
      }
    };
    setForm({
      title: "设置",
      description: "外观更改立即生效并自动保存；提交身份仅对当前仓库生效。",
      fields: [
        {
          key: "theme",
          label: "外观模式",
          type: "theme",
          value: theme,
          options: [
            { value: "light", label: "亮色模式" },
            { value: "dark", label: "暗色模式" },
          ],
          hint: "液态玻璃外观 · 选择后立即应用，下次启动时保留。",
        },
        {
          key: "uiScale",
          label: "界面缩放",
          value: String(uiScale),
          options: UI_SCALE_OPTIONS.map((percent) => ({
            value: String(percent),
            label: `${percent}%`,
          })),
          hint: "统一调整文字、图标和所有面板的大小；选择后立即应用，默认 100%。",
        },
        ...(snapshot
          ? [
              {
                key: "name",
                label: "提交者姓名",
                value: snapshot.identity.name,
                required: false,
                applyOnBlur: true,
                hint: "输入完成后自动保存。姓名和邮箱需同时填写完整。",
              },
              {
                key: "email",
                label: "提交者邮箱",
                value: snapshot.identity.email,
                type: "email",
                required: false,
                applyOnBlur: true,
                hint: "输入完成后自动保存，仅用于当前仓库。",
              },
            ]
          : []),
        {
          key: "fontSize",
          label: "编辑器字号",
          value: String(fontSize),
          options: [11, 12, 13, 14, 15, 16, 18].map((n) => ({
            value: String(n),
            label: `${n} px`,
          })),
        },
        {
          key: "uiFontFamily",
          label: "界面字体",
          value: uiFontFamily,
          placeholder: "例如：Microsoft YaHei UI, Segoe UI",
          required: false,
          hint: "填写本机已安装的字体名称；多个字体用英文逗号分隔，留空恢复默认。",
        },
        {
          key: "editorFontFamily",
          label: "编辑器字体",
          value: editorFontFamily,
          placeholder: "例如：Cascadia Code, Consolas",
          required: false,
          hint: "用于文件编辑、代码阅读与差异视图；未安装的字体会使用默认字体。",
        },
      ],
      onChange: async (key, values) => {
        if (key === "name" || key === "email") {
          const identity = {
            name: values.name.trim(),
            email: values.email.trim(),
          };
          if (!identity.name || !identity.email)
            throw new Error("请同时填写提交者姓名和邮箱后自动保存。");
          if (!/^[^\s@]+@[^\s@]+$/.test(identity.email))
            throw new Error("请填写有效的提交者邮箱。");
          const writing = identityWrites.current.then(async () => {
            await request("mutate", settingsRepo, {
              action: "identity",
              ...identity,
            });
            if (repoRef.current === settingsRepo)
              setSnapshot((current) =>
                current ? { ...current, identity } : current,
              );
          });
          identityWrites.current = writing.catch(() => {});
          await persist(writing);
          return;
        }
        const value =
          key === "fontSize" || key === "uiScale"
            ? Number(values[key])
            : values[key].trim();
        if (key === "theme") setTheme(String(value));
        else if (key === "uiScale") setUiScale(normalizeUiScale(value));
        else if (key === "fontSize") setFontSize(Number(value));
        else if (key === "uiFontFamily") setUiFontFamily(String(value));
        else if (key === "editorFontFamily") setEditorFontFamily(String(value));
        await persist(request("preferences", undefined, { [key]: value }));
      },
    });
  }
  function commitAction(action: string, commit: Commit) {
    if (action === "tag") {
      createTag(commit.hash);
      return;
    }
    if (action === "reset") {
      setForm({
        title: "重置当前分支",
        description: `目标 ${commit.hash.slice(0, 8)} · ${commit.subject}`,
        fields: [
          {
            key: "mode",
            label: "重置模式",
            value: "soft",
            options: [
              { value: "soft", label: "Soft：保留工作区和暂存区" },
              { value: "mixed", label: "Mixed：保留工作区，取消暂存" },
              { value: "hard", label: "Hard：丢弃工作区和暂存区改动" },
            ],
          },
        ],
        submitLabel: "下一步",
        onSubmit: async (values) => {
          confirm(
            "确认重置",
            `将当前分支重置到 ${commit.hash.slice(0, 8)}。模式：${values.mode}${values.mode === "hard" ? "\n所有未提交的已跟踪改动将被永久丢弃。" : ""}`,
            () => mutate("reset", { ref: commit.hash, mode: values.mode }),
          );
          return true;
        },
      });
      return;
    }
    confirm(
      action === "revert" ? "还原提交" : "拣选提交",
      `${commit.hash.slice(0, 8)} · ${commit.subject}\n${action === "revert" ? "创建一个新提交来撤销此提交的改动。" : "把此提交的改动应用到当前分支。"}`,
      () => mutate(action, { ref: commit.hash }),
    );
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        repoDialog("open");
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (!busyRef.current) void refresh();
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommitVisible(true);
        setTimeout(
          () =>
            document
              .querySelector<HTMLTextAreaElement>(
                'textarea[aria-label="提交信息"]',
              )
              ?.focus(),
          0,
        );
      } else if (e.key === "9") {
        e.preventDefault();
        setLogVisible((v) => !v);
      } else if (e.key === "1") {
        e.preventDefault();
        setProjectVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [repo, snapshot, refresh]);
  function resize(kind: "left" | "right" | "top", event: React.PointerEvent) {
    event.preventDefault();
    const area = workbench.current;
    if (!area) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const rect = area.getBoundingClientRect();
      setWidths((current) => ({
        ...current,
        [kind]:
          kind === "left"
            ? Math.max(180, Math.min(430, e.clientX - rect.left))
            : kind === "right"
              ? Math.max(260, Math.min(520, rect.right - e.clientX))
              : Math.max(
                  0.32,
                  Math.min(0.72, (e.clientY - rect.top) / rect.height),
                ),
      }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  useEffect(() => {
    localStorage.setItem("git-idea-panels", JSON.stringify(widths));
  }, [widths]);
  const tab = tabs.find((t) => t.id === activeTab) || tabs.at(-1);
  const layout = {
    "--left-width": `${widths.left || 252}px`,
    "--right-width": `${widths.right || 328}px`,
    "--editor-font-size": `${fontSize}px`,
  } as React.CSSProperties;
  const welcome = (
    <div className="welcome">
      <div className="welcome-mark">
        <GitBranch size={36} />
      </div>
      <h1>{snapshot?.name || "Git IDEA"}</h1>
      <p>熟悉的工作空间，专注每一次提交。</p>
      <div className="welcome-actions">
        <button onClick={() => repoDialog("open")}>
          <FolderOpen size={18} />
          <span>打开仓库</span>
          <kbd>Ctrl O</kbd>
        </button>
        <button onClick={() => repoDialog("clone")}>
          <Download size={18} />
          <span>从 URL 克隆</span>
          <ChevronRight size={14} />
        </button>
        <button onClick={() => repoDialog("init")}>
          <Plus size={18} />
          <span>新建仓库</span>
          <ChevronRight size={14} />
        </button>
      </div>
      {snapshot ? (
        <div className="welcome-repo">
          <span className="status-dot" />
          <span>已连接本地仓库</span>
          <span className="mono">{snapshot.branch}</span>
        </div>
      ) : (
        recent.length > 0 && (
          <div className="recent-welcome">
            <span className="tiny muted">最近打开</span>
            {recent.slice(0, 3).map((p) => (
              <button key={p} title={p} onClick={() => void openRepository(p)}>
                <FolderGit2 size={14} />
                <span className="truncate">{p}</span>
              </button>
            ))}
          </div>
        )
      )}
      <div className="welcome-shortcuts">
        <span>
          <kbd>Ctrl K</kbd> 提交更改
        </span>
        <span>
          <kbd>Ctrl 9</kbd> Git 日志
        </span>
      </div>
    </div>
  );
  return (
    <div className="app" style={layout}>
      <header className="titlebar">
        <div className="app-logo">
          <GitBranch size={17} />
        </div>
        <div className="popover-anchor">
          <IconButton
            title="主菜单"
            onClick={() => setMainMenu(!mainMenu)}
            active={mainMenu}
            aria-haspopup="menu"
            aria-expanded={mainMenu}
          >
            <Menu size={20} />
          </IconButton>
          <Popover
            open={mainMenu}
            onClose={() => setMainMenu(false)}
            label="主菜单"
            className="main-menu"
          >
            <button role="menuitem" onClick={() => repoDialog("open")}>
              <FolderOpen size={15} />
              打开仓库…<kbd>Ctrl O</kbd>
            </button>
            <button role="menuitem" onClick={() => repoDialog("clone")}>
              <Download size={15} />
              克隆仓库…
            </button>
            <button role="menuitem" onClick={() => repoDialog("init")}>
              <Plus size={15} />
              初始化仓库…
            </button>
            <hr />
            <button role="menuitem" onClick={settings}>
              <Settings size={15} />
              设置…
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setHelp(true);
                setMainMenu(false);
              }}
            >
              <CircleHelp size={15} />
              快捷键与帮助
            </button>
          </Popover>
        </div>
        <div className="popover-anchor">
          <button
            className="project-selector"
            aria-haspopup="menu"
            aria-expanded={repoMenu}
            onClick={() => setRepoMenu(!repoMenu)}
          >
            <span className="project-badge">
              {(snapshot?.name || "GI").slice(0, 2).toUpperCase()}
            </span>
            <strong>{snapshot?.name || "Git IDEA"}</strong>
            <ChevronDown size={13} />
          </button>
          <Popover
            open={repoMenu}
            onClose={() => setRepoMenu(false)}
            label="仓库菜单"
            className="repo-menu"
          >
            <div className="menu-caption">最近的仓库</div>
            {recent.map((p) => (
              <button
                role="menuitem"
                title={p}
                key={p}
                onClick={() => void openRepository(p)}
              >
                <FolderGit2 size={14} />
                <span className="truncate">
                  {p.split(/[/\\]/).at(-1)}
                  <small className="muted">{p}</small>
                </span>
                {p === repo && <Check size={14} />}
              </button>
            ))}
            <hr />
            <button role="menuitem" onClick={() => repoDialog("open")}>
              <FolderOpen size={14} />
              打开仓库…
            </button>
            <button role="menuitem" onClick={() => repoDialog("clone")}>
              <Download size={14} />
              克隆…
            </button>
            <button role="menuitem" onClick={() => repoDialog("init")}>
              <Plus size={14} />
              新建仓库…
            </button>
          </Popover>
        </div>
        <span className="title-divider" />
        <button
          className="branch-selector"
          disabled={!snapshot}
          onClick={() => setSwitcher(true)}
        >
          <GitBranch size={16} />
          <span>{snapshot?.branch || "分支"}</span>
          {!!snapshot?.ahead && (
            <span className="green tiny">↑{snapshot.ahead}</span>
          )}
          {!!snapshot?.behind && (
            <span className="gold tiny">↓{snapshot.behind}</span>
          )}
          <ChevronDown size={12} />
        </button>
        <div className="title-drag">
          <span className="title-subtle">Git 工作空间</span>
        </div>
        <div className="top-git-actions">
          <IconButton
            title="获取远程更新"
            disabled={busy || !snapshot?.remotes.length}
            onClick={() => void mutate("fetch")}
          >
            <RefreshCw size={16} />
          </IconButton>
          <IconButton
            title="拉取（仅快进）"
            disabled={busy || !snapshot?.upstream}
            onClick={() => void mutate("pull")}
          >
            <Download size={16} className="blue" />
          </IconButton>
          <IconButton
            title="推送提交"
            disabled={busy || !snapshot}
            onClick={push}
          >
            <Upload size={16} className="green" />
          </IconButton>
          <span className="toolbar-divider" />
          <IconButton
            title="储藏更改"
            disabled={busy || !snapshot?.changes.length}
            onClick={stash}
          >
            <Archive size={16} />
          </IconButton>
          <IconButton
            title="刷新仓库（Ctrl R）"
            static
            disabled={busy || loading || !repo}
            onClick={() => void refresh()}
          >
            <IconSwap
              active={loading}
              on={<Spinner />}
              off={<RefreshCw size={15} />}
            />
          </IconButton>
        </div>
        <IconButton
          title="查找提交"
          onClick={() => {
            setLogVisible(true);
            setBottomTab("log");
            setTimeout(
              () =>
                document
                  .querySelector<HTMLInputElement>(
                    'input[aria-label="搜索提交"]',
                  )
                  ?.focus(),
              0,
            );
          }}
        >
          <Search size={17} />
        </IconButton>
        <IconButton title="设置" onClick={settings}>
          <Settings size={17} />
        </IconButton>
        {window.gitIdea && (
          <div className="window-actions">
            <IconButton
              title="最小化窗口"
              onClick={() => window.gitIdea?.window("minimize")}
            >
              <Minus size={14} />
            </IconButton>
            <IconButton
              title="最大化或还原窗口"
              onClick={() => window.gitIdea?.window("maximize")}
            >
              <Square size={11} />
            </IconButton>
            <IconButton
              title="关闭窗口"
              onClick={() => window.gitIdea?.window("close")}
            >
              <X size={16} />
            </IconButton>
          </div>
        )}
      </header>
      <div className="workspace">
        <nav className="tool-rail left-rail" aria-label="工具窗口">
          <IconButton
            title="项目（Ctrl 1）"
            active={projectVisible}
            onClick={() => setProjectVisible(!projectVisible)}
          >
            <SidebarIcon name="project" />
          </IconButton>
          <IconButton
            title="提交（Ctrl K）"
            active={commitVisible}
            onClick={() => setCommitVisible(!commitVisible)}
          >
            <SidebarIcon name="commit" />
          </IconButton>
          <IconButton
            title="分支"
            disabled={!snapshot}
            onClick={() => setSwitcher(true)}
          >
            <SidebarIcon name="branch" />
          </IconButton>
          <span className="rail-spacer" />
          <IconButton
            title="Git 日志（Ctrl 9）"
            active={logVisible && bottomTab === "log"}
            onClick={() => {
              if (logVisible && bottomTab === "log") setLogVisible(false);
              else {
                setLogVisible(true);
                setBottomTab("log");
              }
            }}
          >
            <SidebarIcon name="log" />
          </IconButton>
          <IconButton
            title="Git 控制台"
            active={logVisible && bottomTab === "console"}
            onClick={() => {
              setLogVisible(true);
              setBottomTab("console");
              void request<CommandLog[]>("logs").then(setLogs);
            }}
          >
            <SidebarIcon name="terminal" />
          </IconButton>
          <IconButton title="帮助" onClick={() => setHelp(true)}>
            <SidebarIcon name="help" />
          </IconButton>
        </nav>
        <main
          className={`workbench ${!projectVisible ? "hide-project" : ""} ${!commitVisible ? "hide-commit" : ""}`}
          ref={workbench}
          style={{
            gridTemplateRows: logVisible
              ? `minmax(250px, ${widths.top || 0.55}fr) 5px minmax(200px, ${1 - (widths.top || 0.55)}fr)`
              : "minmax(0, 1fr)",
          }}
        >
          <div className="upper-grid">
            {projectVisible && (
              <ProjectTree
                repo={repo}
                name={snapshot?.name || ""}
                changes={snapshot?.changes || []}
                onFile={(p) => openFile(p)}
                active={tab?.path}
                version={version}
                refresh={() => void refresh()}
              />
            )}
            {projectVisible && (
              <div
                className="resize-x"
                role="separator"
                aria-label="调整项目面板宽度"
                onPointerDown={(e) => resize("left", e)}
              />
            )}
            <Editor
              repo={repo}
              {...{ tab, tabs, version, notify, welcome }}
              active={tab?.id || ""}
              onSelect={(id) => guardDraft(() => setActiveTab(id))}
              onClose={closeTab}
              onCloseAll={() =>
                guardDraft(() => {
                  setTabs([]);
                  setActiveTab("");
                })
              }
              onSaved={() => void refresh()}
              onDirty={setEditorDirty}
            />
            {commitVisible && (
              <div
                className="resize-x"
                role="separator"
                aria-label="调整提交面板宽度"
                onPointerDown={(e) => resize("right", e)}
              />
            )}
            {commitVisible && (
              <CommitPanel
                snapshot={snapshot}
                {...{ busy, mutate, openDiff, confirm, settings, stash }}
                activePath={tab?.path}
                onHide={() => setCommitVisible(false)}
                refresh={() => void refresh()}
              />
            )}
          </div>
          {logVisible && (
            <>
              <div
                className="resize-y"
                role="separator"
                aria-label="调整日志面板高度"
                onPointerDown={(e) => resize("top", e)}
              />
              <section className="git-window">
                <div className="git-window-tabs">
                  <strong>Git</strong>
                  {[
                    ["log", "日志"],
                    ["console", "控制台"],
                    ["stash", "储藏"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={bottomTab === id ? "active" : ""}
                      onClick={() => {
                        setBottomTab(id);
                        if (id === "console")
                          void request<CommandLog[]>("logs").then(setLogs);
                      }}
                    >
                      {label}
                      {id === "log" && (
                        <span className="tiny muted">
                          {filters.ref
                            ? `: ${filters.ref.replace(/^refs\/(heads|remotes|tags)\//, "")}`
                            : ": 所有分支"}
                        </span>
                      )}
                      {id === "stash" && !!snapshot?.stashes.length && (
                        <span className="tab-badge">
                          {snapshot.stashes.length}
                        </span>
                      )}
                    </button>
                  ))}
                  <span className="spacer" />
                  <IconButton
                    title="管理远程仓库"
                    disabled={!snapshot}
                    onClick={remoteSettings}
                  >
                    <Plus size={14} />
                  </IconButton>
                  <IconButton
                    title="隐藏 Git 窗口"
                    onClick={() => setLogVisible(false)}
                  >
                    <Minus size={15} />
                  </IconButton>
                </div>
                <div
                  className={`bottom-grid ${bottomTab !== "log" ? "alternate-bottom" : ""}`}
                >
                  <BranchPanel
                    snapshot={snapshot}
                    filter={filters.ref}
                    onFilter={(ref) => setFilters({ ...filters, ref })}
                    {...{ checkout }}
                    create={() => createBranch()}
                    manage={setBranchManage}
                    createTag={() => createTag()}
                    deleteTag={(name) =>
                      confirm("删除标签", `删除本地标签 ${name}？`, () =>
                        mutate("tag.delete", { name }),
                      )
                    }
                  />
                  <div
                    className="resize-x"
                    role="separator"
                    aria-label="调整分支面板宽度"
                    onPointerDown={(e) => resize("left", e)}
                  />
                  {bottomTab === "log" ? (
                    <>
                      <LogTable
                        snapshot={snapshot}
                        selected={selectedCommit}
                        select={setSelectedCommit}
                        {...{ filters, setFilters, loading }}
                        refresh={() => void refresh()}
                      />
                      <div
                        className="resize-x"
                        role="separator"
                        aria-label="调整详情面板宽度"
                        onPointerDown={(e) => resize("right", e)}
                      />
                      <CommitDetails
                        repo={repo}
                        hash={selectedCommit}
                        {...{ detail, setDetail, notify }}
                        openDiff={(p, commit, oldPath) =>
                          openFile(p, { kind: "diff", commit, oldPath })
                        }
                        action={commitAction}
                      />
                    </>
                  ) : bottomTab === "console" ? (
                    <ConsolePanel logs={logs} />
                  ) : (
                    <StashPanel
                      stashes={snapshot?.stashes || []}
                      {...{ busy, mutate, confirm }}
                    />
                  )}
                </div>
              </section>
            </>
          )}
        </main>
        <nav className="tool-rail right-rail" aria-label="辅助工具">
          <IconButton
            title="提交工具窗口"
            active={commitVisible}
            onClick={() => setCommitVisible(!commitVisible)}
          >
            <SidebarIcon name="changes" />
          </IconButton>
          <span className="rail-spacer" />
          <IconButton
            title="切换深浅主题"
            static
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              void request("preferences", undefined, { theme: next });
            }}
          >
            <IconSwap
              active={theme === "dark"}
              on={<SidebarIcon name="sun" />}
              off={<SidebarIcon name="moon" />}
            />
          </IconButton>
        </nav>
      </div>
      <footer className="statusbar">
        <span className={`status-dot ${busy ? "busy" : ""}`} />
        {busy && <Spinner />}
        <span className="status-message truncate">
          {busy ? status : repo ? repo : "Git IDEA · 跨平台 Git 客户端"}
        </span>
        <span className="spacer" />
        <span className="status-count">
          {snapshot?.changes.length || 0} 个更改
        </span>
        <span className="status-divider" />
        <span>UTF-8</span>
        <span className="status-divider" />
        <button onClick={() => snapshot && setSwitcher(true)}>
          <GitBranch size={12} />
          {snapshot?.branch || "无仓库"}
        </button>
        <span className="status-divider" />
        <span className="tiny">
          {snapshot?.gitVersion.replace("git version ", "Git ") || "本地 Git"}
        </span>
      </footer>
      <Presence>
        {toast && (
          <Notification
            notification={toast}
            onDismiss={() => setToast(null)}
            onConsole={() => {
              setBottomTab("console");
              setLogVisible(true);
              setToast(null);
            }}
          />
        )}
      </Presence>
      <Presence>
        {form && (
          <FormDialog
            key={form.title}
            spec={form}
            onClose={() => setForm(null)}
          />
        )}
      </Presence>
      <Presence>
        {confirmation && (
          <ConfirmDialog
            spec={confirmation}
            onClose={() => setConfirmation(null)}
          />
        )}
      </Presence>
      <Presence>
        {switcher && snapshot && (
          <BranchSwitcher
            snapshot={snapshot}
            {...{ checkout }}
            create={() => createBranch()}
            onClose={() => setSwitcher(false)}
          />
        )}
      </Presence>
      <Presence>
        {remoteDialog && (
          <Modal title="管理远程仓库" onClose={() => setRemoteDialog(false)}>
            <div className="remote-list">
              {snapshot?.remotes.map((remote) => (
                <div className="remote-entry" key={remote.name}>
                  <FolderGit2 size={17} />
                  <div>
                    <strong>{remote.name}</strong>
                    <span className="muted">{remote.url}</span>
                  </div>
                  <IconButton
                    title={`移除远程 ${remote.name}`}
                    onClick={() => {
                      setRemoteDialog(false);
                      confirm(
                        "移除远程仓库",
                        `从本地配置移除 ${remote.name}：${remote.url}。远程服务器上的仓库不受影响。`,
                        () => mutate("remote.remove", { name: remote.name }),
                      );
                    }}
                  >
                    <X size={15} />
                  </IconButton>
                </div>
              ))}
              {!snapshot?.remotes.length && <Empty title="还没有远程仓库" />}
            </div>
            <div className="modal-footer">
              <button onClick={() => setRemoteDialog(false)}>关闭</button>
              <button className="primary" onClick={addRemote}>
                <Plus size={14} />
                添加远程…
              </button>
            </div>
          </Modal>
        )}
      </Presence>
      <Presence>
        {branchManage && (
          <Modal
            title={`分支 · ${branchManage.name}`}
            onClose={() => setBranchManage(null)}
          >
            <div className="action-list">
              {!branchManage.current && (
                <button
                  onClick={() => {
                    checkout(branchManage);
                    setBranchManage(null);
                  }}
                >
                  <GitBranch size={16} />
                  检出此分支
                </button>
              )}
              <button
                onClick={() => {
                  createBranch(branchManage.ref);
                  setBranchManage(null);
                }}
              >
                <Plus size={16} />
                从此分支创建…
              </button>
              {!branchManage.current && (
                <>
                  <button
                    onClick={() => {
                      const b = branchManage;
                      setBranchManage(null);
                      confirm(
                        "合并分支",
                        `将 ${b.name} 合并到 ${snapshot?.branch}。`,
                        () => mutate("merge", { ref: b.ref }),
                      );
                    }}
                  >
                    <GitMerge size={16} />
                    合并到当前分支
                  </button>
                  <button
                    onClick={() => {
                      const b = branchManage;
                      setBranchManage(null);
                      confirm(
                        "变基当前分支",
                        `将 ${snapshot?.branch} 变基到 ${b.name}。这会重写当前分支上的提交。`,
                        () => mutate("rebase", { ref: b.ref }),
                      );
                    }}
                  >
                    <GitPullRequestArrow size={16} />
                    将当前分支变基到此处
                  </button>
                </>
              )}
              {!branchManage.remote && (
                <>
                  <button
                    onClick={() => {
                      const b = branchManage;
                      setBranchManage(null);
                      setForm({
                        title: "重命名分支",
                        fields: [
                          { key: "newName", label: "新名称", value: b.name },
                        ],
                        submitLabel: "重命名",
                        onSubmit: (v) =>
                          mutate("branch.rename", { name: b.name, ...v }),
                      });
                    }}
                  >
                    <FileDiff size={16} />
                    重命名…
                  </button>
                  {!branchManage.current && (
                    <button
                      className="red"
                      onClick={() => {
                        const b = branchManage;
                        setBranchManage(null);
                        confirm(
                          "删除本地分支",
                          `删除 ${b.name}。Git 会拒绝删除含有未合并提交的分支。`,
                          () => mutate("branch.delete", { name: b.name }),
                        );
                      }}
                    >
                      <X size={16} />
                      删除分支
                    </button>
                  )}
                </>
              )}
            </div>
          </Modal>
        )}
      </Presence>
      <Presence>
        {help && (
          <Modal title="Git IDEA · 快捷键与帮助" onClose={() => setHelp(false)}>
            <div className="help-content">
              <div className="help-logo">
                <GitBranch size={25} />
                <div>
                  <h2>Git IDEA</h2>
                  <span className="muted">熟悉的布局，完整的 Git 工作流</span>
                </div>
              </div>
              {[
                ["Ctrl / ⌘ + O", "打开本地仓库"],
                ["Ctrl / ⌘ + K", "聚焦提交信息"],
                ["Ctrl / ⌘ + Enter", "提交已暂存的更改"],
                ["Ctrl / ⌘ + R", "刷新仓库"],
                ["Ctrl / ⌘ + 1", "显示或隐藏项目"],
                ["Ctrl / ⌘ + 9", "显示或隐藏 Git 日志"],
                ["Ctrl / ⌘ + S", "保存正在编辑的文件"],
                ["↑ / ↓", "在提交日志中移动"],
                ["双击分支", "检出分支"],
              ].map(([keys, label]) => (
                <div className="shortcut-row" key={keys}>
                  <span>{label}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
              <p className="muted">
                拖动面板间的分隔线调整布局。点击日志中的提交可查看详情，点击文件可查看差异。冲突文件可在编辑器修改、保存，再暂存为已解决。
              </p>
              <span className="tiny muted">
                Git IDEA 0.1.0 · 使用系统 Git · Windows / macOS / Linux
              </span>
            </div>
          </Modal>
        )}
      </Presence>
    </div>
  );
}
