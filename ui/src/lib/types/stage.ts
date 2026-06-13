/**
 * Commit composer types (staging / commit / checkout). Mirrors the
 * Rust serde structs in `src-tauri/src/git/stage.rs` and
 * `src-tauri/src/git/checkout.rs`.
 */

export type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "typechange"
  | "untracked"
  | "conflicted";

/** One changed path. `staged`/`unstaged` are independent — a file
 *  can be partially staged (staged, then modified again). */
export interface StatusEntry {
  path: string;
  staged: ChangeKind | null;
  unstaged: ChangeKind | null;
}

export interface CommitResult {
  sha: string;
  short_sha: string;
  summary: string;
  /** Branch HEAD points to, or null on detached HEAD. */
  branch: string | null;
}

export interface CheckoutResult {
  sha: string;
  short_sha: string;
  detached: boolean;
}
