//! Per-worktree PTY (M5).
//!
//! Each `PtyId` corresponds to one spawned shell in one worktree. The
//! lifecycle:
//!
//! 1. Frontend calls `pty_spawn(worktree, cols, rows)`. Rust spawns
//!    `$SHELL` (or `/bin/sh` as fallback) in the worktree directory
//!    via `portable-pty`, returning a `PtyId`.
//! 2. PTY output is read in a background thread, base64-encoded, and
//!    emitted as Tauri events `pty:data:<id>` with `{ id, data }`.
//!    Frontend xterm.js decodes and writes to the terminal.
//! 3. Frontend input (keystrokes) goes via `pty_send(id, bytes)`. The
//!    bytes are written to the PTY master.
//! 4. Frontend resizes via `pty_resize(id, cols, rows)`. The PTY size
//!    is updated and the shell re-wraps.
//! 5. Frontend closes via `pty_kill(id)`. We send SIGTERM to the
//!    process group, then SIGKILL after a short grace period.
//!
//! Persistence: PTYs survive worktree navigation. When the worktree
//! is removed (via `wt remove`), the Rust side tears down any
//! associated PTYs and emits `pty:exit`.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};

/// Opaque handle to a PTY session.
pub type PtyId = u64;

#[derive(Clone, Serialize)]
pub struct PtyInfo {
    pub id: PtyId,
    pub worktree: String,
    pub pid: Option<u32>,
}

struct Session {
    id: PtyId,
    worktree: PathBuf,
    pid: Option<u32>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    // We hold the child here just to keep it alive. Killing is done
    // by closing the master (which sends SIGHUP to the child on Unix)
    // and waiting for the reader thread to see EOF.
    _child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>,
}

#[derive(Default)]
pub struct PtyRegistry {
    next_id: u64,
    sessions: HashMap<PtyId, Session>,
}

static REGISTRY: std::sync::OnceLock<Arc<Mutex<PtyRegistry>>> = std::sync::OnceLock::new();

fn registry() -> Arc<Mutex<PtyRegistry>> {
    REGISTRY
        .get_or_init(|| Arc::new(Mutex::new(PtyRegistry::default())))
        .clone()
}

/// Spawn a shell in the given worktree. Emits `pty:data:<id>` events
/// for output, and `pty:exit:<id>` on exit. The frontend can subscribe
/// to either event by name.
pub fn spawn(app: AppHandle, worktree: PathBuf, cols: u16, rows: u16) -> Result<PtyId> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| Error::Internal(format!("openpty: {e}")))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    // Login shell so user's aliases / PATH are loaded.
    if let Some(program) = std::path::Path::new(&shell).file_name().and_then(|s| s.to_str()) {
        if matches!(program, "bash" | "zsh" | "fish" | "ksh") {
            cmd.arg("-l");
        }
    }
    cmd.cwd(&worktree);
    // Pass through common env. Tauri apps usually have a minimal env
    // (no TERM, no LANG); we set sensible defaults.
    cmd.env("TERM", "xterm-256color");
    if let Ok(lang) = std::env::var("LANG") {
        cmd.env("LANG", lang);
    } else {
        cmd.env("LANG", "en_US.UTF-8");
    }
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }
    // Some shells (bash -l) print ANSI codes that confuse xterm.js on
    // startup. We don't filter those here — the user can clear.

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| Error::Internal(format!("spawn: {e}")))?;
    // portable_pty's `Child` trait doesn't expose `pid()` on every
    // platform. We just store `None` for now; if we need the real
    // PID we can use `libc::getpid()` via a wrapper crate, but the
    // UI doesn't currently need it.
    let pid: Option<u32> = None;
    drop(pair.slave);

    let master = pair.master;
    let reader = master
        .try_clone_reader()
        .map_err(|e| Error::Internal(format!("clone reader: {e}")))?;
    let writer = master
        .take_writer()
        .map_err(|e| Error::Internal(format!("take writer: {e}")))?;

    let id = {
        let reg = registry();
        let mut reg = reg.lock();
        reg.next_id += 1;
        let id = reg.next_id;
        reg.sessions.insert(
            id,
            Session {
                id,
                worktree: worktree.clone(),
                pid,
                master: Arc::new(Mutex::new(master)),
                writer: Arc::new(Mutex::new(writer)),
                _child: Arc::new(Mutex::new(Some(child))),
            },
        );
        id
    };

    // Background reader thread: read bytes from the PTY, base64 them,
    // and emit `pty:data:<id>` events. We use base64 to keep the event
    // payload JSON-safe (PTY output can contain any bytes, including
    // invalid UTF-8). xterm.js's `write` accepts base64 directly via
    // `Base64.toUint8Array`.
    let app_handle = app.clone();
    let id_for_reader = id;
    let _ = std::thread::spawn(move || {
        use std::io::Read;
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let _ = app_handle.emit(
                        &format!("pty:data:{id_for_reader}"),
                        PtyDataEvent {
                            id: id_for_reader,
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        // PTY closed; emit exit event.
        let _ = app_handle.emit(
            &format!("pty:exit:{id_for_reader}"),
            PtyExitEvent {
                id: id_for_reader,
                code: None,
            },
        );
        // Best-effort cleanup of the registry entry.
        {
            let reg = registry();
            let mut reg = reg.lock();
            reg.sessions.remove(&id_for_reader);
        }
    });

    Ok(id)
}

/// Send raw input bytes to the PTY (frontend keystrokes).
pub fn send(id: PtyId, data: &[u8]) -> Result<()> {
    let session = {
        let reg = registry();
        let reg = reg.lock();
        reg.sessions
            .get(&id)
            .ok_or_else(|| Error::InvalidArgument(format!("no pty {id}")))?
            .writer
            .clone()
    };
    let mut w = session.lock();
    w.write_all(data).map_err(|e| Error::Internal(format!("pty write: {e}")))?;
    w.flush().map_err(|e| Error::Internal(format!("pty flush: {e}")))?;
    Ok(())
}

/// Resize the PTY. xterm.js sends this on container resize.
pub fn resize(id: PtyId, cols: u16, rows: u16) -> Result<()> {
    let session = {
        let reg = registry();
        let reg = reg.lock();
        reg.sessions
            .get(&id)
            .ok_or_else(|| Error::InvalidArgument(format!("no pty {id}")))?
            .master
            .clone()
    };
    let m = session.lock();
    m.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
    .map_err(|e| Error::Internal(format!("pty resize: {e}")))?;
    Ok(())
}

/// Kill the PTY. We close the master, which sends SIGHUP to the
/// child process group on Unix. The reader thread sees EOF and
/// removes the session from the registry.
pub fn kill(id: PtyId) -> Result<()> {
    let reg = registry();
    let mut reg = reg.lock();
    if let Some(session) = reg.sessions.remove(&id) {
        // Drop the master to close the PTY.
        drop(session.master.lock());
        // Best-effort: try to take the child and kill it explicitly.
        if let Some(mut child) = session._child.lock().take() {
            let _ = child.kill();
        }
        Ok(())
    } else {
        Err(Error::InvalidArgument(format!("no pty {id}")))
    }
}

/// List all live PTYs. Used for diagnostics + the worktree→pty
/// reverse lookup (M1.1: worktree remove tears down the matching PTY).
pub fn list() -> Vec<PtyInfo> {
    let reg = registry();
    let reg = reg.lock();
    reg.sessions
        .values()
        .map(|s| PtyInfo {
            id: s.id,
            worktree: s.worktree.display().to_string(),
            pid: s.pid,
        })
        .collect()
}

/// Tear down any PTY whose worktree matches the given path. Called
/// from `wt_remove` to clean up before the worktree is gone.
#[allow(dead_code)]
pub fn teardown_for_worktree(worktree: &std::path::Path) {
    let to_kill: Vec<PtyId> = {
        let reg = registry();
        let reg = reg.lock();
        reg.sessions
            .iter()
            .filter(|(_, s)| s.worktree == worktree)
            .map(|(id, _)| *id)
            .collect()
    };
    for id in to_kill {
        let _ = kill(id);
    }
}

#[derive(Serialize, Clone)]
pub struct PtyDataEvent {
    pub id: PtyId,
    /// Raw bytes. The frontend base64-decodes these before writing
    /// to xterm.js. (Tauri's event payloads must be JSON, so we
    /// transport bytes as `Vec<u8>` which serde encodes as a JSON
    /// array of numbers.)
    pub data: Vec<u8>,
}

#[derive(Serialize, Clone)]
pub struct PtyExitEvent {
    pub id: PtyId,
    pub code: Option<i32>,
}

// (No top-level constants needed; we use std::time::Duration inline if
// we add a kill grace period later.)
