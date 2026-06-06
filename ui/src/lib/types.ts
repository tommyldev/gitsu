/**
 * Domain types mirroring the Rust serde structs in `src-tauri/src/worktrunk/`.
 * Keep these in sync with the Rust side; the `docs/IPC.md` contract is the
 * single source of truth. Verified against `wt list --format=json` v0.56.0.
 */

export interface WorktreeCommit {
  sha: string;
  short_sha: string;
  message: string;
  /** Unix timestamp in seconds. */
  timestamp: number;
}

export interface DiffStats {
  added: number;
  deleted: number;
}

export interface WorkingTree {
  staged: boolean;
  modified: boolean;
  untracked: boolean;
  renamed: boolean;
  deleted: boolean;
  diff?: DiffStats | null;
}

export interface WorktreeMeta {
  detached: boolean;
}

export type MainState =
  | "is_main"
  | "merged"
  | "diverged"
  | "ahead"
  | "behind"
  | string; // upstream may add values

export interface Worktree {
  /**
   * `null` for detached-HEAD worktrees (wt emits `"branch": null`).
   * Use `displayBranch(wt)` for a user-facing label and
   * `wt.is_main` / `wt.is_current` for routing.
   */
  branch: string | null;
  /**
   * `null` only for broken/reaped worktrees. In practice wt always
   * populates this; we keep it optional to be defensive.
   */
  path: string | null;
  kind?: string | null;
  commit?: WorktreeCommit | null;
  working_tree?: WorkingTree | null;
  main_state?: MainState | null;
  worktree?: WorktreeMeta | null;
  is_main: boolean;
  is_current: boolean;
  is_previous: boolean;
  /** Status line with ANSI color codes — strip on display. */
  statusline?: string | null;
  /** e.g. "^", "+", "↑1", "⇡2", "merged" */
  symbols?: string | null;
}

export interface WorktreeList {
  items: Worktree[];
  default_branch?: string | null;
  primary_worktree_path?: string | null;
}

export interface SwitchResult {
  branch: string;
  path: string;
  created: boolean;
  hooks_run: string[];
}

export interface RemoveResult {
  branch: string;
  removed: boolean;
  branch_deleted: boolean;
}

export interface MergeResult {
  target: string;
  source: string;
  squashed: boolean;
  rebased: boolean;
  merged: boolean;
  conflicts: string[];
  commit?: string | null;
  message?: string | null;
}

export interface RecentRepo {
  path: string;
  name: string;
  last_opened: string;
}

export interface VersionInfo {
  wt: string;
  path: string | null;
  min_supported: string;
}

// ── Commit graph (M2) ─────────────────────────────────────────────

export interface CommitNode {
  sha: string;
  short_sha: string;
  parents: string[];
  author_name: string;
  author_email: string;
  /** Unix seconds (author). */
  author_time: number;
  /** Unix seconds (committer). */
  committer_time: number;
  summary: string;
  body: string;
  /** Tree SHA — used by the diff viewer (M3). */
  tree: string;
}

export interface BranchRef {
  name: string;
  is_local: boolean;
  sha: string;
  upstream: string | null;
}

export interface TagRef {
  name: string;
  sha: string;
  is_annotated: boolean;
}

export interface CommitGraph {
  nodes: CommitNode[];
  branches: BranchRef[];
  tags: TagRef[];
  /** SHA of HEAD (the worktree's current branch tip). */
  head_sha: string;
  max_count: number;
  /** True if the revwalker had more commits but was capped. */
  truncated: boolean;
  /** Number of distinct lanes required. Set by the frontend's lane pass. */
  lane_count: number;
}

export interface IpcError {
  kind: string;
  message: string;
}

export class WtRpcError extends Error {
  kind: string;
  constructor(err: IpcError) {
    super(err.message);
    this.name = "WtRpcError";
    this.kind = err.kind;
  }
}

// ── M3: diff ─────────────────────────────────────────────────

export type DiffStatus =
  | "added"
  | "deleted"
  | "modified"
  | "renamed"
  | "copied"
  | "typechange"
  | "untracked"
  | "ignored";

export interface FileDiff {
  old_path: string | null;
  new_path: string | null;
  status: DiffStatus;
  is_binary: boolean;
  additions: number;
  deletions: number;
  /** Unified-diff patch text. Empty for binary files. */
  patch: string;
}

// ── M4: hooks ────────────────────────────────────────────────

export interface HookConfigSnapshot {
  installed: boolean;
  has_post_start_copy_ignored: boolean;
  config_path: string;
  worktreeinclude_path: string | null;
  worktreeinclude_contents: string | null;
}

// ── M5: PTY ─────────────────────────────────────────────────

export interface PtyInfo {
  id: number;
  worktree: string;
  pid: number | null;
}

// ── M7: merge ────────────────────────────────────────────────

export interface MergePreview {
  source_branch: string;
  target_branch: string;
  source_head: string;
  target_head: string;
  merge_base: string;
  can_fast_forward: boolean;
  conflict_files: string[];
  clean_files: string[];
  ahead: number;
  behind: number;
}

// ── M8: conflict resolution ──────────────────────────────────

export interface ConflictParts {
  path: string;
  ours: string | null;
  theirs: string | null;
  base: string | null;
  /** Current on-disk content (with conflict markers). */
  working: string | null;
  is_binary: boolean;
}

// ── Graph-view action bar ────────────────────────────────────

/** Result of `git_pull` / `git_push`. */
export interface RemoteOpResult {
  /** "pull" or "push". */
  op: string;
  /** `git`'s exit code (0 = success). */
  exit_code: number;
  stdout: string;
  stderr: string;
  /**
   * True when the request was *not* satisfied as literally
   * requested. v1 sets this only for `git_pull` on a branch with
   * no upstream — the backend transparently falls back to
   * `git fetch` and the UI shows a "no upstream — fetched only,
   * use Push to publish" message.
   */
  fetch_only: boolean;
}

/** Result of `git_branch_create` — a new local branch at HEAD. */
export interface BranchCreateResult {
  name: string;
  /** SHA the new branch points to. */
  sha: string;
  /** True if the worktree was already on this branch. */
  already_checked_out: boolean;
}

/** Result of `git_stash_push`. */
export interface StashPushResult {
  /** OID of the stash entry; empty when `no_changes` is true. */
  oid: string;
  no_changes: boolean;
  message: string;
}

/** Result of `git_stash_pop`. */
export interface StashPopResult {
  oid: string;
  had_conflicts: boolean;
}
