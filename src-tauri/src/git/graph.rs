//! Commit graph (DAG) construction from a repository.
//!
//! `build()` opens a repo with libgit2, walks the revwalker from a
//! starting ref, and returns commits + branches + tags ready for the
//! frontend's lane assignment + SVG rendering.
//!
//! The output is *path-addressable* — every commit is identified by
//! its full 40-char SHA, and parents are referenced by SHA. The TS
//! side owns the lane-assignment algorithm (see
//! `ui/src/lib/dag.ts`); Rust just produces the raw graph.

use std::path::Path;

use git2::{BranchType, ObjectType, Repository, Sort};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// One commit, with all data the frontend needs to render the graph
/// and the commit panel. `parents` is the list of parent SHAs (in
/// order); the first parent is the "main" parent on which a merge
/// commit was made.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitNode {
    pub sha: String,
    pub short_sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    /// Unix timestamp in seconds (author).
    pub author_time: i64,
    /// Unix timestamp in seconds (committer).
    pub committer_time: i64,
    /// First line of the commit message.
    pub summary: String,
    /// Rest of the commit message (without the first line).
    pub body: String,
    /// Tree SHA — used by the diff viewer (M3) to enumerate files.
    pub tree: String,
}

/// A branch reference (local or remote-tracking).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchRef {
    /// For local branches, the short name (e.g. "main"). For remote
    /// branches, the full remote name (e.g. "origin/main").
    pub name: String,
    pub is_local: bool,
    /// Commit SHA the branch points to.
    pub sha: String,
    /// For local branches, the upstream tracking branch name (e.g.
    /// "origin/main") if one is configured. None for local branches
    /// without an upstream, or for remote branches.
    pub upstream: Option<String>,
}

/// A tag reference. For annotated tags, `sha` is the tag object's
/// commit target; for lightweight tags, it's the commit the tag
/// points to directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagRef {
    pub name: String,
    pub sha: String,
    pub is_annotated: bool,
}

/// All data the frontend needs to render the graph and surrounding
/// chrome for a single worktree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitGraph {
    pub nodes: Vec<CommitNode>,
    pub branches: Vec<BranchRef>,
    pub tags: Vec<TagRef>,
    /// SHA of HEAD (the worktree's current branch HEAD, not the graph
    /// start). The frontend uses this to mark the HEAD commit in the
    /// graph.
    pub head_sha: String,
    /// The actual limit applied. Could be smaller than the requested
    /// `max_count` if the walk ended early.
    pub max_count: usize,
    /// `true` if the revwalker had more commits but was capped. The
    /// frontend can show a "load more" affordance.
    pub truncated: bool,
    /// Number of distinct lanes required to render this graph. Set
    /// by the lane-assignment pass on the frontend; default 0 until
    /// the frontend computes it.
    pub lane_count: u32,
}

#[derive(Debug, Default, Deserialize)]
pub struct GraphOpts {
    /// Where to start the walk. Defaults to HEAD. Accepts branch
    /// names, tag names, remote branch names, or any rev-spec that
    /// libgit2 can parse.
    pub ref_name: Option<String>,
    /// Cap on the number of commits. Default 500. Set to 0 for
    /// "no cap" (use sparingly — large repos are slow).
    pub max_count: Option<usize>,
}

const DEFAULT_MAX: usize = 500;

pub fn build(repo: &Path, opts: GraphOpts) -> Result<CommitGraph> {
    let r = Repository::open(repo).map_err(|e| Error::Git(format!("open: {e}")))?;
    let max_count = opts.max_count.unwrap_or(DEFAULT_MAX);
    if max_count == 0 {
        return Err(Error::InvalidArgument("max_count must be > 0".into()));
    }

    let start_oid = resolve_start_oid(&r, opts.ref_name.as_deref())?;

    // Walk. Start from the requested ref, then add all local and remote
    // branch tips so the frontend can show the full graph (not just the
    // path back from HEAD). Dups are deduped by the walker.
    let mut walker = r
        .revwalk()
        .map_err(|e| Error::Git(format!("revwalk: {e}")))?;
    walker
        .set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .map_err(|e| Error::Git(format!("sorting: {e}")))?;
    walker
        .push(start_oid)
        .map_err(|e| Error::Git(format!("push: {e}")))?;
    // All branches (local + remote) — the frontend decides which to highlight.
    if let Err(e) = walker.push_glob("refs/heads/*") {
        return Err(Error::Git(format!("push refs/heads/*: {e}")));
    }
    if let Err(e) = walker.push_glob("refs/remotes/*") {
        return Err(Error::Git(format!("push refs/remotes/*: {e}")));
    }

    let mut nodes: Vec<CommitNode> = Vec::with_capacity(max_count.min(1024));
    let mut truncated = false;

    for (i, oid_res) in walker.enumerate() {
        if i >= max_count {
            truncated = true;
            break;
        }
        let oid = oid_res.map_err(|e| Error::Git(format!("walk: {e}")))?;
        let commit = r
            .find_commit(oid)
            .map_err(|e| Error::Git(format!("find_commit: {e}")))?;
        let sha = oid.to_string();
        let short_sha = sha[..7.min(sha.len())].to_string();

        let author = commit.author();
        let committer = commit.committer();
        let msg = commit.message().unwrap_or("");
        let (summary, body) = split_message(msg);

        nodes.push(CommitNode {
            sha,
            short_sha,
            parents: commit.parent_ids().map(|p| p.to_string()).collect(),
            author_name: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            author_time: author.when().seconds(),
            committer_time: committer.when().seconds(),
            summary,
            body,
            tree: commit.tree_id().to_string(),
        });
    }

    let branches = collect_branches(&r)?;
    let tags = collect_tags(&r)?;
    let head_sha = r
        .head()
        .ok()
        .and_then(|h| h.target().map(|o| o.to_string()))
        .unwrap_or_default();

    Ok(CommitGraph {
        nodes,
        branches,
        tags,
        head_sha,
        max_count,
        truncated,
        lane_count: 0,
    })
}

fn resolve_start_oid(r: &Repository, ref_name: Option<&str>) -> Result<git2::Oid> {
    match ref_name {
        None | Some("HEAD") => r
            .head()
            .map_err(|e| Error::Git(format!("HEAD: {e}")))?
            .target()
            .ok_or_else(|| Error::Git("HEAD has no target".into())),
        Some(name) => r
            .revparse_single(name)
            .map(|o| o.id())
            .map_err(|e| Error::Git(format!("revparse {name}: {e}"))),
    }
}

fn collect_branches(r: &Repository) -> Result<Vec<BranchRef>> {
    let mut out = Vec::new();
    for kind in [BranchType::Local, BranchType::Remote] {
        for branch_result in r
            .branches(Some(kind))
            .map_err(|e| Error::Git(format!("branches: {e}")))?
        {
            let (branch, _) = branch_result.map_err(|e| Error::Git(format!("branch: {e}")))?;
            let name = match branch.name() {
                Ok(Some(n)) => n.to_string(),
                _ => continue,
            };
            if name.is_empty() {
                continue;
            }
            // Strip the "refs/heads/" or "refs/remotes/" prefix that
            // already came through. (We keep the full "origin/main"
            // for remote branches so the frontend can disambiguate.)
            let sha = branch
                .get()
                .target()
                .map(|o| o.to_string())
                .unwrap_or_default();
            let upstream = if kind == BranchType::Local {
                branch
                    .upstream()
                    .ok()
                    .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()))
            } else {
                None
            };
            out.push(BranchRef {
                name,
                is_local: kind == BranchType::Local,
                sha,
                upstream,
            });
        }
    }
    Ok(out)
}

fn collect_tags(r: &Repository) -> Result<Vec<TagRef>> {
    let mut out = Vec::new();
    let names = r
        .tag_names(None)
        .map_err(|e| Error::Git(format!("tag_names: {e}")))?;
    for name_opt in &names {
        let Some(name) = name_opt else { continue };
        let ref_name = format!("refs/tags/{name}");
        let Ok(reference) = r.find_reference(&ref_name) else {
            continue;
        };
        let Some(target_oid) = reference.target() else {
            continue;
        };
        // An annotated tag is a `Tag` object; a lightweight tag points
        // directly to the commit. `find_tag` succeeds only for the
        // former.
        let is_annotated = r.find_tag(target_oid).is_ok();
        let Ok(commit) = reference.peel(ObjectType::Commit) else {
            continue;
        };
        out.push(TagRef {
            name: name.to_string(),
            sha: commit.id().to_string(),
            is_annotated,
        });
    }
    Ok(out)
}

fn split_message(msg: &str) -> (String, String) {
    if let Some(idx) = msg.find('\n') {
        let summary = msg[..idx].trim().to_string();
        let body = msg[idx + 1..].trim().to_string();
        (summary, body)
    } else {
        (msg.trim().to_string(), String::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_message_simple() {
        let (s, b) = split_message("hello\nworld\nfoo");
        assert_eq!(s, "hello");
        assert_eq!(b, "world\nfoo");
    }

    #[test]
    fn split_message_no_newline() {
        let (s, b) = split_message("hello");
        assert_eq!(s, "hello");
        assert_eq!(b, "");
    }

    #[test]
    fn split_message_blank_first_line() {
        let (s, b) = split_message("\nbody");
        assert_eq!(s, "");
        assert_eq!(b, "body");
    }

    #[test]
    fn build_smoke() {
        // Build a temp repo with three commits, one branch off main.
        let tmp = std::env::temp_dir().join(format!("gitsu-graph-test-{}", std::process::id()));
        if tmp.exists() {
            std::fs::remove_dir_all(&tmp).ok();
        }
        std::fs::create_dir_all(&tmp).unwrap();

        let s = git2::Repository::init_opts(
            &tmp,
            git2::RepositoryInitOptions::new().initial_head("main"),
        )
        .unwrap();
        let sig = git2::Signature::now("t", "t@t.io").unwrap();

        // Three commits on main.
        let c1_oid = s.commit(Some("HEAD"), &sig, &sig, "c1", &tree(&s), &[]).unwrap();
        let c1 = s.find_commit(c1_oid).unwrap();
        let c2_oid = s
            .commit(Some("HEAD"), &sig, &sig, "c2", &tree(&s), &[&c1])
            .unwrap();
        let c2 = s.find_commit(c2_oid).unwrap();
        let c3_oid = s
            .commit(Some("HEAD"), &sig, &sig, "c3", &tree(&s), &[&c2])
            .unwrap();

        // Branch off c2, then commit on branch.
        s.branch("feature", &c2, true).unwrap();
        let feat_oid = s
            .commit(
                Some("refs/heads/feature"),
                &sig,
                &sig,
                "feat-c1",
                &tree(&s),
                &[&c2],
            )
            .unwrap();
        let _ = feat_oid;
        // Bring HEAD back to main for the walk start.
        s.set_head("refs/heads/main").unwrap();
        s.checkout_head(Some(
            git2::build::CheckoutBuilder::default().force(),
        ))
        .ok();

        let g = build(&tmp, GraphOpts::default()).expect("build");
        assert!(g.nodes.len() >= 4, "expected >= 4 commits, got {}", g.nodes.len());
        assert!(g.branches.iter().any(|b| b.name == "main" && b.is_local));
        assert!(g.branches.iter().any(|b| b.name == "feature" && b.is_local));
        assert_eq!(g.head_sha, c3_oid.to_string());

        // The feature branch's first commit should have c2 as its parent.
        let feat = g.nodes.iter().find(|n| n.summary == "feat-c1").unwrap();
        assert_eq!(feat.parents, vec![c2_oid.to_string()]);
    }

    fn tree(r: &git2::Repository) -> git2::Tree<'_> {
        let oid = r.index().unwrap().write_tree().unwrap();
        r.find_tree(oid).unwrap()
    }
}
