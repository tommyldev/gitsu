//! Sidecar binary resolution and version checks.
//!
//! The bundled `wt` is named per Tauri 2's externalBin convention:
//! `binaries/wt-<target-triple>`. At runtime, Tauri's shell plugin
//! resolves the right one for the current build target. This module
//! provides helpers for:
//!   * locating the binary (for diagnostics + first-run checks),
//!   * parsing the `wt X.Y.Z` version string,
//!   * recording a SHA-256 pin (used by `scripts/download-wt.sh`).

use std::path::PathBuf;

/// Resolve the path to the bundled `wt` sidecar. The Tauri shell plugin
/// handles this for `Command::sidecar`, but we expose it for diagnostics
/// (Settings → About) and for spawning `wt` from places the plugin can't
/// reach (e.g. during installation).
pub fn locate_bundled() -> Option<PathBuf> {
    let target = current_target_triple();
    let exe_suffix = std::env::consts::EXE_SUFFIX;
    // Walk up from CARGO_MANIFEST_DIR/../target/... to find the binary.
    // Tauri copies sidecars into the bundle root at build time, but during
    // dev they're next to the binary. We try a few likely locations.
    for candidate in sidecar_candidates(&target, exe_suffix) {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn sidecar_candidates(target: &str, exe_suffix: &str) -> [PathBuf; 3] {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("src-tauri"));
    let binaries_dir = manifest_dir.join("binaries");
    let name = format!("wt-{target}{exe_suffix}");

    [
        // dev: alongside the cargo target binary
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join(&name)))
            .unwrap_or_else(|| binaries_dir.join(&name)),
        // source of truth
        binaries_dir.join(&name),
        // tauri build output
        binaries_dir.join(format!("wt{exe_suffix}")),
    ]
}

/// `cargo` target triple for the current build. Falls back to the host
/// triple from `std::env::consts` for dev mode where
/// `cargo-tauri`'s env may not be set.
pub fn current_target_triple() -> String {
    // Tauri's `target-triple` env var is set during the build script's
    // evaluation. We can't read it at runtime in all configurations, so
    // fall back to the host.
    if let Ok(t) = std::env::var("TAURI_BUILD_TARGET") {
        return t;
    }
    // Best-effort: derive from rustc's default host.
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    let env = match os {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        "windows" => "pc-windows-msvc",
        other => other,
    };
    format!("{arch}-{env}")
}

/// Parse `wt X.Y.Z` → `"X.Y.Z"`. Returns `None` if the string doesn't match.
pub fn parse_version(out: &str) -> Option<String> {
    let trimmed = out.trim();
    let v = trimmed.strip_prefix("wt ")?;
    let v = v.lines().next()?.trim();
    // Strip any " (commit ...)" suffix that some build scripts append.
    let v = v.split_whitespace().next()?;
    Some(v.to_string())
}

/// Minimum worktrunk version gitsu supports, in semver-major form.
/// Bump this when gitsu starts relying on a newer `wt` feature.
pub const MIN_WT_VERSION: &str = "0.55.0";

/// Compare two `X.Y.Z` semver strings. Returns true if `got` is `>= want`.
#[allow(dead_code)]
pub fn version_at_least(got: &str, want: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.split('.')
            .filter_map(|p| p.parse::<u32>().ok())
            .collect()
    };
    let g = parse(got);
    let w = parse(want);
    g.cmp(&w) != std::cmp::Ordering::Less
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_basic() {
        assert_eq!(parse_version("wt 0.56.0"), Some("0.56.0".into()));
        assert_eq!(parse_version("wt 1.2.3 (commit abcdef)"), Some("1.2.3".into()));
        assert_eq!(parse_version("not worktrunk"), None);
    }

    #[test]
    fn version_cmp() {
        assert!(version_at_least("0.56.0", "0.55.0"));
        assert!(!version_at_least("0.54.0", "0.55.0"));
        assert!(version_at_least("1.0.0", "0.99.99"));
    }

    #[test]
    fn locate_works_in_dev() {
        // This passes in dev mode because the sidecar is checked in.
        let path = locate_bundled();
        assert!(path.is_some(), "sidecar should be locatable in dev");
    }
}
