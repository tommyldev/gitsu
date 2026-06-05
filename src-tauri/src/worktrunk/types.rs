//! Typed worktrunk response types.
//!
//! `Worktree` mirrors `wt list --format=json` v0.56.0; the other types
//! land as their phases come online (M3+ for LLM cache, M6 for hooks).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// Re-export common command types so the rest of the app can depend on
// `worktrunk::types::Worktree` etc. without reaching into `commands`.
pub use super::commands::Worktree;

/// Wrapper for the `wt list` JSON output. `wt list` returns a bare
/// array; the IPC layer wraps it in this struct to leave room for
/// top-level metadata (default branch, primary worktree path) that
/// gitsu computes by issuing one extra `wt config state` call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeList {
    pub items: Vec<Worktree>,
    #[serde(default)]
    pub default_branch: Option<String>,
    #[serde(default)]
    pub primary_worktree_path: Option<PathBuf>,
}
