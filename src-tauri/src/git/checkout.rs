//! Detached-HEAD checkout for the graph context menu ("checkout this
//! commit"). Branch checkouts go through `wt switch` (worktrunk owns
//! branch↔worktree mapping); this is only for pointing the *current*
//! worktree at an arbitrary commit.

use std::path::Path;

use git2::{build::CheckoutBuilder, Repository};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Result of `checkout_commit`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckoutResult {
    pub sha: String,
    pub short_sha: String,
    /// Always true today — this op never attaches to a branch.
    pub detached: bool,
}

/// Check out `refspec` (SHA, tag, …) in the worktree, detaching HEAD.
///
/// Uses libgit2's *safe* checkout strategy: local modifications that
/// would be clobbered by the target tree abort the call with a clear
/// error instead of being overwritten. Untracked files are preserved.
pub fn checkout_commit(worktree: &Path, refspec: &str) -> Result<CheckoutResult> {
    let r = Repository::discover(worktree)
        .map_err(|e| Error::Git(format!("open worktree: {e}")))?;
    let commit = r
        .revparse_single(refspec)
        .map_err(|e| Error::Git(format!("resolve `{refspec}`: {e}")))?
        .peel_to_commit()
        .map_err(|e| Error::Git(format!("`{refspec}` is not a commit: {e}")))?;

    let sha = commit.id().to_string();
    let short_sha = sha[..7].to_string();

    let mut opts = CheckoutBuilder::new();
    opts.safe();
    r.checkout_tree(commit.as_object(), Some(&mut opts))
        .map_err(|e| {
            Error::Git(format!(
                "checkout {short_sha}: {e} — commit or stash local changes first"
            ))
        })?;
    r.set_head_detached(commit.id())
        .map_err(|e| Error::Git(format!("detach HEAD at {short_sha}: {e}")))?;

    Ok(CheckoutResult {
        sha,
        short_sha,
        detached: true,
    })
}

// ── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{RepositoryInitOptions, Signature};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fresh_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("gitsu-checkout-{tag}-{nanos}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Two commits on `main`; returns (repo, first_sha).
    fn repo_with_two_commits(dir: &Path) -> (Repository, String) {
        let r = Repository::init_opts(dir, RepositoryInitOptions::new().initial_head("main"))
            .unwrap();
        let sig = Signature::now("tester", "t@test.io").unwrap();
        let mut commit_file = |content: &str, msg: &str| {
            std::fs::write(dir.join("file.txt"), content).unwrap();
            let mut index = r.index().unwrap();
            index.add_path(Path::new("file.txt")).unwrap();
            index.write().unwrap();
            let tree_oid = index.write_tree().unwrap();
            let tree = r.find_tree(tree_oid).unwrap();
            let parent = r.head().ok().and_then(|h| h.peel_to_commit().ok());
            let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
            r.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents)
                .unwrap()
                .to_string()
        };
        let first = commit_file("one\n", "first");
        commit_file("two\n", "second");
        (Repository::open(dir).unwrap(), first)
    }

    #[test]
    fn checkout_detaches_head_and_restores_tree() {
        let dir = fresh_dir("detach");
        let (r, first) = repo_with_two_commits(&dir);

        let res = checkout_commit(&dir, &first).unwrap();
        assert_eq!(res.sha, first);
        assert!(res.detached);
        assert!(r.head_detached().unwrap());
        assert_eq!(
            r.head().unwrap().peel_to_commit().unwrap().id().to_string(),
            first
        );
        assert_eq!(std::fs::read_to_string(dir.join("file.txt")).unwrap(), "one\n");
    }

    #[test]
    fn checkout_refuses_to_clobber_local_changes() {
        let dir = fresh_dir("dirty");
        let (r, first) = repo_with_two_commits(&dir);

        // Dirty the file that differs between the two commits.
        std::fs::write(dir.join("file.txt"), "local edit\n").unwrap();
        let err = checkout_commit(&dir, &first).unwrap_err();
        assert!(matches!(err, Error::Git(_)));
        // Nothing moved: HEAD still on main, edit preserved.
        assert!(!r.head_detached().unwrap());
        assert_eq!(
            std::fs::read_to_string(dir.join("file.txt")).unwrap(),
            "local edit\n"
        );
    }

    #[test]
    fn checkout_rejects_garbage_refspec() {
        let dir = fresh_dir("garbage");
        repo_with_two_commits(&dir);
        assert!(checkout_commit(&dir, "not-a-ref").is_err());
    }
}
