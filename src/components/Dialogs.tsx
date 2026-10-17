import {
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Check,
  FolderOpen,
  GitBranch,
  Moon,
  Plus,
  Search,
  Sun,
  X,
} from "lucide-react";
import type { Branch, RepoSnapshot } from "../../shared/types";
import { IconButton, Spinner } from "./ui";
import { Presence, PresenceContext } from "./Motion";

export interface FormField {
  key: string;
  label: string;
  type?: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  browse?: boolean;
  hint?: string;
}
export interface FormSpec {
  title: string;
  description?: string;
  fields: FormField[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<boolean>;
  danger?: boolean;
}
export interface ConfirmSpec {
  title: string;
  message: string;
  action: () => Promise<unknown>;
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const present = useContext(PresenceContext);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!present) return;
    const previous = document.activeElement as HTMLElement | null;
    const first =
      ref.current?.querySelector<HTMLElement>(
        'input:not(:disabled):not([type="radio"]),input[type="radio"]:checked:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
      ) || ref.current?.querySelector<HTMLElement>("button:not(:disabled)");
    first?.focus();
    const handler = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll(
        '[role="dialog"]:not([inert] *)',
      );
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close.current();
      }
      if (e.key === "Tab") {
        const focusable = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ) || [],
        );
        if (e.shiftKey && document.activeElement === focusable[0]) {
          e.preventDefault();
          focusable.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === focusable.at(-1)) {
          e.preventDefault();
          focusable[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
      if (previous?.isConnected && !previous.closest("[inert]"))
        previous.focus();
    };
  }, [present]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-title">
          <strong id={titleId}>{title}</strong>
          <IconButton title="关闭对话框" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Popover({
  open,
  onClose,
  label,
  className = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Presence>
      {open && (
        <PopoverSurface onClose={onClose} label={label} className={className}>
          {children}
        </PopoverSurface>
      )}
    </Presence>
  );
}

function PopoverSurface({
  onClose,
  label,
  className,
  children,
}: {
  onClose: () => void;
  label: string;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const present = useContext(PresenceContext);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!present) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) || [],
        );
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
        event.preventDefault();
        items[next]?.focus();
      } else if (event.key === "Tab") close.current();
    };
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
      if (previous?.isConnected && !previous.closest("[inert]"))
        previous.focus();
    };
  }, [present]);
  return (
    <>
      <button
        className="popover-dismiss"
        tabIndex={-1}
        aria-label={`关闭${label}`}
        onClick={onClose}
      />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        className={`menu popover ${className}`}
      >
        {children}
      </div>
    </>
  );
}
export function FormDialog({
  spec,
  onClose,
}: {
  spec: FormSpec;
  onClose: () => void;
}) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(spec.fields.map((f) => [f.key, f.value || ""])),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (await spec.onSubmit(values)) onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={spec.title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        {spec.description && (
          <p className="modal-description">{spec.description}</p>
        )}
        <div className="form-fields">
          {spec.fields.map((field) => (
            <div className="field" key={field.key}>
              {field.type === "theme" ? (
                <span id={`${formId}-${field.key}-label`}>{field.label}</span>
              ) : (
                <label htmlFor={`${formId}-${field.key}`}>{field.label}</label>
              )}
              <div className="field-control">
                {field.type === "theme" ? (
                  <div
                    className="theme-choices"
                    role="radiogroup"
                    aria-labelledby={`${formId}-${field.key}-label`}
                    aria-describedby={
                      field.hint ? `${formId}-${field.key}-hint` : undefined
                    }
                  >
                    {field.options?.map((option) => (
                      <label
                        className={`theme-option ${values[field.key] === option.value ? "selected" : ""}`}
                        key={option.value}
                      >
                        <input
                          type="radio"
                          name={`${formId}-${field.key}`}
                          aria-label={option.label}
                          value={option.value}
                          checked={values[field.key] === option.value}
                          disabled={busy}
                          onChange={() =>
                            setValues({ ...values, [field.key]: option.value })
                          }
                        />
                        <span
                          className="theme-preview"
                          data-mode={option.value}
                          aria-hidden="true"
                        >
                          <span className="theme-preview-window">
                            <span className="theme-preview-bar" />
                            <span className="theme-preview-sidebar" />
                            <span className="theme-preview-code">
                              <i />
                              <i />
                              <i />
                            </span>
                          </span>
                        </span>
                        <span className="theme-option-caption">
                          {option.value === "dark" ? (
                            <Moon size={15} aria-hidden="true" />
                          ) : (
                            <Sun size={15} aria-hidden="true" />
                          )}
                          <span>{option.label}</span>
                          {values[field.key] === option.value && (
                            <Check size={15} aria-hidden="true" />
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : field.options ? (
                  <select
                    id={`${formId}-${field.key}`}
                    aria-label={field.label}
                    aria-describedby={
                      field.hint ? `${formId}-${field.key}-hint` : undefined
                    }
                    value={values[field.key]}
                    onChange={(e) =>
                      setValues({ ...values, [field.key]: e.target.value })
                    }
                  >
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`${formId}-${field.key}`}
                    aria-label={field.label}
                    aria-describedby={
                      field.hint ? `${formId}-${field.key}-hint` : undefined
                    }
                    type={field.type || "text"}
                    value={values[field.key]}
                    required={field.required !== false}
                    placeholder={field.placeholder}
                    onChange={(e) =>
                      setValues({ ...values, [field.key]: e.target.value })
                    }
                  />
                )}
                {field.browse && window.gitIdea && (
                  <IconButton
                    title="浏览目录"
                    type="button"
                    onClick={async () => {
                      const path = await window.gitIdea!.chooseDirectory();
                      if (path) setValues({ ...values, [field.key]: path });
                    }}
                  >
                    <FolderOpen size={16} />
                  </IconButton>
                )}
              </div>
              {field.hint && (
                <small id={`${formId}-${field.key}-hint`} className="muted">
                  {field.hint}
                </small>
              )}
            </div>
          ))}
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className={spec.danger ? "danger" : "primary"}
            type="submit"
            disabled={busy}
          >
            {busy && <Spinner />}
            {busy ? "正在执行…" : spec.submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ConfirmDialog({
  spec,
  onClose,
}: {
  spec: ConfirmSpec;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={spec.title} onClose={() => !busy && onClose()}>
      <div className="confirm-body">
        <AlertTriangle size={23} className="gold" />
        <p>{spec.message}</p>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-footer">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await spec.action();
              if (result !== false) onClose();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner />}确认
        </button>
      </div>
    </Modal>
  );
}
export function BranchSwitcher({
  snapshot: s,
  checkout,
  create,
  onClose,
}: {
  snapshot: RepoSnapshot;
  checkout: (branch: Branch) => void;
  create: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  return (
    <Modal title="Git 分支" onClose={onClose}>
      <div className="switcher-search">
        <Search size={15} />
        <input
          aria-label="查找分支"
          placeholder="输入分支名称…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <button
        className="switcher-create"
        onClick={() => {
          onClose();
          create();
        }}
      >
        <Plus size={15} />
        新建分支…
      </button>
      <div className="switcher-list">
        {[false, true].map((remote) => (
          <div key={String(remote)}>
            <div className="switcher-group">
              {remote ? "远程分支" : "本地分支"}
            </div>
            {s.branches
              .filter(
                (b) =>
                  b.remote === remote &&
                  b.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((branch) => (
                <button
                  key={branch.ref}
                  className={`switcher-row ${branch.current ? "current" : ""}`}
                  onClick={() => {
                    if (!branch.current) checkout(branch);
                    onClose();
                  }}
                >
                  <GitBranch size={15} />
                  <span>{branch.name}</span>
                  {branch.current && <Check size={14} className="green" />}
                  <span className="tiny muted">
                    {branch.current
                      ? "当前分支"
                      : branch.remote
                        ? "检出并跟踪"
                        : "检出"}
                  </span>
                </button>
              ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
