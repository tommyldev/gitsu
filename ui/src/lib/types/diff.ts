/**
 * Diff (M3) types. Mirrors the Rust serde structs returned by the
 * diff IPC commands. (Patch *parsing* lives in `@/lib/diff`.)
 */

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
