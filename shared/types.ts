export interface Change {
  path: string;
  oldPath?: string;
  index: string;
  worktree: string;
  conflict: boolean;
}
export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string;
  body: string;
}
export interface Branch {
  name: string;
  ref: string;
  current: boolean;
  remote: boolean;
  upstream: string;
  hash: string;
  track: string;
}
export interface Tag {
  name: string;
  hash: string;
}
export interface Remote {
  name: string;
  url: string;
}
export interface Stash {
  ref: string;
  message: string;
  date: string;
}
export interface RepoSnapshot {
  root: string;
  name: string;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  changes: Change[];
  branches: Branch[];
  tags: Tag[];
  remotes: Remote[];
  stashes: Stash[];
  commits: Commit[];
  head: Commit | null;
  hasMore: boolean;
  operation: "merge" | "rebase" | "cherry-pick" | "revert" | null;
  identity: { name: string; email: string };
  gitVersion: string;
}
export interface TreeEntry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
  ignored: boolean;
}
export interface DiffData {
  path: string;
  before: string;
  after: string;
  raw: string;
  binary: boolean;
  beforeLabel: string;
  afterLabel: string;
  truncated?: boolean;
  baselineAvailable?: boolean;
  readOnly?: boolean;
}
export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: string;
  additions: number;
  deletions: number;
}
export interface CommitDetail {
  commit: Commit;
  files: ChangedFile[];
}
export interface CommandLog {
  id: number;
  date: string;
  command: string;
  output: string;
  success: boolean;
  duration: number;
}
export const UI_SCALE_OPTIONS = [70, 80, 90, 100, 110, 125, 150, 175, 200];

export function normalizeUiScale(value: unknown): number {
  return typeof value === "number" && UI_SCALE_OPTIONS.includes(value)
    ? value
    : 100;
}

export interface Preferences {
  recent: string[];
  lastRepo?: string;
  theme?: string;
  uiScale?: number;
  fontSize?: number;
  uiFontFamily?: string;
  editorFontFamily?: string;
}
export interface ApiRequest {
  method: string;
  repo?: string;
  params?: Record<string, unknown>;
}
export interface Bootstrap {
  preferences: Preferences;
  defaultRepo?: string;
  platform: string;
}
export interface GitBridge {
  request<T>(request: ApiRequest): Promise<T>;
  chooseDirectory(): Promise<string | null>;
  window(action: "minimize" | "maximize" | "close"): void;
}
declare global {
  interface Window {
    gitIdea?: GitBridge;
  }
}
