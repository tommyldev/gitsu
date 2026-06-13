//! gitsu — worktree-first Git desktop client built on worktrunk.
//!
//! Module layout (see `docs/ARCHITECTURE.md` for the full design):
//! - `worktrunk`: sidecar wrapper around the `wt` binary (worktree lifecycle)
//! - `git`:       libgit2-backed read-heavy ops (graph, diff, blame, status)
//! - `pty`:       portable-pty manager, one session per worktree
//! - `watcher`:   notify-based FS + .git internals watcher
//! - `store`:     rusqlite-backed persistence (notepad, settings, recents)
//! - `agents`:    detect claude / codex / opencode sessions in worktrees
//! - `ipc`:       Tauri command surface (typed `invoke` handlers)

#![deny(rust_2018_idioms)]
#![warn(unused_must_use)]

// Re-export the public modules so integration tests + examples can
// reach the typed APIs. The Tauri command surface is in `ipc`.
pub mod agents;
pub mod error;
pub mod git;
pub mod hooks;
pub mod ipc;
pub mod pty;
pub mod store;
pub mod watcher;
pub mod worktrunk;

use std::sync::Arc;

use parking_lot::Mutex;
use tauri::Manager;

/// Application state shared across all Tauri command handlers.
pub struct AppState {
    /// Per-repo worktrunk client cache. Keyed by canonical repo path.
    pub wt_clients: Mutex<std::collections::HashMap<std::path::PathBuf, Arc<worktrunk::WtClient>>>,
    /// Persistent storage handle.
    pub store: Arc<store::Store>,
    /// Background FS watcher, started after the Tauri app is built.
    pub watcher: Mutex<Option<watcher::WatcherHandle>>,
}

impl AppState {
    pub fn new(store: Arc<store::Store>) -> Self {
        Self {
            wt_clients: Mutex::new(std::collections::HashMap::new()),
            store,
            watcher: Mutex::new(None),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging. Honor RUST_LOG; default to `info` for gitsu, warn for deps.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("gitsu=info,warn")),
        )
        .with_target(false)
        .compact()
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Resolve the per-user data dir, ensure it exists, open the store.
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data dir resolvable");
            std::fs::create_dir_all(&data_dir).ok();
            let store = Arc::new(
                store::Store::open(data_dir.join("gitsu.db"))
                    .expect("failed to open sqlite store"),
            );
            app.manage(AppState::new(store));

            // Spin up the FS watcher; gitsu subscribes to .git changes.
            let watcher = watcher::WatcherHandle::start();
            *app.state::<AppState>().watcher.lock() = Some(watcher);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ── worktrunk / worktree lifecycle ────────────────────────────
            ipc::wt_version,
            ipc::wt_list,
            ipc::wt_switch_create,
            ipc::wt_switch,
            ipc::wt_remove,
            ipc::wt_merge,
            ipc::wt_step_commit,
            ipc::wt_step_copy_ignored,
            ipc::wt_hook_show,
            ipc::wt_config_state_default_branch,
            // ── repo open ─────────────────────────────────────────────────
            ipc::open_repo,
            ipc::recent_repos,
            ipc::forget_repo,
            // ── commit graph (M2) ─────────────────────────────────────────
            ipc::graph_build,
            // ── diff (M3) ─────────────────────────────────────────────────
            ipc::commit_diff,
            ipc::workdir_diff,
            ipc::file_content,
            // ── hooks (M4) ────────────────────────────────────────────────
            ipc::hooks_snapshot,
            ipc::hooks_install,
            ipc::hooks_uninstall,
            // ── pty (M5) ──────────────────────────────────────────────────
            ipc::pty_spawn,
            ipc::pty_send,
            ipc::pty_resize,
            ipc::pty_kill,
            ipc::pty_list,
            // ── merge (M7) ────────────────────────────────────────────────
            ipc::merge_preview,
            // ── conflict resolution (M8) ───────────────────────────────
            ipc::merge_conflict_parts,
            ipc::merge_list_unresolved_conflicts,
            ipc::merge_stage_resolution,
            // ── approvals (M6) ──────────────────────────────────────────
            ipc::wt_approve_command,
            ipc::wt_clear_approvals,
            // ── directory explorer (M2.1) ──────────────────────────────
            ipc::list_directory,
            ipc::search_files,
            ipc::read_file,
            ipc::pty_cwd,
            // ── graph-view action bar (pull / push / branch / stash / pop)
            ipc::git_pull,
            ipc::git_push,
            ipc::git_branch_create,
            ipc::git_stash_push,
            ipc::git_stash_pop,
            // ── commit composer (status / stage / commit / checkout) ────
            ipc::git_status_list,
            ipc::git_stage,
            ipc::git_unstage,
            ipc::git_stage_all,
            ipc::git_unstage_all,
            ipc::git_commit,
            ipc::git_checkout_commit,
            ipc::git_discard_paths,
            ipc::git_stash_push_paths,
            ipc::git_ignore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
