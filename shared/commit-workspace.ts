import type { Change, DiffData } from "./types.ts";

export type CommitScope =
  | { kind: "all-staged" }
  | { kind: "changelist"; id: string }
  | { kind: "files"; paths: string[] };
export type Grouping = "flat" | "directory" | "module";
export interface ChangeListRecord {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
}
export interface CommitWorkspace {
  schemaVersion: 1;
  revision: number;
  activeListId: string;
  lists: ChangeListRecord[];
  assignments: Record<string, string>;
  view: { grouping: Grouping; showIgnored: boolean };
  moduleRoots: { path: string; name: string }[];
  drafts: Record<string, string>;
}
export interface OperationResult {
  operationId: string;
  state:
    "completed" | "conflict" | "recovery-required" | "committed-index-pending";
  message: string;
  commitHash?: string;
  affectedPaths: string[];
}
export interface OperationSummary {
  id: string;
  kind: string;
  createdAt: string;
  state: string;
  paths: string[];
  message: string;
  commitHash?: string;
}
export interface WorkspaceState extends CommitWorkspace {
  pending: OperationSummary[];
}
export interface IgnoredEntry {
  path: string;
  directory: boolean;
}
export interface IgnoredPage {
  entries: IgnoredEntry[];
  total: number;
  hasMore: boolean;
}
export interface WorkspaceModule {
  path: string;
  name: string;
  manual: boolean;
}
export interface ShelfFile {
  id: string;
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  binary: boolean;
  applied: boolean;
  listId: string;
  mode: string;
}
export interface ShelfRecord {
  id: string;
  name: string;
  createdAt: string;
  baseHead: string | null;
  sourceBranch: string;
  state: "active" | "applied" | "deleted";
  deletedAt?: string;
  files: ShelfFile[];
  revision: number;
  corrupted?: string;
}
export interface ShelfPage {
  records: ShelfRecord[];
  total: number;
  hasMore: boolean;
}
export interface WorkspacePreview {
  revision: number;
  head: string;
  index: string;
  files: { path: string; sha256: string; exists: boolean; mode: string }[];
}
export interface ShelfDetail {
  record: ShelfRecord;
  corrupted?: string;
}
export interface ShelfDiff extends DiffData {
  id: string;
}
export const WORKSPACE_ACTIONS = [
  "changelist.create",
  "changelist.update",
  "changelist.delete",
  "changelist.activate",
  "changelist.move",
  "commit.view",
  "commit.draft",
  "commit.modules",
] as const;
export const SHELF_ACTIONS = [
  "shelf.create",
  "shelf.apply",
  "shelf.rename",
  "shelf.delete",
  "shelf.restore",
  "shelf.purge",
  "file.trash",
  "file.rollback",
  "operation.recover",
] as const;
export const isTrackedChange = (change: Change) => change.index !== "?";
