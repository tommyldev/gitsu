//! Diff support (M3).
//!
//! The frontend never shells out to `git diff` — libgit2 has a rich
//! diff API that's faster and gives us structured output. We return:
//!
//! - `commit_diff(repo, sha)` — the file-level diff that the commit
//!   introduces, computed as `tree(parent) → tree(sha)`.
//! - `workdir_diff(repo)` — the current working tree against HEAD.
//! - `file_content(repo, ref, path)` — the full text of a file at a
//!   given ref (commit, branch, or working tree).
//!
//! Each `FileDiff` carries:
//! - old/new paths
//! - status (added / deleted / modified / renamed / copied / type-changed)
//! - addition + deletion counts
//! - the unified diff text (empty for binary files)
//!
//! The frontend renders the patch with Shiki for syntax highlighting
//! in `DiffViewer.tsx`. We don't pre-tokenize on the Rust side — let
//! the browser do it (Shiki is fast and the user only renders the
//! file they have open).

use std::path::Path;

use git2::{DiffDelta, DiffLine, DiffOptions, Repository};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// One file changed in a diff. `old_path` is `None` for added files;
/// `new_path` is `None` for deleted files. `patch` is the unified diff
/// text (empty for binary files).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub status: DiffStatus,
    pub is_binary: bool,
    pub additions: u32,
    pub deletions: u32,
    pub patch: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DiffStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
    Copied,
    Typechange,
    Untracked,
    Ignored,
}

impl DiffStatus {
    fn from_delta(d: &DiffDelta<'_>) -> Self {
        match d.status() {
            git2::Delta::Added => DiffStatus::Added,
            git2::Delta::Deleted => DiffStatus::Deleted,
            git2::Delta::Modified => DiffStatus::Modified,
            git2::Delta::Renamed => DiffStatus::Renamed,
            git2::Delta::Copied => DiffStatus::Copied,
            git2::Delta::Typechange => DiffStatus::Typechange,
            git2::Delta::Untracked => DiffStatus::Untracked,
            git2::Delta::Ignored => DiffStatus::Ignored,
            _ => DiffStatus::Modified,
        }
    }
}

/// Diff of a single commit: `tree(parent) → tree(commit)`. If the
/// commit has no parent (initial commit), we diff against an empty
/// tree, which makes every file appear as `added`.
pub fn commit_diff(repo: &Path, sha: &str) -> Result<Vec<FileDiff>> {
    let r = Repository::open(repo).map_err(|e| Error::Git(format!("open: {e}")))?;
    let commit = r
        .find_commit(git2::Oid::from_str(sha).map_err(|e| Error::Git(format!("oid: {e}")))?)
        .map_err(|e| Error::Git(format!("find_commit {sha}: {e}")))?;
    let new_tree = commit.tree().map_err(|e| Error::Git(format!("tree: {e}")))?;

    let old_tree_obj = match commit.parent(0) {
        Ok(p) => Some(p.tree().map_err(|e| Error::Git(format!("parent tree: {e}")))?),
        Err(_) => None,
    };

    let mut diff = r
        .diff_tree_to_tree(old_tree_obj.as_ref(), Some(&new_tree), None)
        .map_err(|e| Error::Git(format!("diff_tree_to_tree: {e}")))?;
    collect_files(&mut diff)
}

/// Diff between the current working tree and HEAD. Includes staged
/// and unstaged changes (the user can filter on the frontend).
pub fn workdir_diff(repo: &Path) -> Result<Vec<FileDiff>> {
    let r = Repository::open(repo).map_err(|e| Error::Git(format!("open: {e}")))?;
    let head_tree = r
        .head()
        .ok()
        .and_then(|h| h.target())
        .and_then(|oid| r.find_commit(oid).ok())
        .and_then(|c| c.tree().ok());

    let mut opts = DiffOptions::new();
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);

    let mut diff = r
        .diff_tree_to_workdir(head_tree.as_ref(), Some(&mut opts))
        .map_err(|e| Error::Git(format!("diff_tree_to_workdir: {e}")))?;
    collect_files(&mut diff)
}

/// Read a file's content at a given ref (commit SHA, branch name,
/// "HEAD", or "WORKDIR" for the on-disk file). Returns `None` if the
/// file doesn't exist at that ref or is binary.
pub fn file_content(repo: &Path, ref_name: &str, path: &str) -> Result<Option<String>> {
    let r = Repository::open(repo).map_err(|e| Error::Git(format!("open: {e}")))?;

    if ref_name == "WORKDIR" {
        let full = repo.join(path);
        if !full.exists() {
            return Ok(None);
        }
        let bytes = std::fs::read(&full).map_err(Error::from)?;
        return Ok(Some(String::from_utf8_lossy(&bytes).into_owned()));
    }

    // Resolve the ref → object → tree → blob.
    let obj = r
        .revparse_single(ref_name)
        .map_err(|e| Error::Git(format!("revparse {ref_name}: {e}")))?;
    let tree = obj
        .peel(git2::ObjectType::Tree)
        .map_err(|e| Error::Git(format!("peel to tree: {e}")))?;
    let tree = tree
        .into_tree()
        .map_err(|_| Error::Git("peeled object is not a tree".into()))?;
    let entry = match tree.get_path(std::path::Path::new(path)) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };
    let blob = r
        .find_blob(entry.id())
        .map_err(|e| Error::Git(format!("blob: {e}")))?;
    if blob.is_binary() {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(blob.content()).into_owned()))
}

// ── internals ──────────────────────────────────────────────────

fn collect_files(diff: &mut git2::Diff<'_>) -> Result<Vec<FileDiff>> {
    // Two passes:
    // 1. `foreach` collects per-file entries (status, paths, binary
    //    flag). libgit2's `foreach` mutably borrows `diff` across all
    //    callbacks, so we share state via a `RefCell`.
    // 2. `print` walks the diff in order; each callback receives the
    //    current `delta` (with the file path), so we can attribute
    //    patch text + line counts to the right entry.
    use std::cell::RefCell;
    use std::collections::HashMap;

    struct Entry {
        status: DiffStatus,
        old_path: Option<String>,
        new_path: Option<String>,
        is_binary: bool,
    }
    let entries: RefCell<Vec<Entry>> = RefCell::new(Vec::new());

    diff.foreach(
        &mut |delta, _progress| {
            let status = DiffStatus::from_delta(&delta);
            let old_path = delta.old_file().path().map(|p| p.to_string_lossy().into_owned());
            let new_path = delta.new_file().path().map(|p| p.to_string_lossy().into_owned());
            entries.borrow_mut().push(Entry {
                status,
                old_path,
                new_path,
                is_binary: false,
            });
            true
        },
        Some(&mut |_delta, _progress| {
            if let Some(last) = entries.borrow_mut().last_mut() {
                last.is_binary = true;
            }
            true
        }),
        Some(&mut |_delta, _hunk| true),
        Some(&mut |_delta, _hunk, _line: DiffLine<'_>| true),
    )
    .map_err(|e| Error::Git(format!("diff foreach: {e}")))?;

    let entries = entries.into_inner();

    // Second pass: accumulate per-file patch text + line counts. Key
    // by the new path (or old path for deleted files).
    let patches: RefCell<HashMap<String, (u32, u32, String)>> = RefCell::new(HashMap::new());
    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        let key = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let origin = line.origin();
        let content = String::from_utf8_lossy(line.content());
        let mut map = patches.borrow_mut();
        let entry = map.entry(key).or_insert((0, 0, String::new()));
        match origin {
            '+' => entry.0 += 1,
            '-' => entry.1 += 1,
            _ => {}
        }
        entry.2.push_str(&content);
        true
    })
    .map_err(|e| Error::Git(format!("diff print: {e}")))?;

    let patches = patches.into_inner();

    Ok(entries
        .into_iter()
        .map(|e| {
            let key = e
                .new_path
                .clone()
                .or_else(|| e.old_path.clone())
                .unwrap_or_default();
            let (adds, dels, patch) = if e.is_binary {
                (0, 0, String::new())
            } else {
                patches
                    .get(&key)
                    .cloned()
                    .unwrap_or((0, 0, String::new()))
            };
            FileDiff {
                old_path: e.old_path,
                new_path: e.new_path,
                status: e.status,
                is_binary: e.is_binary,
                additions: adds,
                deletions: dels,
                patch,
            }
        })
        .collect())
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
        // `add_all` adds the listed paths to the index — for new
        // files it stages them, for existing files it restats and
        // updates. This is what makes the next `write_tree` reflect
        // the new state.
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

    fn build_repo_path() -> std::path::PathBuf {
        // Unique-per-test temp dir so parallel tests don't collide
        // on the same .git lock files.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!(
            "gitsu-diff-test-{}-{}",
            std::process::id(),
            nanos
        ));
        if tmp.exists() {
            std::fs::remove_dir_all(&tmp).ok();
        }
        std::fs::create_dir_all(&tmp).unwrap();
        let r = Repository::init_opts(
            &tmp,
            RepositoryInitOptions::new().initial_head("main"),
        )
        .unwrap();
        let sig = Signature::now("t", "t@t.io").unwrap();

        // Initial commit: README + src/main.rs
        seed_files(&r, &[("README.md", "# hello\n"), ("src/main.rs", "fn main() {}\n")]);
        let c1 = commit(&r, &sig, "refs/heads/main", "init", &[]);

        // Second commit: edit README, add lib.rs
        seed_files(
            &r,
            &[
                ("README.md", "# hello world\n"),
                ("src/main.rs", "fn main() {}\n"),
                ("src/lib.rs", "pub fn add(a: i32, b: i32) -> i32 { a + b }\n"),
            ],
        );
        let _c2 = commit(&r, &sig, "refs/heads/main", "add lib", &[&c1]);
        drop(c1);
        drop(_c2);
        tmp
    }

    #[test]
    fn commit_diff_finds_edits_and_adds() {
        let tmp = build_repo_path();
        let r = Repository::open(&tmp).unwrap();
        let head = r.head().unwrap().target().unwrap();
        let head_str = head.to_string();
        let files = commit_diff(&tmp, &head_str).unwrap();
        let names: Vec<_> = files
            .iter()
            .map(|f| f.new_path.as_deref().unwrap_or("").to_string())
            .collect();
        assert!(names.iter().any(|n| n == "README.md"), "names: {:?}", names);
        assert!(names.iter().any(|n| n == "src/lib.rs"), "names: {:?}", names);
        // README had one line changed → 1 add + 1 del
        let readme = files
            .iter()
            .find(|f| f.new_path.as_deref() == Some("README.md"))
            .unwrap();
        assert_eq!(readme.additions, 1, "readme additions: patch=\n{}", readme.patch);
        assert_eq!(readme.deletions, 1, "readme deletions: patch=\n{}", readme.patch);
        // lib.rs was added
        let lib = files
            .iter()
            .find(|f| f.new_path.as_deref() == Some("src/lib.rs"))
            .unwrap();
        assert!(lib.additions >= 1, "expected at least 1 add in lib, got {}", lib.additions);
        assert_eq!(lib.deletions, 0);
    }

    #[test]
    fn file_content_returns_text() {
        let tmp = build_repo_path();
        let content = file_content(&tmp, "HEAD", "README.md").unwrap().unwrap();
        assert!(content.contains("hello world"));
    }

    #[test]
    fn file_content_missing_returns_none() {
        let tmp = build_repo_path();
        let content = file_content(&tmp, "HEAD", "does/not/exist.rs").unwrap();
        assert!(content.is_none());
    }
}
