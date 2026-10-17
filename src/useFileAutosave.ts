import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "./api";

const normalize = (text: string) => text.replaceAll("\r\n", "\n");
interface Buffer {
  repo: string;
  path: string;
  saved: string;
  draft: string;
  writable: boolean;
}

export function useFileAutosave(onSaved: () => void) {
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const buffer = useRef<Buffer | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const revision = useRef(0);
  const callbacks = useRef({ onSaved });
  const mounted = useRef(true);
  const composing = useRef(false);
  callbacks.current = { onSaved };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    (repo: string, path: string, text: string, writable: boolean) => {
      revision.current++;
      buffer.current = {
        repo,
        path,
        saved: text,
        draft: normalize(text),
        writable,
      };
      setDraft(normalize(text));
      setDirty(false);
      setError("");
    },
    [],
  );

  const change = useCallback((text: string) => {
    const current = buffer.current;
    if (!current?.writable) return;
    revision.current++;
    current.draft = text;
    setDraft(text);
    setDirty(text !== normalize(current.saved));
  }, []);

  // A single queue drains the latest draft; an older response never replaces new typing.
  const flush = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current;
    const current = buffer.current;
    if (!current?.writable || current.draft === normalize(current.saved))
      return Promise.resolve(true);
    if (composing.current) return Promise.resolve(false);
    setSaving(true);
    setError("");
    const work = async () => {
      try {
        while (current.draft !== normalize(current.saved)) {
          const text = current.saved.includes("\r\n")
            ? current.draft.replaceAll("\n", "\r\n")
            : current.draft;
          await request("saveFile", current.repo, {
            path: current.path,
            text,
            expectedText: current.saved,
          });
          current.saved = text;
          if (buffer.current !== current) return false;
          if (mounted.current) setDirty(current.draft !== normalize(text));
          if (composing.current) return false;
        }
        if (mounted.current) callbacks.current.onSaved();
        return true;
      } catch (cause) {
        if (mounted.current && buffer.current === current)
          setError((cause as Error).message);
        return false;
      } finally {
        pending.current = null;
        if (mounted.current) setSaving(false);
      }
    };
    pending.current = work();
    return pending.current;
  }, []);

  useEffect(() => {
    if (!dirty || error) return;
    const timer = window.setTimeout(() => void flush(), 500);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, error, flush]);

  useEffect(() => {
    const blur = () => void flush();
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [flush]);

  const isDirty = useCallback(() => {
    const current = buffer.current;
    return (
      !!pending.current ||
      (!!current?.writable && current.draft !== normalize(current.saved))
    );
  }, []);
  const getRevision = useCallback(() => revision.current, []);

  return {
    draft,
    dirty,
    saving,
    error,
    load,
    change,
    flush,
    isDirty,
    getRevision,
    composing,
  };
}
