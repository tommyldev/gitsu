//! Worktrunk sidecar wrapper.
//!
//! `WtClient` is a thin async wrapper around the bundled `wt` binary. Every
//! method:
//!   1. Builds the argv (always passes `--format=json` when relevant),
//!   2. Spawns `wt` via the Tauri shell plugin (which resolves the sidecar),
//!   3. Captures stdout/stderr, parses JSON where applicable,
//!   4. Maps worktrunk's structured error to `error::Error::Worktrunk`.
//!
//! See `docs/WORKTRUNK_INTEGRATION.md` for the full mapping of UI affordances
//! → `wt` invocations.

pub mod commands;
pub mod sidecar;
pub mod types;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::de::DeserializeOwned;
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Async client for the `wt` binary, scoped to a single repository path.
#[derive(Clone)]
pub struct WtClient {
    repo: PathBuf,
    app: AppHandle,
}

impl WtClient {
    /// Construct a new client. Does no IO; the sidecar is resolved lazily
    /// on the first command.
    pub fn new(repo: PathBuf, app: AppHandle) -> Arc<Self> {
        Arc::new(Self { repo, app })
    }

    /// Repository root this client is scoped to.
    pub fn repo(&self) -> &Path {
        &self.repo
    }

    /// Run an arbitrary `wt` subcommand. Returns (stdout, stderr, exit_code).
    /// Use the typed wrappers below instead of calling this directly when
    /// possible.
    pub async fn run_raw(
        &self,
        args: &[&str],
        extra_env: Option<&[(&str, &str)]>,
    ) -> Result<RawOutput, error::Error> {
        use error::Error;
        let cmd = self
            .app
            .shell()
            .sidecar("wt")
            .map_err(|e| Error::Worktrunk(format!("resolve sidecar: {e}")))?
            .args(args)
            .current_dir(&self.repo);

        let cmd = if let Some(env) = extra_env {
            let mut c = cmd;
            for (k, v) in env {
                c = c.env(*k, *v);
            }
            c
        } else {
            cmd
        };

        let (mut rx, _child) = cmd
            .spawn()
            .map_err(|e| Error::Worktrunk(format!("spawn wt: {e}")))?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code: Option<i32> = None;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => stdout.extend_from_slice(&line),
                CommandEvent::Stderr(line) => stderr.extend_from_slice(&line),
                CommandEvent::Terminated(payload) => {
                    exit_code = payload.code;
                    break;
                }
                CommandEvent::Error(e) => {
                    return Err(Error::Worktrunk(format!("wt stream error: {e}")));
                }
                _ => {}
            }
        }

        Ok(RawOutput {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            exit_code: exit_code.unwrap_or(-1),
        })
    }

    /// Run a `wt` command and parse stdout as JSON.
    pub async fn run_json<T: DeserializeOwned>(
        &self,
        args: &[&str],
    ) -> Result<T, error::Error> {
        let out = self.run_raw(args, None).await?;
        if out.exit_code != 0 {
            return Err(error::Error::Worktrunk(format!(
                "{} (exit {})",
                out.stderr.trim(),
                out.exit_code
            )));
        }
        serde_json::from_str(&out.stdout).map_err(error::Error::from)
    }

    /// Run a `wt` command and return its raw text (for human display).
    pub async fn run_text(&self, args: &[&str]) -> Result<String, error::Error> {
        let out = self.run_raw(args, None).await?;
        if out.exit_code != 0 {
            return Err(error::Error::Worktrunk(format!(
                "{} (exit {})",
                out.stderr.trim(),
                out.exit_code
            )));
        }
        Ok(out.stdout)
    }
}

/// Output of a `wt` invocation.
pub struct RawOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub mod error {
    pub use crate::error::*;
}
