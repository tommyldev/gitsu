//! Tauri command surface (the IPC boundary between Rust and React).
//!
//! Every `#[tauri::command]` here is invoked from the React side via
//! `@tauri-apps/api`'s `invoke()`. The `docs/IPC.md` document lists
//! every command and its payload type — keep them in sync.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::error::{Error, Result};
use crate::git::graph::{self, GraphOpts};
use crate::worktrunk::commands as wt;
use crate::AppState;

/// Helper: get or create a WtClient for the given repo path.
async fn wt_for(state: &State<'_, AppState>, app: &AppHandle, repo: PathBuf) -> Result<Arc<crate::worktrunk::WtClient>> {
    {
        let map = state.wt_clients.lock();
        if let Some(c) = map.get(&repo) {
            return Ok(c.clone());
        }
    }
    let canonical = std::fs::canonicalize(&repo).unwrap_or(repo.clone());
    // Verify it's actually a git repo before constructing the client.
    if !canonical.join(".git").exists() && !is_bare_repo(&canonical) {
        return Err(Error::NotARepo(canonical.display().to_string()));
    }
    let client = crate::worktrunk::WtClient::new(canonical.clone(), app.clone());
    state.wt_clients.lock().insert(canonical, client.clone());
    Ok(client)
}

fn is_bare_repo(p: &std::path::Path) -> bool {
    p.join("HEAD").exists() && p.join("objects").exists() && p.join("refs").exists()
}

#[derive(Serialize)]
pub struct VersionInfo {
    pub wt: String,
    pub path: Option<PathBuf>,
    pub min_supported: &'static str,
}

#[tauri::command]
pub async fn wt_version(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
) -> Result<VersionInfo> {
    let client = wt_for(&state, &app, repo).await?;
    let v = wt::version(&client).await?;
    let parsed = crate::worktrunk::sidecar::parse_version(&v).unwrap_or_default();
    Ok(VersionInfo {
        wt: parsed,
        path: crate::worktrunk::sidecar::locate_bundled(),
        min_supported: crate::worktrunk::sidecar::MIN_WT_VERSION,
    })
}

#[tauri::command]
pub async fn wt_switch_create(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
    branch: String,
    base: Option<String>,
    execute: Option<String>,
) -> Result<wt::SwitchResult> {
    let client = wt_for(&state, &app, repo).await?;
    wt::switch_create(
        &client,
        wt::SwitchCreateOpts {
            branch: &branch,
            base: base.as_deref(),
            execute: execute.as_deref(),
        },
    )
    .await
}

#[tauri::command]
pub async fn wt_switch(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
    branch: String,
) -> Result<wt::SwitchResult> {
    let client = wt_for(&state, &app, repo).await?;
    wt::switch(&client, &branch).await
}

#[tauri::command]
pub async fn wt_remove(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
    branch: String,
    delete_branch: Option<bool>,
    force: Option<bool>,
) -> Result<wt::RemoveResult> {
    let client = wt_for(&state, &app, repo).await?;
    wt::remove(
        &client,
        wt::RemoveOpts {
            branch: &branch,
            delete_branch,
            force,
        },
    )
    .await
}

#[tauri::command]
pub async fn wt_merge(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
    target: String,
    no_hooks: Option<bool>,
) -> Result<wt::MergeResult> {
    let client = wt_for(&state, &app, repo).await?;
    wt::merge(
        &client,
        wt::MergeOpts {
            target: &target,
            no_hooks,
        },
    )
    .await
}

#[tauri::command]
pub async fn wt_step_commit(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
    stage: Option<String>,
    dry_run: Option<bool>,
) -> Result<serde_json::Value> {
    let client = wt_for(&state, &app, repo).await?;
    wt::step_commit(
        &client,
        wt::StepCommitOpts { stage, dry_run },
    )
    .await
}

#[tauri::command]
pub async fn wt_step_copy_ignored(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
    from: Option<String>,
    to: Option<String>,
    force: Option<bool>,
) -> Result<serde_json::Value> {
    let client = wt_for(&state, &app, repo).await?;
    wt::step_copy_ignored(
        &client,
        wt::CopyIgnoredOpts {
            from: from.as_deref(),
            to: to.as_deref(),
            force,
        },
    )
    .await
}

#[tauri::command]
pub async fn wt_hook_show(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
) -> Result<serde_json::Value> {
    let client = wt_for(&state, &app, repo).await?;
    wt::hook_show(&client).await
}

#[tauri::command]
pub async fn wt_config_state_default_branch(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
) -> Result<String> {
    let client = wt_for(&state, &app, repo).await?;
    wt::config_default_branch(&client).await
}

/// Build the commit graph for a worktree. Used by the M2 CommitGraph
/// component. The libgit2 revwalk is fast (10k+ commits in <100ms);
/// the frontend caches the result and refreshes on worktree change +
/// manual refresh.
#[tauri::command]
pub async fn graph_build(
    repo: PathBuf,
    ref_name: Option<String>,
    max_count: Option<usize>,
) -> Result<graph::CommitGraph> {
    // Run the revwalk on a blocking thread — libgit2 is sync.
    tokio::task::spawn_blocking(move || graph::build(&repo, GraphOpts { ref_name, max_count }))
        .await
        .map_err(|e| Error::Internal(format!("graph task: {e}")))?
}

// ── M3: diff + file content ──────────────────────────────────────

/// File-level diff for a single commit (`tree(parent) → tree(sha)`).
/// Used by the right-pane commit panel and the diff viewer.
#[tauri::command]
pub async fn commit_diff(
    repo: PathBuf,
    sha: String,
) -> Result<Vec<crate::git::diff::FileDiff>> {
    tokio::task::spawn_blocking(move || crate::git::diff::commit_diff(&repo, &sha))
        .await
        .map_err(|e| Error::Internal(format!("commit_diff task: {e}")))?
}

/// File-level diff between the working tree and HEAD. Includes staged
/// and unstaged changes.
#[tauri::command]
pub async fn workdir_diff(
    repo: PathBuf,
) -> Result<Vec<crate::git::diff::FileDiff>> {
    tokio::task::spawn_blocking(move || crate::git::diff::workdir_diff(&repo))
        .await
        .map_err(|e| Error::Internal(format!("workdir_diff task: {e}")))?
}

/// Read the text of a file at a given ref. Returns `None` for missing
/// or binary files.
#[tauri::command]
pub async fn file_content(
    repo: PathBuf,
    ref_name: String,
    path: String,
) -> Result<Option<String>> {
    tokio::task::spawn_blocking(move || crate::git::diff::file_content(&repo, &ref_name, &path))
        .await
        .map_err(|e| Error::Internal(format!("file_content task: {e}")))?
}

/// File-level diff between the working tree and HEAD. Includes staged
/// and unstaged changes.
#[tauri::command]
pub async fn wt_list(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
) -> Result<crate::worktrunk::types::WorktreeList> {
    let client = wt_for(&state, &app, repo).await?;
    let items = wt::list(&client).await?;
    let default_branch = wt::config_default_branch(&client).await.ok();
    // The primary worktree is usually items[0] with `is_main: true`,
    // but wt's order isn't guaranteed across versions. We use
    // items[0] for v1 (it always returns the main worktree first
    // in practice) and fall back to None for an empty list.
    let primary = items.first().and_then(|w| w.path.clone());
    Ok(crate::worktrunk::types::WorktreeList {
        items,
        default_branch,
        primary_worktree_path: primary,
    })
}

// ── M4: hook installer ─────────────────────────────────────────

/// Snapshot of the current `.config/wt.toml` (or empty if missing).
#[derive(Serialize)]
pub struct HookConfigSnapshot {
    pub installed: bool,
    pub has_post_start_copy_ignored: bool,
    pub config_path: String,
    pub worktreeinclude_path: Option<String>,
    pub worktreeinclude_contents: Option<String>,
}

#[tauri::command]
pub async fn hooks_snapshot(repo: PathBuf) -> Result<HookConfigSnapshot> {
    tokio::task::spawn_blocking(move || crate::hooks::snapshot(&repo))
        .await
        .map_err(|e| Error::Internal(format!("hooks_snapshot task: {e}")))?
}

#[tauri::command]
pub async fn hooks_install(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
    with_worktreeinclude: bool,
) -> Result<HookConfigSnapshot> {
    let client = wt_for(&state, &app, repo.clone()).await?;
    let outcome = tokio::task::spawn_blocking(move || {
        crate::hooks::install(&repo, with_worktreeinclude)
    })
    .await
    .map_err(|e| Error::Internal(format!("hooks_install task: {e}")))??;

    // Pre-approve the command we just wrote, but only when the user
    // actually consented to it being installed this call. This is the
    // implicit-consent path for the M6 approval flow: clicking
    // "Install" in the HooksManager is the user's signal that the
    // command should run on first `wt switch --create` without
    // re-prompting.
    if outcome.newly_installed {
        let _ = crate::worktrunk::commands::config_approvals_add(
            &client,
            "wt step copy-ignored",
        )
        .await;
    }

    Ok(outcome.snapshot)
}

#[tauri::command]
pub async fn hooks_uninstall(repo: PathBuf) -> Result<HookConfigSnapshot> {
    tokio::task::spawn_blocking(move || crate::hooks::uninstall(&repo))
        .await
        .map_err(|e| Error::Internal(format!("hooks_uninstall task: {e}")))?
}

// ── M5: per-worktree PTY ────────────────────────────────────────

/// Opaque handle to a spawned PTY session. The frontend uses this to
/// address the right `pty:data:<id>` event subscription and to send
/// input / resize / kill.
pub type PtyId = u64;

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    worktree: PathBuf,
    cols: u16,
    rows: u16,
) -> Result<PtyId> {
    crate::pty::spawn(app, worktree, cols, rows)
}

#[tauri::command]
pub async fn pty_send(id: PtyId, data: Vec<u8>) -> Result<()> {
    crate::pty::send(id, &data)
}

#[tauri::command]
pub async fn pty_resize(id: PtyId, cols: u16, rows: u16) -> Result<()> {
    crate::pty::resize(id, cols, rows)
}

#[tauri::command]
pub async fn pty_kill(id: PtyId) -> Result<()> {
    crate::pty::kill(id)
}

#[tauri::command]
pub async fn pty_list() -> Result<Vec<crate::pty::PtyInfo>> {
    Ok(crate::pty::list())
}

/// Look up the current CWD of a PTY session. Returns `None` if the
/// session is unknown (e.g. it just exited). The CWD is updated via
/// OSC 7 sequences parsed in the reader thread; if the shell never
/// emits one, this returns the worktree root that the session
/// started in.
#[tauri::command]
pub async fn pty_cwd(id: PtyId) -> Result<Option<String>> {
    Ok(crate::pty::cwd(id).map(|p| p.display().to_string()))
}

// ── Directory explorer (M2.1) ──────────────────────────────────

/// One entry in a directory listing. The frontend renders these
/// in the directory explorer (right sidebar in terminal view).
#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// File size in bytes. `None` for directories (or files we
    /// couldn't stat).
    pub size: Option<u64>,
}

/// List the immediate children of `path`. Sorted case-insensitively
/// with directories first — the order the directory explorer
/// renders.
///
/// Symlinks are reported by what they *point to*: a symlink to a
/// directory is reported as `is_dir = true`. `.git` is always
/// hidden — the explorer is for working-tree files, not internals.
#[tauri::command]
pub async fn list_directory(path: PathBuf) -> Result<Vec<DirEntry>> {
    tokio::task::spawn_blocking(move || {
        let mut entries = Vec::new();
        let dir = std::fs::read_dir(&path)
            .map_err(|e| Error::Internal(format!("read_dir {}: {e}", path.display())))?;
        for entry in dir {
            let entry = entry.map_err(|e| {
                Error::Internal(format!("dir entry in {}: {e}", path.display()))
            })?;
            let name = entry.file_name().to_string_lossy().to_string();
            // Always hide .git — the directory explorer is for
            // working-tree files, not git internals.
            if name == ".git" {
                continue;
            }
            let p = entry.path();
            // Resolve symlinks for the is_dir decision. A broken
            // symlink is reported as a file with size 0.
            let meta = std::fs::metadata(&p).ok();
            let target_meta = std::fs::metadata(&p)
            .or_else(|_| std::fs::symlink_metadata(&p))
            .ok();
            let is_dir = target_meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = if is_dir {
                None
            } else {
                meta.as_ref().map(|m| m.len())
            };
            entries.push(DirEntry {
                name,
                path: p.display().to_string(),
                is_dir,
                size,
            });
        }
        // Directories first; within each group, case-insensitive
        // alphabetical. Stable sort preserves the original order on
        // equal keys (we don't depend on it, but it's safer).
        entries.sort_by(|a, b| {
            if a.is_dir != b.is_dir {
                // true > false → directories come first when
                // sorting ascending; we want dirs first, so use
                // b.is_dir.cmp(&a.is_dir) to flip.
                b.is_dir.cmp(&a.is_dir)
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });
        Ok::<_, Error>(entries)
    })
    .await
    .map_err(|e| Error::Internal(format!("list_directory task: {e}")))?
}

/// Walk `root` recursively and return file paths (relative to
/// `root`, using forward slashes) whose **filename** contains
/// `pattern` (case-insensitive substring match). Used by the
/// directory explorer's search bar.
///
/// We don't index file *contents* here — that's a follow-up. The
/// use case is "I have a file called `auth-flow.ts` somewhere in
/// this worktree, where is it?"
#[tauri::command]
pub async fn search_files(root: PathBuf, pattern: String) -> Result<Vec<String>> {
    tokio::task::spawn_blocking(move || {
        let needle = pattern.to_lowercase();
        let mut results = Vec::new();
        for dent in walkdir::WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            // Always skip the .git directory.
            if dent
                .path()
                .components()
                .any(|c| c.as_os_str() == ".git")
            {
                continue;
            }
            if !dent.file_type().is_file() {
                continue;
            }
            let name = dent.file_name().to_string_lossy().to_string();
            if needle.is_empty() || name.to_lowercase().contains(&needle) {
                // Forward-slash relative path for display in the
                // search results list.
                let rel = dent
                    .path()
                    .strip_prefix(&root)
                    .map_err(|e| Error::Internal(format!("strip_prefix: {e}")))?;
                // walkdir uses OS-native separators; normalize to
                // forward slashes for display.
                let mut s = String::new();
                for (i, comp) in rel.components().enumerate() {
                    if i > 0 {
                        s.push('/');
                    }
                    s.push_str(&comp.as_os_str().to_string_lossy());
                }
                results.push(s);
            }
        }
        results.sort();
        Ok::<_, Error>(results)
    })
    .await
    .map_err(|e| Error::Internal(format!("search_files task: {e}")))?
}

/// Read a file from the worktree filesystem as a UTF-8 string.
/// Used by the file viewer pane (opened from the directory
/// explorer). The existing `file_content` command reads from a
/// git ref; this one reads from the working tree directly.
///
/// Returns `Ok(None)` for binary files (those with invalid UTF-8
/// or NUL bytes in the first 8 KiB — a simple binary heuristic).
#[tauri::command]
pub async fn read_file(path: PathBuf) -> Result<Option<String>> {
    tokio::task::spawn_blocking(move || {
        let bytes = std::fs::read(&path)
            .map_err(|e| Error::Internal(format!("read_file {}: {e}", path.display())))?;
        // Binary sniff: a NUL byte in the first 8 KiB usually means
        // the file isn't text. We bail rather than rendering
        // garbage.
        const SNIFF: usize = 8 * 1024;
        if bytes.iter().take(SNIFF).any(|b| *b == 0) {
            return Ok(None);
        }
        let s = String::from_utf8(bytes).map_err(|_| {
            // Invalid UTF-8 — treat as binary for the UI's
            // purposes, but don't surface an error to the user
            // (just signal "can't preview"). The Rust type forces
            // us to wrap the original bytes' lossy-decoded form
            // anyway, so we return Ok(None).
            Error::Internal("binary".to_string())
        });
        match s {
            Ok(s) => Ok(Some(s)),
            Err(_) => Ok(None),
        }
    })
    .await
    .map_err(|e| Error::Internal(format!("read_file task: {e}")))?
}

// ── M7: merge ──────────────────────────────────────────────────

/// Compute a merge preview. Used by the M7 Merge dialog to show the
/// user what *would* happen before they commit to the actual merge
/// (which is performed by `wt_merge`, calling `wt merge <target>`).
#[tauri::command]
pub async fn merge_preview(
    worktree: PathBuf,
    source_branch: String,
    target_branch: String,
) -> Result<crate::git::merge::MergePreview> {
    tokio::task::spawn_blocking(move || {
        crate::git::merge::preview(
            &worktree,
            &source_branch,
            &target_branch,
            crate::git::merge::MergeOpts::default(),
        )
    })
    .await
    .map_err(|e| Error::Internal(format!("merge_preview task: {e}")))?
}

// ── M8: conflict resolution ───────────────────────────────────

/// Read the three sides (ours / theirs / base) of a merge conflict
/// for a single path, plus the on-disk working file. Returns
/// `ConflictParts` for the editor to render.
#[tauri::command]
pub async fn merge_conflict_parts(
    worktree: PathBuf,
    path: String,
) -> Result<crate::git::conflict::ConflictParts> {
    tokio::task::spawn_blocking(move || crate::git::conflict::read_conflict_parts(&worktree, &path))
        .await
        .map_err(|e| Error::Internal(format!("merge_conflict_parts task: {e}")))?
}

/// List the paths that still have unresolved conflicts. Used by the
/// ConflictEditor's progress indicator.
#[tauri::command]
pub async fn merge_list_unresolved_conflicts(worktree: PathBuf) -> Result<Vec<String>> {
    tokio::task::spawn_blocking(move || crate::git::conflict::list_unresolved_conflicts(&worktree))
        .await
        .map_err(|e| Error::Internal(format!("merge_list_unresolved task: {e}")))?
}

/// Stage a resolution for `path`: write `content` to the working
/// tree, add it to the index, and clear the conflict entry. After
/// this call the path is no longer in the conflict set.
#[tauri::command]
pub async fn merge_stage_resolution(
    worktree: PathBuf,
    path: String,
    content: String,
) -> Result<()> {
    tokio::task::spawn_blocking(move || crate::git::conflict::stage_resolution(&worktree, &path, &content))
        .await
        .map_err(|e| Error::Internal(format!("merge_stage_resolution task: {e}")))?
}

// ── M6: hooks approval UX ─────────────────────────────────────

/// Pre-approve a hook command name. After this call, worktrunk
/// won't re-prompt for this command in the same repo.
#[tauri::command]
pub async fn wt_approve_command(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
    name: String,
) -> Result<String> {
    let client = wt_for(&state, &app, repo).await?;
    wt::config_approvals_add(&client, &name).await
}

/// Wipe all pre-approvals for the current repo.
#[tauri::command]
pub async fn wt_clear_approvals(
    state: State<'_, AppState>,
    app: AppHandle,
    repo: PathBuf,
) -> Result<String> {
    let client = wt_for(&state, &app, repo).await?;
    wt::config_approvals_clear(&client).await
}

// ── Graph-view action bar: pull / push / branch / stash / pop ─────

/// `git pull` in the given worktree. Runs system `git` (not libgit2)
/// so the user's credential helpers, SSH agent, and keychain all just
/// work. `GIT_TERMINAL_PROMPT=0` is set to keep the call
/// non-interactive; the GUI button click is the user's intent signal.
#[tauri::command]
pub async fn git_pull(worktree: PathBuf) -> Result<crate::git::ops::RemoteOpResult> {
    crate::git::ops::pull(&worktree).await
}

/// `git push` in the given worktree. `remote` and `branch` are
/// optional — when both are None this is `git push` (uses the
/// branch's configured upstream). `set_upstream` is the `-u` flag
/// (also written as `--set-upstream`); useful for the first push
/// of a new branch.
#[tauri::command]
pub async fn git_push(
    worktree: PathBuf,
    remote: Option<String>,
    branch: Option<String>,
    set_upstream: Option<bool>,
) -> Result<crate::git::ops::RemoteOpResult> {
    crate::git::ops::push(
        &worktree,
        remote.as_deref(),
        branch.as_deref(),
        set_upstream.unwrap_or(false),
    )
    .await
}

/// Create a new local branch in the worktree at HEAD (no checkout).
/// Distinct from `wt_switch_create` which makes a new worktree
/// directory; this is the "new line of work on the same checkout"
/// action. Backend returns the SHA so the UI can show a confirmation.
#[tauri::command]
pub async fn git_branch_create(
    worktree: PathBuf,
    name: String,
) -> Result<crate::git::ops::BranchCreateResult> {
    tokio::task::spawn_blocking(move || crate::git::ops::branch_create(&worktree, &name))
        .await
        .map_err(|e| Error::Internal(format!("git_branch_create task: {e}")))?
}

/// `git stash push` in the worktree. `message` is optional (libgit2
/// defaults to a generic message). When the worktree is clean, the
/// result's `no_changes` flag is true and the UI can skip showing an
/// error toast.
#[tauri::command]
pub async fn git_stash_push(
    worktree: PathBuf,
    message: Option<String>,
) -> Result<crate::git::ops::StashPushResult> {
    tokio::task::spawn_blocking(move || crate::git::ops::stash_push(&worktree, message.as_deref()))
        .await
        .map_err(|e| Error::Internal(format!("git_stash_push task: {e}")))?
}

/// `git stash pop` in the worktree. Applies the top stash and drops
/// it. On conflicts the call returns an error; the user is expected
/// to resolve via the existing commit panel + M3 diff viewer.
#[tauri::command]
pub async fn git_stash_pop(worktree: PathBuf) -> Result<crate::git::ops::StashPopResult> {
    tokio::task::spawn_blocking(move || crate::git::ops::stash_pop(&worktree))
        .await
        .map_err(|e| Error::Internal(format!("git_stash_pop task: {e}")))?
}

#[derive(Serialize)]
pub struct RecentRepo {
    pub path: PathBuf,
    pub name: String,
    pub last_opened: chrono::DateTime<chrono::Utc>,
}

#[tauri::command]
pub async fn open_repo(
    state: State<'_, AppState>,
    app: AppHandle,
    path: PathBuf,
) -> Result<RecentRepo> {
    if !path.exists() {
        return Err(Error::NotFound(path.display().to_string()));
    }
    if !path.join(".git").exists() && !is_bare_repo(&path) {
        return Err(Error::NotARepo(path.display().to_string()));
    }
    // Touch the client so version detection happens at open time.
    let _ = wt_for(&state, &app, path.clone()).await?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("(repo)")
        .to_string();
    let now = chrono::Utc::now();
    state
        .store
        .upsert_recent_repo(&path, &name, now)
        .map_err(|e| Error::Internal(e.to_string()))?;
    Ok(RecentRepo {
        path: std::fs::canonicalize(&path).unwrap_or(path),
        name,
        last_opened: now,
    })
}

#[tauri::command]
pub async fn recent_repos(state: State<'_, AppState>) -> Result<Vec<RecentRepo>> {
    state
        .store
        .recent_repos()
        .map_err(|e| Error::Internal(e.to_string()))
}

#[tauri::command]
pub async fn forget_repo(state: State<'_, AppState>, path: PathBuf) -> Result<()> {
    state
        .store
        .forget_repo(&path)
        .map_err(|e| Error::Internal(e.to_string()))
}
