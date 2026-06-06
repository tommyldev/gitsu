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
