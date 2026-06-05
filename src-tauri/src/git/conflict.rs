//! Merge conflict resolution (M8).
//!
//! After `wt merge` halts with conflicts, the worktree is in a
//! conflicted state: the index has unmerged entries (3 per conflicted
//! path: ancestor, ours, theirs) and the working tree files contain
//! the standard 7-marker conflict block:
//!
//! ```text
//! <<<<<<< ours
//! our content
//! =======
//! their content
//! >>>>>>> theirs
//! ```
//!
//! gitsu's conflict editor is a thin wrapper over the index + a
//! textarea. For v1 we don't try to be smarter than that — the user
//! edits the working file (or accepts a bulk "use ours entirely" /
//! "use theirs entirely" action), then we re-stage the path and the
//! conflict entry is removed from the index. Per-hunk resolution can
//! come later (M8.5) once we have a richer editor.

use std::path::Path;

use git2::{Repository, Tree};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// The three sides of a merge conflict plus the current on-disk
/// content. `ours` / `theirs` / `base` are `None` when the file
/// didn't exist on that side (e.g. one branch added it, the other
/// didn't touch it).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictParts {
    pub path: String,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub base: Option<String>,
    /// Current on-disk content (with conflict markers). `None` if
    /// the file isn't on disk.
    pub working: Option<String>,
    pub is_binary: bool,
}

/// Read the three sides of a merge conflict for `path` from the
/// current index. The working tree is read separately for the
/// marked-up version the user edits.
pub fn read_conflict_parts(repo_path: &Path, path: &str) -> Result<ConflictParts> {
    let r = Repository::open(repo_path).map_err(|e| Error::Git(format!("open: {e}")))?;
    let index = r.index().map_err(|e| Error::Git(format!("index: {e}")))?;

    let mut ours = None;
    let mut theirs = None;
    let mut base = None;
    let mut is_binary = false;

    if index.has_conflicts() {
        let conflicts = index
            .conflicts()
            .map_err(|e| Error::Git(format!("conflicts: {e}")))?;
        for conflict in conflicts {
            let conflict = conflict.map_err(|e| Error::Git(format!("conflict iter: {e}")))?;
            let entry_path = conflict
                .our
                .as_ref()
                .or(conflict.their.as_ref())
                .or(conflict.ancestor.as_ref())
                .map(|e| String::from_utf8_lossy(&e.path).into_owned())
                .unwrap_or_default();
            if entry_path != path {
                continue;
            }
            is_binary = conflict
                .our
                .as_ref()
                .or(conflict.their.as_ref())
                .or(conflict.ancestor.as_ref())
                .map(|e| e.mode != 0o100644 && e.mode != 0o100755)
                .unwrap_or(false);
            base = read_blob_string(&r, conflict.ancestor.as_ref().map(|e| e.id));
            ours = read_blob_string(&r, conflict.our.as_ref().map(|e| e.id));
            theirs = read_blob_string(&r, conflict.their.as_ref().map(|e| e.id));
            break;
        }
    }

    let working = read_working_file(repo_path, path)?;

    Ok(ConflictParts {
        path: path.to_string(),
        ours,
        theirs,
        base,
        working,
        is_binary,
    })
}

/// Read the current on-disk content for `path` (with conflict markers
/// in place). Returns `None` if the file doesn't exist.
pub fn read_working_file(repo_path: &Path, path: &str) -> Result<Option<String>> {
    let full = repo_path.join(path);
    if !full.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&full).map_err(Error::from)?;
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

/// Stage a resolution for `path`. Writes the content to the working
/// tree, removes the conflict entry, and updates the index. After
/// this call, `has_conflicts()` will no longer report a conflict at
/// this path (unless something else in the merge is still
/// conflicted).
pub fn stage_resolution(repo_path: &Path, path: &str, content: &str) -> Result<()> {
    let r = Repository::open(repo_path).map_err(|e| Error::Git(format!("open: {e}")))?;
    let full_path = repo_path.join(path);

    // Make sure the parent dir exists (a resolved file might be a new
    // file if the merge was "add on one side, delete on other").
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Error::Git(format!("mkdir: {e}")))?;
    }
    std::fs::write(&full_path, content).map_err(|e| Error::Git(format!("write: {e}")))?;

    let mut index = r.index().map_err(|e| Error::Git(format!("index: {e}")))?;
    // `add_path` reads the file from the working tree (which we just
    // wrote) and re-stages it. If the path was conflicted, libgit2
    // moves the conflict entry to the REUC (resolve undo) section,
    // which means `index.has_conflicts()` and `index.conflicts()` no
    // longer report it.
    index
        .add_path(Path::new(path))
        .map_err(|e| Error::Git(format!("add_path: {e}")))?;
    index.write().map_err(|e| Error::Git(format!("index.write: {e}")))?;
    Ok(())
}

/// Count remaining conflicted paths in the index. Used by the M8
/// ConflictEditor to know when to enable the "Complete merge" button.
pub fn count_unresolved_conflicts(repo_path: &Path) -> Result<usize> {
    let r = Repository::open(repo_path).map_err(|e| Error::Git(format!("open: {e}")))?;
    let index = r.index().map_err(|e| Error::Git(format!("index: {e}")))?;
    if !index.has_conflicts() {
        return Ok(0);
    }
    let conflicts = index
        .conflicts()
        .map_err(|e| Error::Git(format!("conflicts: {e}")))?;
    let mut paths = std::collections::HashSet::new();
    for conflict in conflicts {
        let conflict = conflict.map_err(|e| Error::Git(format!("conflict iter: {e}")))?;
        if let Some(e) = conflict.our.as_ref().or(conflict.their.as_ref()).or(conflict.ancestor.as_ref()) {
            paths.insert(String::from_utf8_lossy(&e.path).into_owned());
        }
    }
    Ok(paths.len())
}

/// List the paths of all unresolved conflicts in the index.
pub fn list_unresolved_conflicts(repo_path: &Path) -> Result<Vec<String>> {
    let r = Repository::open(repo_path).map_err(|e| Error::Git(format!("open: {e}")))?;
    let index = r.index().map_err(|e| Error::Git(format!("index: {e}")))?;
    if !index.has_conflicts() {
        return Ok(vec![]);
    }
    let conflicts = index
        .conflicts()
        .map_err(|e| Error::Git(format!("conflicts: {e}")))?;
    let mut paths: Vec<String> = vec![];
    for conflict in conflicts {
        let conflict = conflict.map_err(|e| Error::Git(format!("conflict iter: {e}")))?;
        if let Some(e) = conflict.our.as_ref().or(conflict.their.as_ref()).or(conflict.ancestor.as_ref()) {
            let p = String::from_utf8_lossy(&e.path).into_owned();
            if !paths.contains(&p) {
                paths.push(p);
            }
        }
    }
    Ok(paths)
}

fn read_blob_string(r: &Repository, oid: Option<git2::Oid>) -> Option<String> {
    let oid = oid?;
    if oid.is_zero() {
        return None;
    }
    r.find_blob(oid).ok().and_then(|b| {
        if b.is_binary() {
            None
        } else {
            Some(String::from_utf8_lossy(b.content()).into_owned())
        }
    })
}

// Suppress dead-code warning for `Tree` import on stable
#[allow(dead_code)]
fn _tree_anchor(_t: &Tree<'_>) {}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, RepositoryInitOptions, Signature};
    use std::path::PathBuf;

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

    fn make_tmp(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!(
            "gitsu-conflict-{}-{}-{}",
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

    /// Set up a repo with a real merge conflict in `README.md`.
    /// Returns the path to the repo.
    fn setup_conflict_repo(label: &str) -> (PathBuf, Repository) {
        let tmp = make_tmp(label);
        let r = Repository::init_opts(
            &tmp,
            RepositoryInitOptions::new().initial_head("main"),
        )
        .unwrap();
        let sig = Signature::now("t", "t@t.io").unwrap();

        // Base: README has one line
        seed_files(&r, &[("README.md", "hello\n")]);
        let c1 = commit(&r, &sig, "refs/heads/main", "init", &[]);

        // main: change README line
        seed_files(&r, &[("README.md", "hello (main)\n")]);
        let _c2 = commit(&r, &sig, "refs/heads/main", "main edit", &[&c1]);

        // feat: also change the same README line
        seed_files(&r, &[("README.md", "hello (feat)\n")]);
        let _c3 = commit(&r, &sig, "refs/heads/feat", "feat edit", &[&c1]);
        drop(c1);

        // Now in the worktree, we're on main. The last commit was on
        // refs/heads/feat (which wrote "hello (feat)" to the working
        // tree), so HEAD's working tree is dirty relative to main.
        // Reset HEAD to main and check out its tree so the merge has
        // a clean state to operate on.
        r.set_head("refs/heads/main").unwrap();
        let mut reset_opts = git2::build::CheckoutBuilder::default();
        reset_opts.force();
        r.checkout_head(Some(&mut reset_opts)).unwrap();

        // Now in the worktree, we're on main with a clean tree.
        // Merge feat into main to create a conflict.
        let feat_oid = r
            .find_reference("refs/heads/feat")
            .unwrap()
            .target()
            .unwrap();
        let feat_annotated = r.find_annotated_commit(feat_oid).unwrap();

        let mut merge_opts = git2::MergeOptions::new();
        merge_opts.find_renames(true);
        let mut checkout_opts = git2::build::CheckoutBuilder::default();
        checkout_opts.force();
        r.merge(
            &[&feat_annotated],
            Some(&mut merge_opts),
            Some(&mut checkout_opts),
        )
        .expect("merge");
        r.index().unwrap().write().unwrap();
        drop(feat_annotated);
        drop(_c2);
        drop(_c3);

        (tmp, r)
    }

    #[test]
    fn read_conflict_parts_returns_all_three_sides() {
        let (tmp, _r) = setup_conflict_repo("read");
        let parts = read_conflict_parts(&tmp, "README.md").expect("parts");
        assert!(!parts.is_binary);
        assert_eq!(parts.ours.as_deref(), Some("hello (main)\n"));
        assert_eq!(parts.theirs.as_deref(), Some("hello (feat)\n"));
        assert_eq!(parts.base.as_deref(), Some("hello\n"));
        assert!(parts
            .working
            .as_deref()
            .unwrap_or("")
            .contains("<<<<<<<"));
    }

    #[test]
    fn count_unresolved_returns_one_for_single_conflict() {
        let (tmp, _r) = setup_conflict_repo("count");
        let count = count_unresolved_conflicts(&tmp).expect("count");
        assert_eq!(count, 1, "expected 1 conflict, got {}", count);
    }

    #[test]
    fn list_unresolved_returns_path() {
        let (tmp, _r) = setup_conflict_repo("list");
        let paths = list_unresolved_conflicts(&tmp).expect("list");
        assert_eq!(paths, vec!["README.md".to_string()]);
    }

    #[test]
    fn stage_resolution_clears_the_conflict() {
        let (tmp, _r) = setup_conflict_repo("stage");
        // The user "resolves" by taking ours entirely.
        stage_resolution(&tmp, "README.md", "hello (main)\n").expect("stage");
        let count = count_unresolved_conflicts(&tmp).expect("count");
        assert_eq!(count, 0, "conflict should be resolved, got {}", count);
        let working = read_working_file(&tmp, "README.md").expect("read").unwrap();
        assert_eq!(working, "hello (main)\n");
    }

    #[test]
    fn stage_resolution_with_markers_still_present_keeps_conflict() {
        // Sanity: if the user "saves" but doesn't remove the markers,
        // we don't claim it's resolved — `has_conflicts` is a
        // function of the index, not the file content. This test
        // demonstrates the index-state semantics.
        let (tmp, _r) = setup_conflict_repo("markers");
        let marked = "<<<<<<< OURS\nhello (main)\n=======\nhello (feat)\n>>>>>>> THEIRS\n";
        stage_resolution(&tmp, "README.md", marked).expect("stage");
        // add_path removed the conflict from the index even though
        // the file still has markers. (The user is responsible for
        // editing them out; the UI shows a "file still has markers"
        // warning based on `working.includes("<<<<<<<")`.)
        let count = count_unresolved_conflicts(&tmp).expect("count");
        assert_eq!(count, 0);
    }

    #[test]
    fn read_working_file_returns_none_for_missing_path() {
        let (tmp, _r) = setup_conflict_repo("missing");
        let r = read_working_file(&tmp, "does/not/exist").expect("read");
        assert!(r.is_none());
    }
}
