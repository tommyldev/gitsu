/**
 * Worktree + worktrunk lifecycle types. Mirrors the Rust serde
 * structs in `src-tauri/src/worktrunk/`. Verified against
 * `wt list --format=json` v0.56.0.
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

/**
 * One element of the `wt remove --format=json` response. Worktrunk
 * returns a JSON array of these — one entry per thing that was
 * removed (typically one). The `kind` discriminator decides whether
 * `path` (worktree removal) or `pruned` (branch-only removal) is
 * populated.
 *
 * Mirrors `src-tauri/src/worktrunk/commands.rs::RemoveResult`.
 */
export interface RemoveResult {
  branch: string;
  branch_deleted: boolean;
  /** "worktree" | "branch_only" | (future wt values). */
  kind?: string | null;
  /** Set when `kind === "worktree"`. */
  path?: string | null;
  /** Set when `kind === "branch_only"`. */
  pruned?: boolean | null;
}
