/**
 * Merge (M7) + conflict-resolution (M8) types. Mirrors the Rust
 * serde structs returned by the merge/conflict IPC commands.
 */

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

export interface ConflictParts {
  path: string;
  ours: string | null;
  theirs: string | null;
  base: string | null;
  /** Current on-disk content (with conflict markers). */
  working: string | null;
  is_binary: boolean;
}
