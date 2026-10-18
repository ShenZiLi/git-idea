import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ChangeListRecord } from "../../shared/commit-workspace";
import { Modal } from "./Dialogs";
import { IconButton } from "./ui";
import "../commit-workspace.css";

export interface ChangeListValues {
  name: string;
  description: string;
  activate: boolean;
}

export function ChangeListDialog({
  list,
  lists = [],
  busy = false,
  onSubmit,
  onClose,
}: {
  list?: ChangeListRecord | null;
  lists?: ChangeListRecord[];
  busy?: boolean;
  onSubmit: (values: ChangeListValues) => Promise<boolean> | boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(list?.name || "");
  const [description, setDescription] = useState(list?.description || "");
  const [activate, setActivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const locked = busy || saving;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const trimmed = name.trim();
    if (!trimmed) return setError("请填写更改列表名称。");
    if (lists.some((item) => item.id !== list?.id && item.name === trimmed))
      return setError("已存在同名更改列表。");
    setError("");
    setSaving(true);
    try {
      if (await onSubmit({ name: trimmed, description, activate })) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={list ? "编辑更改列表" : "新建更改列表"}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form
        className="workspace-dialog-form"
        onSubmit={(event) => void submit(event)}
      >
        <label>
          名称
          <input
            value={name}
            maxLength={100}
            required
            disabled={locked}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          说明
          <textarea
            value={description}
            maxLength={4000}
            rows={4}
            disabled={locked}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {!list && (
          <label className="workspace-checkbox-label">
            <input
              type="checkbox"
              checked={activate}
              disabled={locked}
              onChange={(event) => setActivate(event.target.checked)}
            />
            设为活动列表，新发现的已托管更改将归入此列表
          </label>
        )}
        <p className="muted">
          更改列表只组织文件；创建和编辑列表不会暂存文件。
        </p>
        {error && (
          <p className="workspace-error" role="alert">
            {error}
          </p>
        )}
        <div className="workspace-dialog-actions">
          <button type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            type="submit"
            disabled={locked || !name.trim()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ModuleRootsDialog({
  roots,
  busy = false,
  onSubmit,
  onClose,
}: {
  roots: { path: string; name: string }[];
  busy?: boolean;
  onSubmit: (
    roots: { path: string; name: string }[],
  ) => Promise<boolean> | boolean;
  onClose: () => void;
}) {
  const [values, setValues] = useState(() =>
    roots.map((root) => ({ ...root })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const locked = busy || saving;
  function update(index: number, key: "path" | "name", value: string) {
    setValues((current) =>
      current.map((root, position) =>
        position === index ? { ...root, [key]: value } : root,
      ),
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const normalized = values.map((root) => ({
      path: root.path.trim().replaceAll("\\", "/").replace(/\/$/, "") || ".",
      name: root.name.trim(),
    }));
    if (normalized.some((root) => !root.name))
      return setError("请为每个模块填写名称。");
    if (
      normalized.some(
        (root) =>
          /^(?:\/|[A-Za-z]:)/.test(root.path) ||
          root.path.split("/").includes(".."),
      )
    )
      return setError("模块根必须是仓库内的相对目录，不能包含 ..。");
    if (new Set(normalized.map((root) => root.path)).size !== normalized.length)
      return setError("模块根不能重复。");
    setError("");
    setSaving(true);
    try {
      if (await onSubmit(normalized)) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="配置模块根目录"
      onClose={() => {
        if (!saving) onClose();
      }}
      wide
    >
      <form
        className="workspace-dialog-form"
        onSubmit={(event) => void submit(event)}
      >
        <p className="muted">
          手动配置优先于自动识别。填写相对仓库路径，使用 .
          表示仓库根目录；匹配时优先采用最长路径。
        </p>
        <div className="workspace-module-roots">
          {values.map((root, index) => (
            <div className="workspace-module-root" key={index}>
              <input
                aria-label={`模块 ${index + 1} 名称`}
                placeholder="模块名称"
                maxLength={100}
                value={root.name}
                disabled={locked}
                onChange={(event) => update(index, "name", event.target.value)}
              />
              <input
                aria-label={`模块 ${index + 1} 相对根目录`}
                placeholder="例如 packages/editor"
                value={root.path}
                disabled={locked}
                onChange={(event) => update(index, "path", event.target.value)}
              />
              <IconButton
                title={`移除模块 ${index + 1}`}
                disabled={locked}
                onClick={() =>
                  setValues((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="workspace-add-root"
          disabled={locked || values.length >= 100}
          onClick={() =>
            setValues((current) => [...current, { name: "", path: "" }])
          }
        >
          <Plus size={14} />
          添加模块根
        </button>
        {error && (
          <p className="workspace-error" role="alert">
            {error}
          </p>
        )}
        <div className="workspace-dialog-actions">
          <button type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit" disabled={locked}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
