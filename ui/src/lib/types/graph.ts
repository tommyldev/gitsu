/**
 * Commit-graph (M2) + graph-view action-bar result types. Mirrors
 * the Rust serde structs in `src-tauri/src/git/`.
 */

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
