import type { ChangedFile, Commit } from "./types";

export interface BranchCompareRequest {
  ref: string;
  mode: "branches" | "worktree";
  reverse?: boolean;
  limit?: number;
}
export interface BranchCompareResult {
  mode: "branches" | "worktree";
  reverse: boolean;
  base: { label: string; hash: string };
  target: { label: string; hash: string };
  commits: Commit[];
  hasMore: boolean;
  files: ChangedFile[];
}
export interface BranchCompareFileRequest {
  path: string;
  oldPath?: string;
  mode: "branches" | "worktree";
  reverse: boolean;
  base: { label: string; hash: string };
  target: { label: string; hash: string };
}
