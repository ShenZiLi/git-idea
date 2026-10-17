import { useCallback, useMemo, useState } from "react";

export interface LogView {
  author: boolean;
  date: boolean;
  hash: boolean;
  headers: boolean;
  tagNames: boolean;
  refsLeft: boolean;
  longEdges: boolean;
  commitTimestamp: boolean;
  highlightMine: boolean;
  highlightMerges: boolean;
  collapseLinear: boolean;
  details: boolean;
  authorWidth: number;
  dateWidth: number;
  hashWidth: number;
}
export const defaultLogView: LogView = {
  author: true,
  date: true,
  hash: false,
  headers: false,
  tagNames: true,
  refsLeft: false,
  longEdges: true,
  commitTimestamp: false,
  highlightMine: false,
  highlightMerges: false,
  collapseLinear: false,
  details: true,
  authorWidth: 130,
  dateWidth: 160,
  hashWidth: 85,
};
const key = (repo: string) => `git-idea-log-view:${repo}`;
const sessionViews = new Map<string, LogView>();
const sessionSearches = new Map<string, string[]>();
function readView(repo: string): LogView {
  const session = sessionViews.get(repo);
  if (session) return session;
  const view = { ...defaultLogView };
  try {
    const value = JSON.parse(localStorage.getItem(key(repo)) || "null");
    if (!value || typeof value !== "object") return view;
    for (const field of Object.keys(view) as (keyof LogView)[]) {
      if (typeof view[field] === "boolean" && typeof value[field] === "boolean")
        Object.assign(view, { [field]: value[field] });
      if (field.endsWith("Width") && Number.isFinite(value[field]))
        Object.assign(view, {
          [field]: Math.max(75, Math.min(400, value[field])),
        });
    }
  } catch {
    /* A broken preference must not prevent reading Git history. */
  }
  return view;
}
export function useLogView(repo: string) {
  const [state, setState] = useState(() => ({ repo, view: readView(repo) }));
  const view = useMemo(
    () => (state.repo === repo ? state.view : readView(repo)),
    [state, repo],
  );
  const update = useCallback(
    (patch: Partial<LogView>) => {
      setState((current) => {
        const next = {
          ...(current.repo === repo ? current.view : readView(repo)),
          ...patch,
        };
        sessionViews.set(repo, next);
        try {
          localStorage.setItem(key(repo), JSON.stringify(next));
        } catch {
          /* Keep session preferences. */
        }
        return { repo, view: next };
      });
    },
    [repo],
  );
  return [view, update] as const;
}
export function readLogSearches(repo: string): string[] {
  const session = sessionSearches.get(repo);
  if (session) return session;
  try {
    const values = JSON.parse(
      localStorage.getItem(`git-idea-log-searches:${repo}`) || "[]",
    );
    return Array.isArray(values)
      ? values
          .filter((v): v is string => typeof v === "string" && v.length <= 2000)
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
export function saveLogSearch(repo: string, search: string) {
  const values = [
    search,
    ...readLogSearches(repo).filter((value) => value !== search),
  ]
    .filter((value) => value.trim())
    .slice(0, 20);
  sessionSearches.set(repo, values);
  try {
    localStorage.setItem(
      `git-idea-log-searches:${repo}`,
      JSON.stringify(values),
    );
  } catch {
    /* Optional history. */
  }
  return values;
}
