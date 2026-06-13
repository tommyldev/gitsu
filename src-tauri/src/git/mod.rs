//! libgit2-backed read-heavy git operations.
//!
//! Submodules (added as we get to each phase):
//! - `graph`  — DAG construction + lane assignment       (M2)
//! - `diff`   — workdir, index, and tree diffs           (M3)
//! - `blame`  — per-line attribution                     (M3)
//! - `status` — porcelain v2 parser                      (M3)
//!
//! v1 only needs the `wt list --format=json` payload
//! (already parsed in `worktrunk/commands.rs`), so these modules are
//! empty for now. Re-add files as we reach each phase.

#![allow(dead_code)]

pub mod blame;
pub mod checkout;
pub mod conflict;
pub mod diff;
pub mod graph;
pub mod merge;
pub mod ops;
pub mod stage;
pub mod status;
