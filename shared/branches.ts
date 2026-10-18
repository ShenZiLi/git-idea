export interface BranchWorktree {
  path: string;
  branch: string;
  head: string;
  locked?: string;
  prunable?: string;
}

export interface BranchInfo {
  ref: string;
  name: string;
  hash: string;
  remote: boolean;
  currentRef: string;
  currentName: string;
  currentHash: string;
  upstream: string;
  upstreamRemote: string;
  upstreamMerge: string;
  worktrees: BranchWorktree[];
  remoteTarget?: { remote: string; source: string };
}

export const BRANCH_ACTIONS = [
  "branch.checkoutRef",
  "branch.createFrom",
  "branch.checkoutAndRebase",
  "branch.checkoutAndUpdate",
  "branch.update",
  "branch.pullMerge",
  "branch.pullRebase",
  "branch.mergeIntoCurrent",
  "branch.rebaseCurrent",
  "branch.pushSelected",
  "branch.track",
  "branch.renameRef",
  "branch.deleteRef",
  "branch.worktree",
] as const;

export type BranchAction = (typeof BRANCH_ACTIONS)[number];
