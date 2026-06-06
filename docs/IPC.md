# gitsu — IPC contract

The boundary between the React frontend and the Tauri/Rust backend.
Every `#[tauri::command]` declared in `src-tauri/src/ipc.rs` has a
typed wrapper in `ui/src/lib/tauri.ts` and a domain type in
`ui/src/lib/types.ts`. **Both sides MUST be updated together.**

## Conventions

- Commands take an explicit `repo: PathBuf` argument when they touch a
  repository. The Rust side canonicalizes + caches the path; the
  frontend never constructs paths relative to gitsu's CWD.
- All commands return either the typed payload or throw an `IpcError`
  (`{ kind, message }`). The frontend maps `kind` to a user-friendly
  message + suggested action.
- Worktrunk responses are streamed via Tauri events when long-running
  (post-start hooks, LLM commit). v1 doesn't stream — we await
  completion and surface progress in a single modal.

## Error envelope

```ts
interface IpcError {
  kind: string;        // e.g. "worktrunk", "git", "not_a_repo"
  message: string;     // user-friendly, possibly with a CTA
}
```

`kind` values (defined in `src-tauri/src/error.rs`):

| kind                | meaning                                                     |
|---------------------|-------------------------------------------------------------|
| `worktrunk`         | `wt` exited non-zero or returned malformed JSON             |
| `git`               | libgit2 operation failed                                    |
| `io`                | filesystem error                                            |
| `serde`             | failed to deserialize `wt`'s JSON output                    |
| `not_a_repo`        | the path is not inside a git repository                     |
| `not_found`         | the path does not exist                                     |
| `invalid_argument`  | caller passed a bad arg                                     |
| `internal`          | catch-all; should never happen in v1                        |

## Commands

### Repo

#### `pick_repo() → Option<PathBuf>`
Open the native directory picker. Returns `None` if the user cancels.

**Frontend wrapper:** `invoke("pick_repo")` — but in practice we use
`@tauri-apps/plugin-dialog` directly. This command exists as a stub for
future validation.

#### `open_repo(path: PathBuf) → RecentRepo`
Validate `path` is a git repo, touch the WtClient, persist to recents.
Returns the recents row.

```ts
interface RecentRepo {
  path: string;            // canonicalized absolute
  name: string;            // basename
  last_opened: string;     // RFC 3339
}
```

#### `recent_repos() → RecentRepo[]`
List recents, sorted by `last_opened` desc, capped at 50.

#### `forget_repo(path: PathBuf) → void`
Remove a path from recents.

### Worktrunk

#### `wt_version(repo: PathBuf) → VersionInfo`
Resolve the bundled `wt` and report its version. The frontend checks
`min_supported` to warn the user.

```ts
interface VersionInfo {
  wt: string;          // "0.56.0", or "" if missing
  path: string | null; // path to the sidecar binary
  min_supported: string;
}
```

#### `wt_list(repo: PathBuf) → WorktreeList`
List worktrees via `wt list --format=json`. Wraps in a struct that
also carries the default branch and the primary worktree path.

```ts
interface WorktreeList {
  items: Worktree[];
  default_branch?: string | null;
  primary_worktree_path?: string | null;
}
```

See `Worktree` schema below.

#### `wt_switch_create(repo: PathBuf, branch: string, base?: string, execute?: string) → SwitchResult`
`wt switch --create <branch> --base <base> --format=json`.

```ts
interface SwitchResult {
  branch: string;
  path: string;
  created: boolean;
  hooks_run: string[];
}
```

`execute` (optional) is a shell command to run after switch. v1
uses this to launch the editor or attach a terminal.

#### `wt_switch(repo: PathBuf, branch: string) → SwitchResult`
Switch to an existing worktree's branch. Currently a thin wrapper; the
frontend mostly uses `wt_switch_create` for the new-worktree flow.

#### `wt_remove(repo: PathBuf, branch: string, delete_branch?: bool, force?: bool) → RemoveResult`
`wt remove <branch> --format=json [--delete-branch] [--force]`.

```ts
interface RemoveResult {
  branch: string;
  removed: boolean;
  branch_deleted: boolean;
}
```

#### `wt_merge(repo: PathBuf, target: string, no_hooks?: bool) → MergeResult`
`wt merge <target> --format=json [--no-hooks]`.

```ts
interface MergeResult {
  target: string;
  source: string;
  squashed: boolean;
  rebased: boolean;
  merged: boolean;
  conflicts: string[];   // list of conflicted file paths, or [] on success
  commit?: string | null;
  message?: string | null;
}
```

If `conflicts` is non-empty, the frontend opens the 3-pane merge
editor (M8).

#### `wt_step_commit(repo: PathBuf, stage?: "all"|"tracked"|"none", dry_run?: bool) → serde_json::Value`
`wt step commit --format=json`. The full JSON payload from worktrunk is
forwarded; structure mirrors the `wt step commit` JSON output.

#### `wt_step_copy_ignored(repo: PathBuf, from?: string, to?: string, force?: bool) → serde_json::Value`
`wt step copy-ignored --format=json`. Used by the "bring over `.env` &
caches" checkbox on the create-worktree dialog, and by the
"Recopy ignored files" button in the per-worktree actions menu.

#### `wt_hook_show(repo: PathBuf) → serde_json::Value`
`wt hook show --format=json`. Returns the union of user + project
hooks with approval status.

#### `wt_config_state_default_branch(repo: PathBuf) → string`
`wt config state default-branch`. Returns the configured default
branch (e.g. `"main"` or `"master"`).

## Domain types

### `Worktree` (matches `wt list --format=json` v0.56.0)

```ts
interface Worktree {
  branch: string;
  path: string;
  kind?: string | null;              // e.g. "worktree"
  commit?: WorktreeCommit | null;
  working_tree?: WorkingTree | null;
  main_state?: string | null;        // "is_main" | "merged" | "diverged" | ...
  worktree?: { detached: boolean } | null;
  is_main: boolean;
  is_current: boolean;
  is_previous: boolean;
  statusline?: string | null;        // ANSI-colored, strip on display
  symbols?: string | null;           // e.g. "^", "↑1", "⇡2"
}

interface WorktreeCommit {
  sha: string;
  short_sha: string;
  message: string;
  timestamp: number;                 // unix seconds
}

interface WorkingTree {
  staged: boolean;
  modified: boolean;
  untracked: boolean;
  renamed: boolean;
  deleted: boolean;
  diff?: { added: number; deleted: number } | null;
}
```

Verified against `wt 0.56.0` (June 2026). If worktrunk adds fields,
add them to the Rust struct, the TS type, and this doc in one PR.

## Sidecar naming

Tauri 2's sidecar convention requires the file to be named
`binaries/wt-<target-triple>` where `<target-triple>` matches the
build target. We commit only the Linux gnu triple for dev convenience;
the build script fetches the right one per target. See
`scripts/download-wt.sh`.

| Target triple                   | Bundled by | Source asset                                       |
|---------------------------------|------------|----------------------------------------------------|
| `x86_64-unknown-linux-gnu`      | committed  | `worktrunk-x86_64-unknown-linux-musl` (static-pie)  |
| `aarch64-unknown-linux-gnu`     | build      | `worktrunk-aarch64-unknown-linux-musl`             |
| `x86_64-apple-darwin`           | build      | `worktrunk-x86_64-apple-darwin`                    |
| `aarch64-apple-darwin`          | build      | `worktrunk-aarch64-apple-darwin`                   |
| `x86_64-pc-windows-msvc`        | build      | `worktrunk-x86_64-pc-windows-msvc`                  |

## Graph-view action bar (pull / push / branch / stash / pop)

These commands back the five buttons at the top of the commit graph
view. They run against the **active worktree**'s path (not the repo
root), so each operation is scoped to the worktree's current branch
and working tree.

Pull and push shell out to system `git` (not libgit2) so the user's
SSH agent, keychain, and credential helpers work without any
gitsu-side configuration. Branch, stash, and pop use libgit2 — all
local operations that don't need network credentials.

### `git_pull(worktree: PathBuf) → RemoteOpResult`

`git pull` in the given worktree. `GIT_TERMINAL_PROMPT=0` is set so
the call never blocks waiting for a password; the GUI button click
is the user's intent signal.

**No-upstream fallback.** When HEAD's local branch has no tracking
branch (the common case right after `wt switch --create` or after
the in-graph "Branch" button creates a fresh local branch), `git
pull` would error out with the confusing "There is no tracking
information" message. The backend detects this with libgit2 and
silently falls back to `git fetch --all --prune`, returning
`fetch_only: true`. The GUI surfaces this as an *info* banner
("No upstream — fetched remotes only. Use Push to publish") instead
of an error.

```ts
interface RemoteOpResult {
  op: string;            // always "pull" — `fetch_only` is the authoritative signal
  exit_code: number;
  stdout: string;
  stderr: string;
  /** True when the backend fell back to `git fetch` due to no upstream. */
  fetch_only: boolean;
}
```

### `git_push(worktree: PathBuf, remote?: string, branch?: string, set_upstream?: bool) → RemoteOpResult`

`git push` in the given worktree. All args are optional — when both
`remote` and `branch` are omitted, this is exactly `git push` (uses
the branch's configured upstream). `set_upstream` is the `-u` flag,
useful for the first push of a new branch.

### `git_branch_create(worktree: PathBuf, name: string) → BranchCreateResult`

Creates a new local branch in the worktree at HEAD. Does **not**
check it out. The result's `sha` is the HEAD SHA the new branch
points to; the UI uses it for a confirmation line.

```ts
interface BranchCreateResult {
  name: string;
  sha: string;             // HEAD SHA at the time of the call
  already_checked_out: boolean;
}
```

### `git_stash_push(worktree: PathBuf, message?: string) → StashPushResult`

`git stash push -u` in the worktree (libgit2; includes untracked).
When the worktree is clean, `no_changes` is true and the call still
succeeds (the UI surfaces "Nothing to stash" instead of an error).

```ts
interface StashPushResult {
  oid: string;             // empty when no_changes
  no_changes: boolean;
  message: string;
}
```

### `git_stash_pop(worktree: PathBuf) → StashPopResult`

`git stash pop` in the worktree. Applies the top stash and drops
it. On conflicts the command returns an `Error`; the user is
expected to resolve via the existing commit panel + diff viewer
(M3). The `had_conflicts` flag is reserved for a future enhancement
that lets the IPC complete the pop with conflicts left in the index.

```ts
interface StashPopResult {
  oid: string;
  had_conflicts: boolean;
}
```

## Events (for v1.1 streaming)

- `repo:changed` — `.git` internals watcher fired. Frontend refreshes
  the worktree list.
- `wt:approval-required` — worktrunk's approval prompt needs user
  input. Payload: `{ commands: { name, command }[] }`. Frontend shows
  modal.
- `wt:hook-log` — background hook line arrived. Payload:
  `{ branch, line, stream }`.
