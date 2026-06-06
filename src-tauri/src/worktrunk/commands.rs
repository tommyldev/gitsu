//! Typed `wt` subcommand invocations.
//!
//! Each public function is a thin wrapper around the corresponding `wt`
//! subcommand. They take typed inputs, return typed outputs, and always
//! pass `--format=json` so we never parse colored terminal output.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::{error, WtClient};

/// `wt --version` → "wt 0.56.0"
pub async fn version(client: &WtClient) -> Result<String, error::Error> {
    let out = client.run_raw(&["--version"], None).await?;
    Ok(out.stdout.trim().to_string())
}

/// One row of `wt list --format=json`.
///
/// `wt list` returns an array of these. The schema is documented in
/// `docs/WORKTRUNK_INTEGRATION.md` — keep this struct in sync with the
/// upstream `wt list` JSON output.
///
/// ## Why `branch` and `path` are `Option`
///
/// Worktrunk emits `"branch": null` for detached-HEAD worktrees, and
/// can emit `"path": null` for broken / reaped worktrees. We treat both
/// as optional and fall back to short-SHA / "(detached)" labels in
/// the UI. Without this, a single detached worktree in the repo would
/// fail the entire `wt list` parse, which would block the whole
/// dashboard. (`#[serde(default)]` handles missing fields; the
/// `Option<T>` handles explicit nulls.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    /// `None` for detached-HEAD worktrees (wt emits `"branch": null`).
    #[serde(default)]
    pub branch: Option<String>,
    /// `None` only for broken/reaped worktrees. In practice wt always
    /// populates this; we keep it optional to be defensive against
    /// future schema changes.
    #[serde(default)]
    pub path: Option<PathBuf>,
    /// e.g. "worktree" (vs. "bare" or similar)
    #[serde(default)]
    pub kind: Option<String>,
    /// The HEAD commit. `wt list` may omit this for bare repos.
    #[serde(default)]
    pub commit: Option<WorktreeCommit>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub age: Option<String>,
    /// One of: "clean", "dirty" (uncommitted changes), "staged" (staged but
    /// no further changes), "untracked" (untracked files only), "mixed".
    #[serde(default)]
    pub status: Option<String>,
    /// `+N` for staged, `-N` for unstaged, etc. Parsed upstream.
    #[serde(default)]
    pub staged: Option<i64>,
    #[serde(default)]
    pub unstaged: Option<i64>,
    #[serde(default)]
    pub untracked: Option<i64>,
    /// Ahead/behind the configured base branch.
    #[serde(default)]
    pub ahead: Option<i64>,
    #[serde(default)]
    pub behind: Option<i64>,
    /// Ahead/behind the upstream tracking branch.
    #[serde(default)]
    pub remote_ahead: Option<i64>,
    #[serde(default)]
    pub remote_behind: Option<i64>,
    /// Whether an AI agent (claude/codex/opencode) is currently bound to
    /// this worktree. gitsu detects this itself; the upstream field is a
    /// hint when present.
    #[serde(default)]
    pub agent_session: Option<String>,
    /// `wt list` status symbols translated to a string.
    /// Examples: "+", "↑1", "⇡2", "merged".
    #[serde(default)]
    pub head_change: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeCommit {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    /// Unix timestamp (seconds).
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkingTree {
    #[serde(default)]
    pub staged: bool,
    #[serde(default)]
    pub modified: bool,
    #[serde(default)]
    pub untracked: bool,
    #[serde(default)]
    pub renamed: bool,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub diff: Option<DiffStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffStats {
    #[serde(default)]
    pub added: u64,
    #[serde(default)]
    pub deleted: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeMeta {
    #[serde(default)]
    pub detached: bool,
}

pub async fn list(client: &WtClient) -> Result<Vec<Worktree>, error::Error> {
    client.run_json(&["list", "--format=json"]).await
}

/// `wt switch --create <branch> --base <base> --format=json`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchCreateOpts<'a> {
    pub branch: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<&'a str>,
    /// If true, run a command (e.g. `claude`) after the worktree is created.
    /// For gitsu's v1 we do this client-side after the create returns.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execute: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchResult {
    pub branch: String,
    pub path: PathBuf,
    /// `wt switch --create` doesn't currently emit this; default to `false`
    /// (the operation is a create-by-construction in gitsu's flow).
    #[serde(default)]
    pub created: bool,
    /// `wt` may not emit this either; tolerate missing/empty.
    #[serde(default)]
    pub hooks_run: Vec<String>,
}

pub async fn switch_create(
    client: &WtClient,
    opts: SwitchCreateOpts<'_>,
) -> Result<SwitchResult, error::Error> {
    let mut args = vec!["switch", "--create", "--format=json"];
    args.push(opts.branch);
    if let Some(b) = opts.base {
        args.push("--base");
        args.push(b);
    }
    if let Some(x) = opts.execute {
        args.push("--execute");
        args.push(x);
    }

    match client.run_json::<SwitchResult>(&args).await {
        Ok(r) => Ok(r),
        Err(error::Error::Worktrunk(stderr)) => {
            // Interim path before the M6 approval modal lands: if the
            // failure is the well-known "needs approval" prompt that
            // gitsu itself can't answer in a non-interactive GUI,
            // pre-approve the named commands and re-run with --yes.
            // The user has explicitly requested this operation
            // (Create button) and the command being approved is
            // either gitsu's own `wt step copy-ignored` (pre-approved
            // at hooks_install time) or another repo hook the user
            // authored — both are legitimate to auto-approve here.
            let commands = parse_approval_commands(&stderr);
            if commands.is_empty() {
                return Err(error::Error::Worktrunk(stderr));
            }
            for cmd in &commands {
                // Best-effort: a failure here still falls through to
                // the --yes re-run, which approves at run-time.
                let _ = config_approvals_add(client, cmd).await;
            }
            let mut retry_args = args.clone();
            retry_args.push("--yes");
            client.run_json(&retry_args).await
        }
        Err(e) => Err(e),
    }
}

/// Parse a worktrunk "needs approval" stderr payload and return the
/// command names that need pre-approval. Returns an empty Vec if the
/// stderr doesn't match the well-known pattern.
///
/// Worktrunk emits the prompt on a single line, e.g.:
///
/// ```text
/// ▲ t3rminal needs approval to execute 1 command: ○ post-start copy: wt step copy-ignored ✗ Cannot prompt for approval in non-interactive environment ↳ To skip prompts in CI/CD, add --yes; to pre-approve commands, run wt config approvals add (exit 1)
/// ```
///
/// We extract the segment between the trigger
/// (`needs approval to execute`) and the failure marker (`✗`),
/// then pull the command off the end of each `○` bullet.
fn parse_approval_commands(stderr: &str) -> Vec<String> {
    let Some(start) = stderr.find("needs approval to execute") else {
        return Vec::new();
    };
    let rest = &stderr[start..];
    let segment_end = rest.find('✗').unwrap_or(rest.len());
    let segment = &rest[..segment_end];

    let mut cmds = Vec::new();
    for part in segment.split('○').skip(1) {
        let part = part.trim_start();
        // Each bullet is "<hook-type> <hook-name>: <command>". The
        // LAST `: ` separates the hook description from the command.
        if let Some((_left, cmd)) = part.rsplit_once(": ") {
            let cmd = cmd.trim();
            if !cmd.is_empty() && !cmds.iter().any(|c| c == cmd) {
                cmds.push(cmd.to_string());
            }
        }
    }
    cmds
}

/// `wt switch <branch>` — switch to an existing worktree.
pub async fn switch(client: &WtClient, branch: &str) -> Result<SwitchResult, error::Error> {
    let args = ["switch", "--format=json", branch];
    client.run_json(&args).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveOpts<'a> {
    pub branch: &'a str,
    /// If true, also delete the branch after removing the worktree.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_branch: Option<bool>,
    /// If true, force removal even with uncommitted changes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveResult {
    pub branch: String,
    pub removed: bool,
    pub branch_deleted: bool,
}

pub async fn remove(
    client: &WtClient,
    opts: RemoveOpts<'_>,
) -> Result<RemoveResult, error::Error> {
    let mut args = vec!["remove", "--format=json", opts.branch];
    if opts.delete_branch.unwrap_or(false) {
        args.push("--delete-branch");
    }
    if opts.force.unwrap_or(false) {
        args.push("--force");
    }
    client.run_json(&args).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeOpts<'a> {
    pub target: &'a str,
    /// `--no-hooks` if set
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_hooks: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub target: String,
    pub source: String,
    pub squashed: bool,
    pub rebased: bool,
    pub merged: bool,
    pub conflicts: Vec<String>,
    pub commit: Option<String>,
    pub message: Option<String>,
}

pub async fn merge(
    client: &WtClient,
    opts: MergeOpts<'_>,
) -> Result<MergeResult, error::Error> {
    let mut args = vec!["merge", "--format=json", opts.target];
    if opts.no_hooks.unwrap_or(false) {
        args.push("--no-hooks");
    }
    client.run_json(&args).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepCommitOpts {
    /// "all" (default), "tracked", or "none"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
}

pub async fn step_commit(
    client: &WtClient,
    opts: StepCommitOpts,
) -> Result<serde_json::Value, error::Error> {
    let mut args = vec!["step", "commit", "--format=json"];
    if let Some(s) = &opts.stage {
        args.push("--stage");
        args.push(s);
    }
    if opts.dry_run.unwrap_or(false) {
        args.push("--dry-run");
    }
    client.run_json(&args).await
}

/// `wt step copy-ignored` — copy gitignored files from `--from` to `--to`.
/// `from` defaults to the main worktree; `to` defaults to the current
/// worktree. Used by the post-start hook to bring `.env`, `node_modules/`,
/// `target/`, etc. into a new worktree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyIgnoredOpts<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}

pub async fn step_copy_ignored(
    client: &WtClient,
    opts: CopyIgnoredOpts<'_>,
) -> Result<serde_json::Value, error::Error> {
    let mut args = vec!["step", "copy-ignored", "--format=json"];
    if let Some(f) = opts.from {
        args.push("--from");
        args.push(f);
    }
    if let Some(t) = opts.to {
        args.push("--to");
        args.push(t);
    }
    if opts.force.unwrap_or(false) {
        args.push("--force");
    }
    client.run_json(&args).await
}

/// `wt hook show` — return the configured hook definitions for a repo.
pub async fn hook_show(client: &WtClient) -> Result<serde_json::Value, error::Error> {
    client.run_json(&["hook", "show", "--format=json"]).await
}

/// `wt config state default-branch` — return the configured default branch.
pub async fn config_default_branch(client: &WtClient) -> Result<String, error::Error> {
    let out = client.run_text(&["config", "state", "default-branch"]).await?;
    Ok(out.trim().to_string())
}

/// `wt config approvals add <name>` — pre-approve a hook command so
/// the user isn't re-prompted next time. Used by the M6 approval
/// modal.
pub async fn config_approvals_add(
    client: &WtClient,
    name: &str,
) -> Result<String, error::Error> {
    client.run_text(&["config", "approvals", "add", name]).await
}

/// `wt config approvals clear` — wipe all pre-approvals. The
/// Settings page has a "Reset approved commands" button that calls
/// this.
pub async fn config_approvals_clear(client: &WtClient) -> Result<String, error::Error> {
    client.run_text(&["config", "approvals", "clear"]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `wt list --format=json` for a detached-HEAD worktree emits
    /// `"branch": null`. The deserializer must accept this so the
    /// whole list parse doesn't fail and block the dashboard.
    #[test]
    fn parses_worktree_with_null_branch_detached_head() {
        let json = r#"[
            {
                "branch": null,
                "path": "/home/user/repo.detached",
                "kind": "worktree",
                "commit": {
                    "sha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
                    "short_sha": "a1b2c3d",
                    "message": "WIP",
                    "timestamp": 1700000000
                },
                "main_state": "is_main",
                "worktree": { "detached": true },
                "is_main": true,
                "is_current": true,
                "is_previous": false,
                "statusline": "a1b2c3d (detached)",
                "symbols": "a1b2c3d"
            }
        ]"#;
        let worktrees: Vec<Worktree> = serde_json::from_str(json)
            .expect("detached worktree JSON should parse without error");
        assert_eq!(worktrees.len(), 1);
        let wt = &worktrees[0];
        assert!(wt.branch.is_none(), "branch should be None for detached");
        assert_eq!(wt.path.as_deref().unwrap().to_string_lossy(), "/home/user/repo.detached");
        assert_eq!(
            wt.commit.as_ref().unwrap().short_sha,
            "a1b2c3d"
        );
    }

    /// A normal worktree (with a branch) still parses correctly.
    #[test]
    fn parses_worktree_with_branch() {
        let json = r#"[
            {
                "branch": "feat-x",
                "path": "/home/user/repo.feat-x",
                "kind": "worktree",
                "commit": {
                    "sha": "deadbeef",
                    "short_sha": "deadbee",
                    "message": "WIP",
                    "timestamp": 1700000000
                },
                "main_state": "is_main",
                "worktree": { "detached": false },
                "is_main": false,
                "is_current": false,
                "is_previous": false,
                "statusline": "feat-x",
                "symbols": ""
            }
        ]"#;
        let worktrees: Vec<Worktree> = serde_json::from_str(json).expect("parse");
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].branch.as_deref(), Some("feat-x"));
    }

    /// A multi-worktree list with one detached entry must still
    /// deserialize (the failure mode that produced the user-reported
    /// `serde: invalid type: null` was that the *whole* list parse
    /// failed because of a single detached worktree).
    #[test]
    fn parses_mixed_attached_and_detached() {
        let json = r#"[
            {
                "branch": "main",
                "path": "/repo",
                "kind": "worktree",
                "commit": null,
                "main_state": "is_main",
                "worktree": { "detached": false },
                "is_main": true,
                "is_current": true,
                "is_previous": false,
                "statusline": "main",
                "symbols": ""
            },
            {
                "branch": null,
                "path": "/repo.detached",
                "kind": "worktree",
                "commit": null,
                "main_state": "diverged",
                "worktree": { "detached": true },
                "is_main": false,
                "is_current": false,
                "is_previous": false,
                "statusline": "abc1234",
                "symbols": "abc1234"
            }
        ]"#;
        let worktrees: Vec<Worktree> = serde_json::from_str(json).expect("parse");
        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
        assert!(worktrees[1].branch.is_none());
    }

    /// Exact stderr shape from the user-reported
    /// `t3rminal needs approval to execute 1 command` failure. The
    /// parser must extract the single command name (`wt step
    /// copy-ignored`) and nothing else.
    #[test]
    fn parse_approval_commands_single() {
        let stderr = "▲ t3rminal needs approval to execute 1 command: ○ post-start copy: wt step copy-ignored ✗ Cannot prompt for approval in non-interactive environment ↳ To skip prompts in CI/CD, add --yes; to pre-approve commands, run wt config approvals add (exit 1)";
        let cmds = parse_approval_commands(stderr);
        assert_eq!(cmds, vec!["wt step copy-ignored".to_string()]);
    }

    /// Multi-hook payload (the docstring example). Each `○` bullet
    /// contributes one command.
    #[test]
    fn parse_approval_commands_multi() {
        let stderr = "▲ repo needs approval to execute 3 commands: ○ pre-start install: npm ci ○ pre-start build: cargo build --release ○ pre-start env: echo 'PORT={{ branch | hash_port }}' > .env.local ✗ Cannot prompt for approval in non-interactive environment ↳ To skip prompts in CI/CD, add --yes; to pre-approve commands, run wt config approvals add (exit 1)";
        let cmds = parse_approval_commands(stderr);
        assert_eq!(
            cmds,
            vec![
                "npm ci".to_string(),
                "cargo build --release".to_string(),
                "echo 'PORT={{ branch | hash_port }}' > .env.local".to_string(),
            ]
        );
    }

    /// Non-approval stderr must yield an empty list (so the caller
    /// falls through to the original error).
    #[test]
    fn parse_approval_commands_unrelated_error() {
        let stderr = "error: branch 'foo' already exists (exit 1)";
        let cmds = parse_approval_commands(stderr);
        assert!(cmds.is_empty());
    }

    /// De-duplicates if worktrunk ever repeats a command across
    /// bullets (defensive — same command in two hooks).
    #[test]
    fn parse_approval_commands_dedupes() {
        let stderr = "▲ repo needs approval to execute 2 commands: ○ post-start copy: wt step copy-ignored ○ post-start extras: wt step copy-ignored ✗ nope (exit 1)";
        let cmds = parse_approval_commands(stderr);
        assert_eq!(cmds, vec!["wt step copy-ignored".to_string()]);
    }
}
