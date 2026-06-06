/**
 * Typed wrappers around every Tauri command.
 *
 * The Rust side is the source of truth for the command surface; see
 * `src-tauri/src/ipc.rs` and `docs/IPC.md`. Each exported function
 * mirrors one `#[tauri::command]`, so call sites get argument + return
 * types instead of stringly-typed `invoke("name", { … })`. Argument
 * keys stay camelCase — Tauri maps them to the Rust snake_case params.
 *
 * `invoke<T>` remains exported as a low-level escape hatch, but new
 * code should prefer (and extend) the typed wrappers below.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  SwitchResult,
  RemoveResult,
  MergeResult,
  MergePreview,
  ConflictParts,
  CommitGraph,
  FileDiff,
  HookConfigSnapshot,
  RecentRepo,
  VersionInfo,
  WorktreeList,
  DirEntry,
  RemoteOpResult,
  BranchCreateResult,
  StashPushResult,
  StashPopResult,
  PtyInfo,
} from "@/lib/types";

/** Low-level escape hatch. Prefer the typed wrappers below. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

// ── Repo session ────────────────────────────────────────────────

export const recentRepos = () => invoke<RecentRepo[]>("recent_repos");
export const openRepo = (path: string) => invoke<RecentRepo>("open_repo", { path });
export const forgetRepo = (path: string) => invoke<void>("forget_repo", { path });
export const wtVersion = (repo: string) => invoke<VersionInfo>("wt_version", { repo });
export const wtList = (repo: string) => invoke<WorktreeList>("wt_list", { repo });
export const wtConfigStateDefaultBranch = (repo: string) =>
  invoke<string>("wt_config_state_default_branch", { repo });

// ── Worktree lifecycle ──────────────────────────────────────────

export const wtSwitchCreate = (
  repo: string,
  branch: string,
  base?: string | null,
  execute?: string | null,
) => invoke<SwitchResult>("wt_switch_create", { repo, branch, base, execute });

export const wtSwitch = (repo: string, branch: string) =>
  invoke<SwitchResult>("wt_switch", { repo, branch });

export const wtRemove = (
  repo: string,
  // The Rust `wt_remove` command requires `branch: String` (see
  // `src-tauri/src/ipc.rs`). We mirror that here so detached-HEAD
  // worktrees — where `Worktree.branch` is `null` — are caught at
  // compile time at the call site instead of producing a runtime
  // "invalid type: null, expected a string" Tauri argument error.
  branch: string,
  deleteBranch?: boolean,
  force?: boolean,
) => invoke<RemoveResult[]>("wt_remove", { repo, branch, deleteBranch, force });

export const wtMerge = (repo: string, target: string, noHooks?: boolean) =>
  invoke<MergeResult>("wt_merge", { repo, target, noHooks });

export const wtStepCommit = (repo: string, stage?: string | null, dryRun?: boolean) =>
  invoke<unknown>("wt_step_commit", { repo, stage, dryRun });

export const wtStepCopyIgnored = (
  repo: string,
  from?: string | null,
  to?: string | null,
  force?: boolean,
) => invoke<unknown>("wt_step_copy_ignored", { repo, from, to, force });

// ── Hooks (M4 / M6) ─────────────────────────────────────────────

export const hooksSnapshot = (repo: string) =>
  invoke<HookConfigSnapshot>("hooks_snapshot", { repo });

export const hooksInstall = (repo: string, withWorktreeinclude: boolean) =>
  invoke<HookConfigSnapshot>("hooks_install", { repo, withWorktreeinclude });

export const hooksUninstall = (repo: string) =>
  invoke<HookConfigSnapshot>("hooks_uninstall", { repo });

export const wtHookShow = (repo: string) => invoke<unknown>("wt_hook_show", { repo });

export const wtApproveCommand = (repo: string, name: string) =>
  invoke<string>("wt_approve_command", { repo, name });

export const wtClearApprovals = (repo: string) =>
  invoke<string>("wt_clear_approvals", { repo });

// ── Commit graph (M2) + diff (M3) ───────────────────────────────

export const graphBuild = (repo: string, refName: string | null, maxCount: number) =>
  invoke<CommitGraph>("graph_build", { repo, refName, maxCount });

export const commitDiff = (repo: string, sha: string) =>
  invoke<FileDiff[]>("commit_diff", { repo, sha });

export const workdirDiff = (repo: string) => invoke<FileDiff[]>("workdir_diff", { repo });

export const fileContent = (repo: string, refName: string, path: string) =>
  invoke<string | null>("file_content", { repo, refName, path });

// ── Directory explorer (M2.1) ───────────────────────────────────

export const listDirectory = (path: string) => invoke<DirEntry[]>("list_directory", { path });

export const searchFiles = (root: string, pattern: string) =>
  invoke<string[]>("search_files", { root, pattern });

export const readFile = (path: string) => invoke<string | null>("read_file", { path });

// ── Merge (M7) + conflict resolution (M8) ───────────────────────

export const mergePreview = (worktree: string, sourceBranch: string, targetBranch: string) =>
  invoke<MergePreview>("merge_preview", { worktree, sourceBranch, targetBranch });

export const mergeConflictParts = (worktree: string, path: string) =>
  invoke<ConflictParts>("merge_conflict_parts", { worktree, path });

export const mergeListUnresolvedConflicts = (worktree: string) =>
  invoke<string[]>("merge_list_unresolved_conflicts", { worktree });

export const mergeStageResolution = (worktree: string, path: string, content: string) =>
  invoke<void>("merge_stage_resolution", { worktree, path, content });

// ── Graph-view action bar: pull / push / branch / stash / pop ────

export const gitPull = (worktree: string) => invoke<RemoteOpResult>("git_pull", { worktree });

export const gitPush = (
  worktree: string,
  opts?: { remote?: string | null; branch?: string | null; setUpstream?: boolean },
) => invoke<RemoteOpResult>("git_push", { worktree, ...opts });

export const gitBranchCreate = (worktree: string, name: string) =>
  invoke<BranchCreateResult>("git_branch_create", { worktree, name });

export const gitStashPush = (worktree: string, message?: string | null) =>
  invoke<StashPushResult>("git_stash_push", { worktree, message });

export const gitStashPop = (worktree: string) =>
  invoke<StashPopResult>("git_stash_pop", { worktree });

// ── Per-worktree PTY (M5) ───────────────────────────────────────

export const ptySpawn = (worktree: string, cols: number, rows: number) =>
  invoke<number>("pty_spawn", { worktree, cols, rows });

export const ptySend = (id: number, data: number[]) => invoke<void>("pty_send", { id, data });

export const ptyResize = (id: number, cols: number, rows: number) =>
  invoke<void>("pty_resize", { id, cols, rows });

export const ptyKill = (id: number) => invoke<void>("pty_kill", { id });

export const ptyList = () => invoke<PtyInfo[]>("pty_list");

export const ptyCwd = (id: number) => invoke<string | null>("pty_cwd", { id });
