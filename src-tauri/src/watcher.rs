//! Filesystem watcher — `notify`-based, scoped to `.git` internals +
//! per-worktree trees. The frontend subscribes via a Tauri event
//! `repo:changed` and re-fetches `wt list` + graph data.
//!
//! v1 implementation is intentionally minimal: the polling loop in
//! `WorktreeListView` is the source of truth, and the watcher is a
//! "refresh sooner" signal. We expand this in v1.1 with debounced
//! recursive watchers and event-based refresh.

use std::path::Path;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;

use crate::error::Result;

pub struct WatcherHandle {
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
}

impl WatcherHandle {
    pub fn start() -> Self {
        // Default: no paths watched. Per-repo watchers are added via
        // `watch_repo` (called when a repo is opened).
        let (_tx, _rx) = std::sync::mpsc::channel::<()>();
        let debouncer = new_debouncer(Duration::from_millis(250), move |_res| {
            // placeholder: real impl forwards to a tokio channel → tauri event
        })
        .expect("create debouncer");
        Self { _debouncer: debouncer }
    }

    /// Watch `.git/` of a repository for changes. The frontend triggers
    /// a refresh on every event.
    pub fn watch_repo(&mut self, repo: &Path) -> Result<()> {
        let git_dir = repo.join(".git");
        if git_dir.exists() {
            // Re-create a debouncer per-repo for v1; in v1.1 we manage
            // one global debouncer and a map of paths → channels.
            self._debouncer
                .watcher()
                .watch(&git_dir, RecursiveMode::Recursive)
                .ok();
        }
        Ok(())
    }
}
