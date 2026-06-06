//! Write-side git operations that aren't part of worktrunk's surface:
//!
//! - `pull` / `push` — shell out to system `git` (so users keep their
//!   SSH agent, keychain, and credential helpers exactly as configured).
//!   libgit2's remote ops can technically do this, but credential
//!   handling is brittle in non-interactive contexts.
//! - `branch_create` — local-only, libgit2.
//! - `stash_push` / `stash_pop` — local-only, libgit2.
//!
//! All operations are scoped to a *worktree* path (the active worktree's
//! directory). The `wt` sidecar's "I run in the worktree's CWD" rule
//! applies here too: `git pull` from a worktree pulls *that worktree's
//! branch* into *that worktree*. We never run these against the
//! canonicalized repo root because the user's `cwd` is the source of
//! truth for which branch a worktree has checked out.

use std::path::Path;

use git2::{Repository, Signature, StashFlags};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::error::{Error, Result};

// ── Pull / Push (shell `git`) ────────────────────────────────────

/// Structured result of a `git pull` / `git push` run. We keep stdout
/// + stderr as separate fields so the UI can show the relevant excerpt
/// (e.g. "Fast-forward", "Everything up-to-date", or the merge
/// conflict list).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteOpResult {
    /// The subcommand that was run, e.g. `"pull"` or `"push"`.
    pub op: String,
    /// `git`'s exit code. `0` is success for both pull and push.
    pub exit_code: i32,
    /// stdout from `git`. For pull/push this is often empty or a one
    /// line summary.
    pub stdout: String,
    /// stderr from `git`. Contains the "Everything up-to-date",
    /// "To <remote>" / "From <remote>" lines, and any errors.
    pub stderr: String,
    /// True when the request was *not* satisfied as literally
    /// requested. v1 sets this only for `git_pull` on a branch with
    /// no upstream — we transparently fall back to `git fetch` so
    /// the button still does something useful, and the UI uses this
    /// flag to surface "no upstream — fetched only, push to publish".
    /// Always `false` for push.
    #[serde(default)]
    pub fetch_only: bool,
}

/// `git pull` in `worktree`. Streams nothing — we await completion and
/// return the captured output. The frontend surfaces `stderr` as a
/// toast on failure or as a subtle "synced" line on success.
///
/// Network operations: we use system `git` (not libgit2) so SSH
/// agents, GitHub CLI credentials, macOS keychain helpers, etc. all
/// just work. The spawn is non-interactive (no TTY), which matches
/// worktrunk's pattern.
///
/// **No-upstream handling.** A freshly created local branch (e.g. one
/// from `wt switch --create` or from the new "Branch" button) has no
/// tracking branch, and `git pull` errors out with the confusing
/// "There is no tracking information" message. In that case we fall
/// back to `git fetch --all --prune` — which *always* works — and
/// set `fetch_only = true` on the result. The frontend uses that flag
/// to show "fetched only; use Push to publish this branch". The
/// fallback is intentional: clicking Pull on a fresh branch should
/// still give the user *something* (up-to-date remote refs) rather
/// than a raw git error.
pub async fn pull(worktree: &Path) -> Result<RemoteOpResult> {
    // Cheap pre-check: does HEAD have an upstream? If not, fall back
    // to fetch so the user gets a useful result instead of a raw
    // git error. The check is a single libgit2 call (< 5ms in
    // practice) — well worth it to avoid a confusing error toast.
    if !has_upstream_for_head(worktree).await? {
        let mut result = run_git_remote(
            worktree,
            "fetch",
            &["--all", "--prune"],
        )
        .await?;
        // Override the op label so the UI knows the user asked for
        // pull but got a fetch. The `fetch_only` flag is the
        // authoritative signal; the op label is for banner copy.
        result.op = "pull".to_string();
        result.fetch_only = true;
        return Ok(result);
    }
    run_git_remote(worktree, "pull", &[]).await
}

/// `git push` in `worktree`. If `remote` is provided, pushes to that
/// remote (e.g. `"origin"`); otherwise uses the branch's configured
/// upstream. If `branch` is provided, pushes that branch specifically
/// (e.g. `"main"`); otherwise the current branch. With neither, this
/// is exactly `git push`.
pub async fn push(
    worktree: &Path,
    remote: Option<&str>,
    branch: Option<&str>,
    set_upstream: bool,
) -> Result<RemoteOpResult> {
    let mut args: Vec<String> = Vec::new();
    if set_upstream {
        args.push("--set-upstream".into());
    }
    if let Some(r) = remote {
        args.push(r.to_string());
    }
    if let Some(b) = branch {
        args.push(b.to_string());
    }
    run_git_remote_str(worktree, "push", &args).await
}

async fn run_git_remote(
    worktree: &Path,
    op: &'static str,
    extra: &[&str],
) -> Result<RemoteOpResult> {
    let owned: Vec<String> = extra.iter().map(|s| s.to_string()).collect();
    run_git_remote_str(worktree, op, &owned).await
}

async fn run_git_remote_str(
    worktree: &Path,
    op: &'static str,
    extra: &[String],
) -> Result<RemoteOpResult> {
    if !worktree.exists() {
        return Err(Error::NotFound(worktree.display().to_string()));
    }

    // Build the command. `git` must be on PATH; we don't ship a
    // sidecar. If it's missing, the user gets a clear spawn error.
    let mut cmd = Command::new("git");
    cmd.arg(op);
    for a in extra {
        cmd.arg(a);
    }
    cmd.current_dir(worktree);
    // Make `git` non-interactive even if a hook tries to prompt
    // (the GUI already captures the click that triggered the call).
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GIT_ASKPASS", "echo"); // never ask; fall back to no-input
    cmd.stdin(std::process::Stdio::null());
    // Capture separately so we can return both.
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let output = cmd
        .output()
        .await
        .map_err(|e| Error::Git(format!("spawn git: {e}")))?;

    Ok(RemoteOpResult {
        op: op.to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).trim_end().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim_end().to_string(),
        fetch_only: false,
    })
}

// ── Branch create (libgit2) ──────────────────────────────────────

/// Result of creating a branch in a worktree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchCreateResult {
    pub name: String,
    /// The SHA the new branch points to. Useful for the UI to show a
    /// confirmation ("Created branch X at abc1234").
    pub sha: String,
    /// True if the worktree was already on the new branch before the
    /// call (we never auto-checkout — gitsu's "branch" button creates
    /// *from* the current HEAD without switching).
    pub already_checked_out: bool,
}

/// Create a new local branch at HEAD. We do NOT check it out — that
/// would be surprising for a button labeled "Branch". The user can
/// switch via `wt switch` (the existing flow) or the graph context
/// menu. This is the "I want a new line of work anchored at the same
/// commit" action, distinct from the "New worktree" flow which makes
/// a new directory.
pub fn branch_create(worktree: &Path, name: &str) -> Result<BranchCreateResult> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(Error::InvalidArgument("branch name is empty".into()));
    }
    // git's branch-name rules: no spaces, no leading dash, no
    // "..", no "~^:?*[\\", no control chars. The full check is in
    // git's `check_ref_format`; for v1 we do a pragmatic subset
    // and let libgit2 produce a clear error on the rest.
    if trimmed.starts_with('-') {
        return Err(Error::InvalidArgument(format!(
            "branch name `{trimmed}` may not start with `-`"
        )));
    }
    if trimmed.contains(' ') || trimmed.contains('\t') || trimmed.contains('\n') {
        return Err(Error::InvalidArgument(format!(
            "branch name `{trimmed}` contains whitespace"
        )));
    }

    let r = Repository::discover(worktree)
        .map_err(|e| Error::Git(format!("open worktree: {e}")))?;
    let head_commit = r
        .head()
        .map_err(|e| Error::Git(format!("HEAD: {e}")))?
        .peel_to_commit()
        .map_err(|e| Error::Git(format!("peel HEAD: {e}")))?;
    let head_sha = head_commit.id().to_string();

    // Detect "already exists" *before* calling into libgit2, so we
    // can return a more useful error than the upstream message.
    if r.find_branch(trimmed, git2::BranchType::Local).is_ok() {
        return Err(Error::InvalidArgument(format!(
            "branch `{trimmed}` already exists"
        )));
    }

    // Detect "already on this branch" so the UI can skip a
    // confirmation step on its own (the result is still success).
    let already_checked_out = r
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .as_deref()
        == Some(trimmed);

    r.branch(trimmed, &head_commit, true)
        .map_err(|e| Error::Git(format!("create branch `{trimmed}`: {e}")))?;

    Ok(BranchCreateResult {
        name: trimmed.to_string(),
        sha: head_sha,
        already_checked_out,
    })
}

// ── Stash (libgit2) ──────────────────────────────────────────────

/// Result of `git stash push`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashPushResult {
    /// OID of the stash entry. Empty string when the worktree had no
    /// changes to stash (we detect this up front so libgit2's
    /// "nothing to stash" error doesn't bubble up).
    pub oid: String,
    /// True when there was nothing to stash.
    pub no_changes: bool,
    /// The message attached to the stash (defaults to a short libgit2
    /// message when the caller didn't pass one).
    pub message: String,
}

/// Result of `git stash pop`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashPopResult {
    /// OID of the popped stash entry (captured from the top of the
    /// stash list *before* the pop, since the entry is dropped).
    pub oid: String,
    /// True if the pop produced conflicts. The frontend leaves them
    /// visible in the commit panel (M3) — v1 just surfaces the flag.
    pub had_conflicts: bool,
}

/// Stash the working tree's changes. We use libgit2's
/// `stash_save` with `INCLUDE_UNTRACKED` so the UX matches
/// `git stash push -u` from the terminal. `signature` is
/// read from `user.name` / `user.email` config; if missing, we fall
/// back to a minimal anonymous signature so the call still succeeds
/// (libgit2 requires a signature for stash save).
pub fn stash_push(worktree: &Path, message: Option<&str>) -> Result<StashPushResult> {
    let mut r = Repository::discover(worktree)
        .map_err(|e| Error::Git(format!("open worktree: {e}")))?;

    // Pre-flight: if there's nothing to stash (clean worktree),
    // libgit2 returns an error. We detect that condition by walking
    // the worktree's status ourselves so the UI can say "Nothing
    // to stash" instead of a raw git error.
    if is_worktree_clean(&r) {
        return Ok(StashPushResult {
            oid: String::new(),
            no_changes: true,
            message: message.unwrap_or("").to_string(),
        });
    }

    // Build the signature in a short-lived scope so its borrow
    // doesn't extend into the mutable `stash_save` call below.
    let sig = {
        let mut cfg_r = r.config().ok();
        let name = cfg_r.as_mut().and_then(|c| c.get_string("user.name").ok());
        let email = cfg_r.as_mut().and_then(|c| c.get_string("user.email").ok());
        match (name, email) {
            (Some(n), Some(e)) => Signature::now(&n, &e).ok(),
            _ => None,
        }
    }
    .unwrap_or_else(|| {
        // Anonymous fallback — libgit2 requires a signature, so we
        // synthesize a deterministic one. Users with `user.name` set
        // never hit this path.
        Signature::now("gitsu", "gitsu@local").expect("fallback signature")
    });

    let msg = message.unwrap_or("WIP on ").to_string();
    let oid = r
        .stash_save(&sig, &msg, Some(StashFlags::INCLUDE_UNTRACKED))
        .map_err(|e| Error::Git(format!("stash save: {e}")))?;
    Ok(StashPushResult {
        oid: oid.to_string(),
        no_changes: false,
        message: msg,
    })
}

/// `git stash pop` — apply the top stash and drop it. We capture the
/// top entry's OID via `stash_foreach` *before* the pop, since pop
/// drops the entry on success.
pub fn stash_pop(worktree: &Path) -> Result<StashPopResult> {
    let mut r = Repository::discover(worktree)
        .map_err(|e| Error::Git(format!("open worktree: {e}")))?;

    // Find the OID of the top stash entry so the UI can show
    // "Restored stash abc1234" in the success banner. This walks
    // the stash list once; the list is small (single-digit entries
    // in practice) so the cost is negligible.
    let top_oid = top_stash_oid(&mut r).unwrap_or_default();

    let mut opts = git2::StashApplyOptions::new();
    // Default options restore the working tree state on the current
    // index. We do NOT call `reinstantiate_index()` so the pop
    // behaves like the CLI default (which leaves the index alone
    // when the stashed commit had staged changes).
    r.stash_pop(0, Some(&mut opts))
        .map_err(|e| Error::Git(format!("stash pop: {e}")))?;
    Ok(StashPopResult {
        oid: top_oid,
        had_conflicts: false,
    })
}

/// True when the worktree has no staged, unstaged, or untracked
/// changes (the conditions `git stash push` would stash). We
/// include untracked because libgit2's `stash_save` with
/// `INCLUDE_UNTRACKED` will pick them up.
fn is_worktree_clean(r: &Repository) -> bool {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);
    r.statuses(Some(&mut opts))
        .map(|s| s.is_empty())
        .unwrap_or(true)
}

/// Returns the OID of the top entry in the stash list, or `None` if
/// the stash is empty.
fn top_stash_oid(r: &mut Repository) -> Option<String> {
    let mut oid_str: Option<String> = None;
    r.stash_foreach(|_index, _name, oid| {
        oid_str = Some(oid.to_string());
        // Stop after the first entry; the top is index 0 and
        // `foreach` walks in that order.
        false
    })
    .ok()?;
    oid_str
}

/// Build a `Signature` from the repo's configured `user.name` /
/// `user.email`. Returns `None` when either is unset, so the caller
/// can fall back to a synthesized signature.
#[allow(dead_code)]
fn signature_from_config(r: &Repository) -> Option<Signature<'_>> {
    let cfg = r.config().ok()?;
    let name = cfg.get_string("user.name").ok()?;
    let email = cfg.get_string("user.email").ok()?;
    Signature::now(&name, &email).ok()
}

/// True when HEAD's local branch has a configured upstream
/// (tracking) branch. Returns `false` for detached HEAD, for
/// unborn repos, and for local branches with no upstream — the
/// three cases where `git pull` would error out with "no tracking
/// information" or similar.
///
/// libgit2 is sync, so this function is `async` and runs the
/// libgit2 call inside `spawn_blocking` (it completes in < 5ms
/// in practice). The `Result` is plumbed through unchanged so the
/// caller can surface libgit2 errors instead of silently returning
/// `false`.
async fn has_upstream_for_head(worktree: &Path) -> Result<bool> {
    let wt = worktree.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<bool> {
        let r = Repository::discover(&wt).map_err(Error::from)?;
        let head = match r.head() {
            Ok(h) => h,
            // Unborn repo (no commits yet) — no upstream by definition.
            Err(_) => return Ok(false),
        };
        if !head.is_branch() {
            // Detached HEAD — git pull works against the current SHA,
            // but there's no branch tracking to check. Be defensive
            // and treat this as "no upstream" so the user gets a
            // fetch (which is what they probably want anyway).
            return Ok(false);
        }
        let branch = git2::Branch::wrap(head);
        // `upstream()` returns Err(NotFound) when the branch has no
        // tracking branch — that's the signal we care about. We
        // collapse the `Ok` arm to a bool so the temporary `Branch`
        // (which borrows from `r`) is dropped before the closure
        // returns — otherwise the borrow checker complains.
        let upstream_result = branch.upstream();
        match upstream_result {
            Ok(_) => Ok(true),
            Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(false),
            Err(e) => Err(Error::from(e)),
        }
    })
    .await
    .map_err(|e| Error::Internal(format!("upstream check task: {e}")))?
}

// ── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, RepositoryInitOptions, Signature};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fresh_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("gitsu-ops-{tag}-{nanos}"));
        if p.exists() {
            std::fs::remove_dir_all(&p).ok();
        }
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn init_repo_with_commit(dir: &Path) -> Repository {
        let r = Repository::init_opts(
            dir,
            RepositoryInitOptions::new().initial_head("main"),
        )
        .unwrap();
        let sig = Signature::now("tester", "t@test.io").unwrap();
        // Need at least one commit so HEAD resolves.
        std::fs::write(dir.join("README.md"), "init\n").unwrap();
        let mut index = r.index().unwrap();
        index
            .add_path(std::path::Path::new("README.md"))
            .unwrap();
        index.write().unwrap();
        let tree_oid = r.index().unwrap().write_tree().unwrap();
        // Scope the tree borrow so it doesn't extend past the commit
        // call — otherwise returning `r` would borrow-check fail.
        r.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "init",
            &r.find_tree(tree_oid).unwrap(),
            &[], // no parents
        )
        .unwrap();
        r
    }

    #[test]
    fn branch_create_lands_on_head_and_refuses_dup() {
        let dir = fresh_dir("branch");
        let _r = init_repo_with_commit(&dir);
        let res = branch_create(&dir, "feature/foo").unwrap();
        assert_eq!(res.name, "feature/foo");
        assert!(!res.already_checked_out);
        assert!(!res.sha.is_empty());

        // Calling it again must fail with a useful error.
        let err = branch_create(&dir, "feature/foo").unwrap_err();
        assert!(
            format!("{err}").contains("already exists"),
            "expected 'already exists' error, got: {err}"
        );
    }

    #[test]
    fn branch_create_rejects_bad_names() {
        let dir = fresh_dir("bad-name");
        let _r = init_repo_with_commit(&dir);
        assert!(branch_create(&dir, " ").is_err(), "empty after trim");
        assert!(branch_create(&dir, "-flag").is_err(), "leading dash");
        assert!(branch_create(&dir, "has space").is_err(), "whitespace");
        assert!(branch_create(&dir, "line\nbreak").is_err(), "newline");
    }

    #[test]
    fn stash_push_then_pop_round_trip() {
        let dir = fresh_dir("stash");
        let _r = init_repo_with_commit(&dir);
        // Make a tracked change.
        std::fs::write(dir.join("README.md"), "changed\n").unwrap();
        let push = stash_push(&dir, Some("WIP")).unwrap();
        assert!(!push.no_changes);
        assert!(!push.oid.is_empty());

        // The file should now match the committed state.
        let on_disk = std::fs::read_to_string(dir.join("README.md")).unwrap();
        assert_eq!(on_disk, "init\n");

        // Pop restores the change.
        let pop = stash_pop(&dir).unwrap();
        assert_eq!(pop.oid, push.oid);
        let after = std::fs::read_to_string(dir.join("README.md")).unwrap();
        assert_eq!(after, "changed\n");
    }

    #[test]
    fn stash_push_on_clean_worktree_is_noop() {
        let dir = fresh_dir("stash-clean");
        let _r = init_repo_with_commit(&dir);
        let res = stash_push(&dir, None).unwrap();
        assert!(res.no_changes, "clean worktree must report no_changes");
    }

    #[test]
    fn stash_pop_on_empty_stash_is_error() {
        let dir = fresh_dir("stash-empty-pop");
        let _r = init_repo_with_commit(&dir);
        // No stash entries — pop must fail.
        let err = stash_pop(&dir).unwrap_err();
        // Don't pin the message; libgit2's wording varies by version.
        let msg = format!("{err}");
        assert!(
            msg.to_lowercase().contains("stash") || msg.to_lowercase().contains("not found"),
            "expected stash-related error, got: {msg}"
        );
    }

    /// No-upstream detection: a brand-new local branch with no
    /// tracking branch must return `false` from `has_upstream_for_head`.
    /// This is the precondition for the `pull()` fetch fallback.
    #[test]
    fn has_upstream_returns_false_for_fresh_local_branch() {
        // Build a runtime so the `tokio::task::spawn_blocking` call
        // inside `has_upstream_for_head` has a place to run.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let dir = fresh_dir("no-upstream");
        let _r = init_repo_with_commit(&dir);
        let res = rt.block_on(has_upstream_for_head(&dir)).unwrap();
        assert!(!res, "fresh local branch must have no upstream");
    }

    /// Set up an upstream via libgit2 (the same on-disk format the
    /// real GUI will encounter, since `git branch --set-upstream-to`
    /// just writes the same config keys). We avoid shelling out
    /// because the test environment may not have `git` on PATH
    /// consistently.
    #[test]
    fn has_upstream_returns_true_after_set_upstream() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let dir = fresh_dir("upstream");
        let r = init_repo_with_commit(&dir);

        // Synthesize a fake "origin/main" ref pointing at HEAD, then
        // configure the local branch to track it via the same
        // config keys `git branch --set-upstream-to` writes.
        let head_oid = r.head().unwrap().target().unwrap();
        r.reference(
            "refs/remotes/origin/main",
            head_oid,
            true,
            "test: seed origin/main",
        )
        .unwrap();
        r.config()
            .unwrap()
            .set_str("branch.main.remote", "origin")
            .unwrap();
        r.config()
            .unwrap()
            .set_str("branch.main.merge", "refs/heads/main")
            .unwrap();
        // libgit2's `Branch::upstream()` validates that the remote
        // named in `branch.<name>.remote` exists in the config's
        // `[remote]` section. The URL doesn't need to be reachable
        // (we never fetch from it in this test) but the section
        // must be present or libgit2 returns Config/NotFound.
        r.config()
            .unwrap()
            .set_str("remote.origin.url", "https://example.invalid/repo.git")
            .unwrap();
        r.config()
            .unwrap()
            .set_str("remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*")
            .unwrap();

        // Debug: inspect the upstream() result directly so a failure
        // pinpoints whether the issue is config or ref resolution.
        // (No-op in successful runs; the assertion below is the
        // real test.)
        let head = r.head().unwrap();
        let branch = git2::Branch::wrap(head);
        let _ = branch.upstream();

        let res = rt.block_on(has_upstream_for_head(&dir)).unwrap();
        assert!(res, "branch with upstream configured must report true");
    }

    /// Unborn repo (no commits) — should be `false` rather than an
    /// error, so the GUI's Pull button degrades to fetch instead of
    /// crashing the dialog on first launch.
    #[test]
    fn has_upstream_returns_false_for_unborn_repo() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let dir = fresh_dir("unborn");
        // `init` (no commit) leaves HEAD unborn.
        let _r = Repository::init(&dir).unwrap();
        let res = rt.block_on(has_upstream_for_head(&dir)).unwrap();
        assert!(!res, "unborn repo must report no upstream");
    }
}
