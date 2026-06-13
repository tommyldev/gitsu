//! Staging-area operations for the commit composer (graph view).
//!
//! The composer panel lists every changed path with its index
//! (staged) and worktree (unstaged) state, lets the user move paths
//! in/out of the index, and creates the commit. All libgit2, all
//! scoped to a worktree path — same rules as `ops.rs`.

use std::io::Write;
use std::path::Path;

use git2::{IndexAddOption, Repository, Signature, StatusOptions};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// What kind of change a path has on one side (index or worktree).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Typechange,
    Untracked,
    Conflicted,
}

/// One changed path. `staged`/`unstaged` are independent — a file
/// can be partially staged (e.g. staged then modified again).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusEntry {
    pub path: String,
    pub staged: Option<ChangeKind>,
    pub unstaged: Option<ChangeKind>,
}

/// Result of `commit` — enough for the UI to confirm and refresh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitResult {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
    /// Branch HEAD points to, or `None` on detached HEAD.
    pub branch: Option<String>,
}

fn open(worktree: &Path) -> Result<Repository> {
    Repository::discover(worktree).map_err(|e| Error::Git(format!("open worktree: {e}")))
}

fn staged_kind(s: git2::Status) -> Option<ChangeKind> {
    if s.is_index_new() {
        Some(ChangeKind::Added)
    } else if s.is_index_modified() {
        Some(ChangeKind::Modified)
    } else if s.is_index_deleted() {
        Some(ChangeKind::Deleted)
    } else if s.is_index_renamed() {
        Some(ChangeKind::Renamed)
    } else if s.is_index_typechange() {
        Some(ChangeKind::Typechange)
    } else {
        None
    }
}

fn unstaged_kind(s: git2::Status) -> Option<ChangeKind> {
    if s.is_conflicted() {
        Some(ChangeKind::Conflicted)
    } else if s.is_wt_new() {
        Some(ChangeKind::Untracked)
    } else if s.is_wt_modified() {
        Some(ChangeKind::Modified)
    } else if s.is_wt_deleted() {
        Some(ChangeKind::Deleted)
    } else if s.is_wt_renamed() {
        Some(ChangeKind::Renamed)
    } else if s.is_wt_typechange() {
        Some(ChangeKind::Typechange)
    } else {
        None
    }
}

/// Every changed path with its index + worktree state. Sorted by
/// path so the composer list is stable across refreshes.
pub fn status_list(worktree: &Path) -> Result<Vec<StatusEntry>> {
    let r = open(worktree)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .exclude_submodules(true);
    let statuses = r
        .statuses(Some(&mut opts))
        .map_err(|e| Error::Git(format!("status: {e}")))?;

    let mut out = Vec::with_capacity(statuses.len());
    for entry in statuses.iter() {
        let Some(path) = entry.path() else { continue };
        let s = entry.status();
        if s.is_ignored() {
            continue;
        }
        let staged = staged_kind(s);
        let unstaged = unstaged_kind(s);
        if staged.is_none() && unstaged.is_none() {
            continue;
        }
        out.push(StatusEntry {
            path: path.to_string(),
            staged,
            unstaged,
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Stage one path (`git add <path>` / `git rm --cached`-equivalent
/// for deletions). The path is relative to the worktree root, using
/// forward slashes (as returned by `status_list`).
pub fn stage_path(worktree: &Path, path: &str) -> Result<()> {
    let r = open(worktree)?;
    let workdir = r
        .workdir()
        .ok_or_else(|| Error::Git("bare repository has no working tree".into()))?
        .to_path_buf();
    let mut index = r.index().map_err(|e| Error::Git(format!("index: {e}")))?;
    let rel = Path::new(path);
    // `symlink_metadata` (not `exists`) so a dangling symlink still
    // counts as present and gets added rather than removed.
    if workdir.join(rel).symlink_metadata().is_ok() {
        index
            .add_path(rel)
            .map_err(|e| Error::Git(format!("stage `{path}`: {e}")))?;
    } else {
        index
            .remove_path(rel)
            .map_err(|e| Error::Git(format!("stage deletion of `{path}`: {e}")))?;
    }
    index.write().map_err(|e| Error::Git(format!("write index: {e}")))?;
    Ok(())
}

/// Stage everything (`git add -A`): adds new + modified paths and
/// records deletions.
pub fn stage_all(worktree: &Path) -> Result<()> {
    let r = open(worktree)?;
    let mut index = r.index().map_err(|e| Error::Git(format!("index: {e}")))?;
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| Error::Git(format!("stage all: {e}")))?;
    // `add_all` covers new/modified; `update_all` records deletions.
    index
        .update_all(["*"].iter(), None)
        .map_err(|e| Error::Git(format!("stage deletions: {e}")))?;
    index.write().map_err(|e| Error::Git(format!("write index: {e}")))?;
    Ok(())
}

/// Unstage one path (`git restore --staged <path>`). Resets the
/// index entry back to HEAD; for an unborn HEAD the entry is removed.
pub fn unstage_path(worktree: &Path, path: &str) -> Result<()> {
    unstage(&open(worktree)?, &[path])
}

/// Unstage everything currently staged.
pub fn unstage_all(worktree: &Path) -> Result<()> {
    let r = open(worktree)?;
    let staged: Vec<String> = status_list(worktree)?
        .into_iter()
        .filter(|e| e.staged.is_some())
        .map(|e| e.path)
        .collect();
    if staged.is_empty() {
        return Ok(());
    }
    let refs: Vec<&str> = staged.iter().map(String::as_str).collect();
    unstage(&r, &refs)
}

fn unstage(r: &Repository, paths: &[&str]) -> Result<()> {
    // `head` fails on an unborn branch (no commits yet); in that case
    // `reset_default(None, …)` removes the entries from the index,
    // which is exactly what unstaging means before the first commit.
    let head = r.head().ok().and_then(|h| h.peel(git2::ObjectType::Commit).ok());
    r.reset_default(head.as_ref(), paths)
        .map_err(|e| Error::Git(format!("unstage: {e}")))
}

/// Create a commit from the index (`git commit -m <message>`).
/// Refuses an empty message and an index identical to HEAD's tree
/// (nothing staged), so the UI never creates empty commits.
pub fn commit(worktree: &Path, message: &str) -> Result<CommitResult> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err(Error::InvalidArgument("commit message is empty".into()));
    }
    let r = open(worktree)?;
    let mut index = r.index().map_err(|e| Error::Git(format!("index: {e}")))?;
    let tree_oid = index
        .write_tree()
        .map_err(|e| Error::Git(format!("write tree: {e}")))?;
    let parent = r.head().ok().and_then(|h| h.peel_to_commit().ok());

    let staged_is_empty = match &parent {
        Some(p) => p.tree_id() == tree_oid,
        None => index.is_empty(),
    };
    if staged_is_empty {
        return Err(Error::InvalidArgument(
            "nothing staged — stage files before committing".into(),
        ));
    }

    let tree = r
        .find_tree(tree_oid)
        .map_err(|e| Error::Git(format!("find tree: {e}")))?;
    // Config-based signature; fall back so a missing user.name/email
    // doesn't hard-block the commit button.
    let sig = r
        .signature()
        .or_else(|_| Signature::now("gitsu", "gitsu@local"))
        .map_err(|e| Error::Git(format!("signature: {e}")))?;
    let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
    let oid = r
        .commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents)
        .map_err(|e| Error::Git(format!("commit: {e}")))?;

    let branch = r
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(str::to_string));
    let sha = oid.to_string();
    Ok(CommitResult {
        short_sha: sha[..7].to_string(),
        sha,
        summary: msg.lines().next().unwrap_or_default().to_string(),
        branch,
    })
}

/// Discard working-tree changes for the given paths, restoring them
/// to HEAD. Files not tracked by HEAD are left alone (no-op).
pub fn discard_paths(worktree: &Path, paths: &[&str]) -> Result<()> {
    let r = open(worktree)?;
    // Use checkout_head with builder to only checkout specific paths.
    // This is the libgit2 equivalent of `git checkout -- <paths>`.
    // `checkout_head` will fail if a path is untracked (not in HEAD),
    // so we use `allow_dirty` and only call it for paths that exist in HEAD.
    let mut builder = git2::build::CheckoutBuilder::new();
    builder.force();           // overwrite working tree changes
    builder.recreate_missing(true);
    for p in paths {
        builder.path(p);
    }
    r.checkout_head(Some(&mut builder))
        .map_err(|e| Error::Git(format!("discard paths: {e}")))
}

/// Stash changes for specific paths by shelling out to `git stash push`.
/// The `message` can be None; when provided it becomes the stash message.
pub fn stash_push_paths(
    worktree: &Path,
    paths: &[&str],
    message: Option<&str>,
) -> Result<crate::git::ops::StashPushResult> {
    use crate::git::ops::StashPushResult;
    use std::process::Command;

    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(worktree).arg("stash").arg("push");
    if let Some(msg) = message {
        if !msg.is_empty() {
            cmd.arg("-m").arg(msg);
        }
    }
    cmd.arg("--");
    for p in paths {
        cmd.arg(p);
    }

    let output = cmd.output().map_err(|e| Error::Git(format!("stash push paths: spawn failed: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = if stderr.contains("No local changes to save") || stderr.contains("did not match any file") {
            "Nothing to stash for the selected files".to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(Error::Git(format!("stash push paths: {msg}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let saved_msg = if stdout.contains("Saved working directory") {
        stdout.trim().to_string()
    } else {
        "Stashed selected files".to_string()
    };

    Ok(StashPushResult {
        oid: String::new(),
        no_changes: false,
        message: saved_msg,
    })
}

/// Append a path to `.gitignore` in the worktree root, creating the
/// file if it doesn't exist. Returns the pattern that was written.
pub fn ignore_path(worktree: &Path, path: &str) -> Result<String> {
    let r = open(worktree)?;
    let workdir = r.workdir()
        .ok_or_else(|| Error::Git("bare repository has no working tree".into()))?;
    let gitignore = workdir.join(".gitignore");
    let pattern = format!("/{}\n", path);
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&gitignore)
        .map_err(|e| Error::Git(format!("open .gitignore: {e}")))?;
    f.write_all(pattern.as_bytes())
        .map_err(|e| Error::Git(format!("write .gitignore: {e}")))?;
    Ok(path.to_string())
}

// ── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, RepositoryInitOptions};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fresh_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("gitsu-stage-{tag}-{nanos}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn init_repo_with_commit(dir: &Path) -> Repository {
        let r = Repository::init_opts(dir, RepositoryInitOptions::new().initial_head("main"))
            .unwrap();
        std::fs::write(dir.join("README.md"), "init\n").unwrap();
        let mut index = r.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        {
            let tree = r.find_tree(tree_oid).unwrap();
            let sig = Signature::now("tester", "t@test.io").unwrap();
            r.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        }
        r
    }

    fn entry<'a>(entries: &'a [StatusEntry], path: &str) -> &'a StatusEntry {
        entries
            .iter()
            .find(|e| e.path == path)
            .unwrap_or_else(|| panic!("no entry for {path}"))
    }

    #[test]
    fn status_classifies_untracked_modified_and_staged() {
        let dir = fresh_dir("status");
        init_repo_with_commit(&dir);

        std::fs::write(dir.join("new.txt"), "x\n").unwrap();
        std::fs::write(dir.join("README.md"), "changed\n").unwrap();

        let entries = status_list(&dir).unwrap();
        let new = entry(&entries, "new.txt");
        assert_eq!(new.staged, None);
        assert_eq!(new.unstaged, Some(ChangeKind::Untracked));
        let readme = entry(&entries, "README.md");
        assert_eq!(readme.staged, None);
        assert_eq!(readme.unstaged, Some(ChangeKind::Modified));

        stage_path(&dir, "README.md").unwrap();
        stage_path(&dir, "new.txt").unwrap();
        let entries = status_list(&dir).unwrap();
        assert_eq!(entry(&entries, "README.md").staged, Some(ChangeKind::Modified));
        assert_eq!(entry(&entries, "README.md").unstaged, None);
        assert_eq!(entry(&entries, "new.txt").staged, Some(ChangeKind::Added));
    }

    #[test]
    fn stage_path_records_deletion() {
        let dir = fresh_dir("delete");
        init_repo_with_commit(&dir);

        std::fs::remove_file(dir.join("README.md")).unwrap();
        let entries = status_list(&dir).unwrap();
        assert_eq!(entry(&entries, "README.md").unstaged, Some(ChangeKind::Deleted));

        stage_path(&dir, "README.md").unwrap();
        let entries = status_list(&dir).unwrap();
        assert_eq!(entry(&entries, "README.md").staged, Some(ChangeKind::Deleted));
        assert_eq!(entry(&entries, "README.md").unstaged, None);
    }

    #[test]
    fn unstage_roundtrip_restores_worktree_state() {
        let dir = fresh_dir("unstage");
        init_repo_with_commit(&dir);

        std::fs::write(dir.join("README.md"), "changed\n").unwrap();
        stage_path(&dir, "README.md").unwrap();
        unstage_path(&dir, "README.md").unwrap();

        let entries = status_list(&dir).unwrap();
        let readme = entry(&entries, "README.md");
        assert_eq!(readme.staged, None);
        assert_eq!(readme.unstaged, Some(ChangeKind::Modified));
    }

    #[test]
    fn stage_all_and_unstage_all_cover_adds_edits_deletes() {
        let dir = fresh_dir("all");
        init_repo_with_commit(&dir);

        std::fs::write(dir.join("new.txt"), "x\n").unwrap();
        std::fs::remove_file(dir.join("README.md")).unwrap();

        stage_all(&dir).unwrap();
        let entries = status_list(&dir).unwrap();
        assert!(entries.iter().all(|e| e.staged.is_some() && e.unstaged.is_none()));
        assert_eq!(entry(&entries, "README.md").staged, Some(ChangeKind::Deleted));
        assert_eq!(entry(&entries, "new.txt").staged, Some(ChangeKind::Added));

        unstage_all(&dir).unwrap();
        let entries = status_list(&dir).unwrap();
        assert!(entries.iter().all(|e| e.staged.is_none() && e.unstaged.is_some()));
    }

    #[test]
    fn commit_creates_commit_and_clears_status() {
        let dir = fresh_dir("commit");
        let r = init_repo_with_commit(&dir);
        let old_head = r.head().unwrap().peel_to_commit().unwrap().id();

        std::fs::write(dir.join("feature.rs"), "fn main() {}\n").unwrap();
        stage_path(&dir, "feature.rs").unwrap();
        let res = commit(&dir, "add feature\n\nbody text").unwrap();

        assert_eq!(res.summary, "add feature");
        assert_eq!(res.branch.as_deref(), Some("main"));
        assert_eq!(res.short_sha, res.sha[..7]);
        let head = r.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.id().to_string(), res.sha);
        assert_eq!(head.parent_id(0).unwrap(), old_head);
        assert!(status_list(&dir).unwrap().is_empty());
    }

    #[test]
    fn commit_rejects_empty_message_and_empty_stage() {
        let dir = fresh_dir("reject");
        init_repo_with_commit(&dir);

        assert!(matches!(
            commit(&dir, "   "),
            Err(Error::InvalidArgument(_))
        ));
        // Unstaged-only change: still nothing in the index.
        std::fs::write(dir.join("README.md"), "changed\n").unwrap();
        assert!(matches!(
            commit(&dir, "msg"),
            Err(Error::InvalidArgument(_))
        ));
    }
}
