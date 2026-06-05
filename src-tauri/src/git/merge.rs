//! Merge preview (M7).
//!
//! `wt merge <target>` does the actual merge via worktrunk (it does
//! the rebase + squash + commit + branch cleanup). Before the user
//! commits to that, gitsu shows a preview:
//!
//! - Is this a fast-forward? (target is reachable from source)
//! - Which files would change?
//! - Which files would conflict?
//!
//! The preview is computed via libgit2's `merge_trees` — we don't
//! touch the worktree's working directory or index, it's a pure
//! read of the three trees. The actual merge still happens via
//! `wt merge` so we get worktrunk's squash/rebase pipeline + hook
//! integration.

use std::path::Path;

use git2::{Index, MergeOptions, Repository};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Result of computing what *would* happen if the user ran
/// `wt merge <target>` from the current worktree. This is a preview
/// only — no working-tree state is changed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergePreview {
    /// The branch we're merging FROM (the worktree's current branch).
    pub source_branch: String,
    /// The branch we're merging INTO (the user's target).
    pub target_branch: String,
    /// SHA of the worktree's HEAD (source).
    pub source_head: String,
    /// SHA of the target branch's tip.
    pub target_head: String,
    /// SHA of the merge base (common ancestor).
    pub merge_base: String,
    /// `true` if the target is reachable from the source — the
    /// merge can be a fast-forward with no new commit.
    pub can_fast_forward: bool,
    /// Files that conflict (would block the merge).
    pub conflict_files: Vec<String>,
    /// Files that would change (modified or added/deleted) without conflict.
    pub clean_files: Vec<String>,
    /// Number of commits the source is ahead of the target (or 0
    /// if the target is ahead).
    pub ahead: u32,
    /// Number of commits the target is ahead of the source.
    pub behind: u32,
}

/// `MergeOpts` is currently empty but kept for forward-compat (e.g.
/// "compute preview for an octopus merge" or "ignore whitespace").
#[derive(Debug, Default, Deserialize)]
pub struct MergeOpts {
    #[serde(default)]
    pub _placeholder: (),
}

/// Compute a merge preview. The worktree path is the worktree whose
/// HEAD is the source; `target_branch` is a ref-name relative to the
/// same repo (e.g. "main", "origin/main", or a SHA).
pub fn preview(
    worktree: &Path,
    source_branch: &str,
    target_branch: &str,
    _opts: MergeOpts,
) -> Result<MergePreview> {
    let r = Repository::open(worktree).map_err(|e| Error::Git(format!("open: {e}")))?;

    // Resolve the two tips + their trees.
    let source_oid = resolve_ref(&r, source_branch)?;
    let target_oid = resolve_ref(&r, target_branch)?;
    if source_oid == target_oid {
        // Already up-to-date — return an empty preview.
        return Ok(MergePreview {
            source_branch: source_branch.to_string(),
            target_branch: target_branch.to_string(),
            source_head: source_oid.to_string(),
            target_head: target_oid.to_string(),
            merge_base: source_oid.to_string(),
            can_fast_forward: true,
            conflict_files: vec![],
            clean_files: vec![],
            ahead: 0,
            behind: 0,
        });
    }

    let source_tree = r
        .find_commit(source_oid)
        .map_err(|e| Error::Git(format!("find_commit source: {e}")))?
        .tree()
        .map_err(|e| Error::Git(format!("source tree: {e}")))?;
    let target_tree = r
        .find_commit(target_oid)
        .map_err(|e| Error::Git(format!("find_commit target: {e}")))?
        .tree()
        .map_err(|e| Error::Git(format!("target tree: {e}")))?;

    // Merge base.
    let merge_base_oid = r
        .merge_base(source_oid, target_oid)
        .map_err(|e| Error::Git(format!("merge_base: {e}")))?;
    let merge_base_tree = r
        .find_commit(merge_base_oid)
        .map_err(|e| Error::Git(format!("find_commit base: {e}")))?
        .tree()
        .map_err(|e| Error::Git(format!("base tree: {e}")))?;

    // Fast-forward check: target is reachable from source iff
    // target is *behind* source (source has commits target doesn't)
    // and not ahead. `graph_ahead_behind(target, source)` returns
    // `(target_ahead_of_source, target_behind_source)`.
    let (ahead, behind) = r
        .graph_ahead_behind(target_oid, source_oid)
        .map_err(|e| Error::Git(format!("graph_ahead_behind: {e}")))?;
    let can_fast_forward = ahead == 0 && behind > 0;

    // Compute the merge result index. This is a virtual index — it
    // doesn't touch the worktree. We use it to enumerate which files
    // would change and which would conflict.
    let mut opts = MergeOptions::new();
    opts.find_renames(true);
    let index: Index = r
        .merge_trees(
            &merge_base_tree,
            &target_tree,
            &source_tree,
            Some(&mut opts),
        )
        .map_err(|e| Error::Git(format!("merge_trees: {e}")))?;

    let mut conflict_files = Vec::new();
    let mut clean_files = Vec::new();
    if index.has_conflicts() {
        let conflicts = index.conflicts()?;
        for conflict in conflicts {
            let conflict = conflict?;
            let path = conflict
                .our
                .as_ref()
                .or(conflict.their.as_ref())
                .or(conflict.ancestor.as_ref())
                .map(|e| String::from_utf8_lossy(&e.path).into_owned())
                .unwrap_or_default();
            if !path.is_empty() {
                conflict_files.push(path);
            }
        }
    }

    // For the "clean files" list, walk all entries in the merge index
    // and report the ones that differ from BOTH the target tree and
    // the merge base (i.e., changed by the source side). We use the
    // merge base as the reference — entries that are in the merge
    // result but match both trees don't appear, entries that differ
    // from the base do.
    for entry in index.iter() {
        let path = String::from_utf8_lossy(&entry.path).into_owned();
        if path.is_empty() {
            continue;
        }
        if conflict_files.contains(&path) {
            continue;
        }
        // Compare the merge-result blob to the merge-base blob.
        let in_base = merge_base_tree
            .get_path(std::path::Path::new(&path))
            .ok()
            .map(|e| e.id() == entry.id)
            .unwrap_or(false);
        if !in_base {
            clean_files.push(path);
        }
    }

    Ok(MergePreview {
        source_branch: source_branch.to_string(),
        target_branch: target_branch.to_string(),
        source_head: source_oid.to_string(),
        target_head: target_oid.to_string(),
        merge_base: merge_base_oid.to_string(),
        can_fast_forward,
        conflict_files,
        clean_files,
        ahead: ahead as u32,
        behind: behind as u32,
    })
}

fn resolve_ref(r: &Repository, name: &str) -> Result<git2::Oid> {
    r.revparse_single(name)
        .map(|o| o.id())
        .map_err(|e| Error::Git(format!("revparse {name}: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, RepositoryInitOptions, Signature};

    fn make_tree<'a>(r: &'a Repository) -> git2::Tree<'a> {
        let oid = r.index().unwrap().write_tree().unwrap();
        r.find_tree(oid).unwrap()
    }

    fn commit<'a>(
        r: &'a Repository,
        sig: &Signature<'a>,
        ref_name: &str,
        msg: &str,
        parents: &[&git2::Commit<'a>],
    ) -> git2::Commit<'a> {
        let tree = make_tree(r);
        let oid = r.commit(Some(ref_name), sig, sig, msg, &tree, parents).unwrap();
        r.find_commit(oid).unwrap()
    }

    fn seed_files(r: &Repository, files: &[(&str, &str)]) {
        for (path, content) in files {
            let full = r.workdir().unwrap().join(path);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(&full, content).unwrap();
        }
        let mut index = r.index().unwrap();
        let paths: Vec<String> = files.iter().map(|(p, _)| p.to_string()).collect();
        let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        index
            .add_all(
                path_refs.iter().copied(),
                git2::IndexAddOption::DEFAULT,
                None,
            )
            .unwrap();
        index.write().unwrap();
    }

    fn make_tmp(label: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!(
            "gitsu-merge-{}-{}-{}",
            label,
            std::process::id(),
            nanos
        ));
        if tmp.exists() {
            std::fs::remove_dir_all(&tmp).ok();
        }
        std::fs::create_dir_all(&tmp).unwrap();
        tmp
    }

    fn init_repo(label: &str) -> Repository {
        let tmp = make_tmp(label);
        let r = Repository::init_opts(
            &tmp,
            RepositoryInitOptions::new().initial_head("main"),
        )
        .unwrap();
        let sig = Signature::now("t", "t@t.io").unwrap();
        seed_files(&r, &[("README.md", "# hello\n"), ("src/main.rs", "fn main() {}\n")]);
        let c1 = commit(&r, &sig, "refs/heads/main", "init", &[]);
        drop(c1);
        r
    }

    #[test]
    fn clean_merge_detects_changes_without_conflicts() {
        let tmp = make_tmp("clean");
        let r = Repository::init_opts(
            &tmp,
            RepositoryInitOptions::new().initial_head("main"),
        )
        .unwrap();
        let sig = Signature::now("t", "t@t.io").unwrap();
        seed_files(&r, &[("README.md", "a\n"), ("src/main.rs", "x\n")]);
        let c1 = commit(&r, &sig, "refs/heads/main", "init", &[]);
        // Branch: change README
        seed_files(&r, &[("README.md", "a (feat)\n")]);
        let _c2 = commit(&r, &sig, "refs/heads/feat", "edit README", &[&c1]);
        // Main: change src/main.rs (different file — no conflict)
        seed_files(&r, &[("src/main.rs", "x (main)\n")]);
        let _c3 = commit(&r, &sig, "refs/heads/main", "edit main.rs", &[&c1]);
        drop(c1);

        let p = preview(&tmp, "feat", "main", MergeOpts::default()).unwrap();
        assert!(p.conflict_files.is_empty(), "expected no conflicts, got {:?}", p.conflict_files);
        assert!(!p.can_fast_forward, "main has commits feat doesn't, no FF");
        assert!(p.clean_files.contains(&"README.md".to_string()));
        assert!(p.ahead >= 1, "feat should be ahead of main");
        assert!(p.behind >= 1, "main should be ahead of feat");
    }

    #[test]
    fn conflict_merge_detects_conflicting_file() {
        let tmp = make_tmp("conflict");
        let r = Repository::init_opts(
            &tmp,
            RepositoryInitOptions::new().initial_head("main"),
        )
        .unwrap();
        let sig = Signature::now("t", "t@t.io").unwrap();
        seed_files(&r, &[("README.md", "a\n")]);
        let c1 = commit(&r, &sig, "refs/heads/main", "init", &[]);
        // Branch: change README
        seed_files(&r, &[("README.md", "a (feat)\n")]);
        let _c2 = commit(&r, &sig, "refs/heads/feat", "edit README on feat", &[&c1]);
        // Main: change the SAME line of README
        seed_files(&r, &[("README.md", "a (main)\n")]);
        let _c3 = commit(&r, &sig, "refs/heads/main", "edit README on main", &[&c1]);
        drop(c1);

        let p = preview(&tmp, "feat", "main", MergeOpts::default()).unwrap();
        assert_eq!(p.conflict_files, vec!["README.md".to_string()]);
    }

    #[test]
    fn fast_forward_when_target_is_ancestor() {
        let tmp = make_tmp("ff");
        let r = Repository::init_opts(
            &tmp,
            RepositoryInitOptions::new().initial_head("main"),
        )
        .unwrap();
        let sig = Signature::now("t", "t@t.io").unwrap();
        seed_files(&r, &[("README.md", "a\n")]);
        let c1 = commit(&r, &sig, "refs/heads/main", "init", &[]);
        seed_files(&r, &[("README.md", "a (feat)\n"), ("src/main.rs", "x\n")]);
        let _c2 = commit(&r, &sig, "refs/heads/feat", "feat", &[&c1]);
        drop(c1);

        // main hasn't moved → target is reachable from feat → FF.
        let p = preview(&tmp, "feat", "main", MergeOpts::default()).unwrap();
        assert!(p.can_fast_forward, "expected fast-forward, got ahead={} behind={}", p.ahead, p.behind);
    }

    #[test]
    fn identical_branches_yield_empty_preview() {
        let tmp = make_tmp("id");
        let r = Repository::init_opts(
            &tmp,
            RepositoryInitOptions::new().initial_head("main"),
        )
        .unwrap();
        let sig = Signature::now("t", "t@t.io").unwrap();
        seed_files(&r, &[("README.md", "a\n")]);
        let _c1 = commit(&r, &sig, "refs/heads/main", "init", &[]);

        let p = preview(&tmp, "main", "main", MergeOpts::default()).unwrap();
        assert!(p.conflict_files.is_empty());
        assert!(p.clean_files.is_empty());
        assert!(p.can_fast_forward);
    }

    #[test]
    fn init_repo_helper_works() {
        // Sanity check that the test helper produces a valid repo.
        let _r = init_repo("helper");
    }
}
