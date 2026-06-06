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
    /// Current working directory. Initialized to `worktree` on spawn and
    /// updated when the shell emits an OSC 7 sequence reporting a new CWD.
    cwd: Arc<Mutex<PathBuf>>,
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
        let cwd = Arc::new(Mutex::new(worktree.clone()));
        reg.sessions.insert(
            id,
            Session {
                id,
                worktree: worktree.clone(),
                cwd,
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
    //
    // We also scan the stream for OSC 7 sequences (`\x1b]7;file://...`)
    // which modern shells (bash, zsh, fish) emit whenever the CWD
    // changes. xterm.js handles the same sequences for its own
    // purposes (it doesn't surface CWD to the host), so they pass
    // through to the terminal unmodified. The frontend uses the
    // `pty:cwd:<id>` event this produces to keep the directory
    // explorer's root in sync with the shell's actual location.
    let app_handle = app.clone();
    let id_for_reader = id;
    let cwd_for_reader = {
        let reg = registry();
        let reg = reg.lock();
        reg.sessions
            .get(&id)
            .map(|s| s.cwd.clone())
            .ok_or_else(|| Error::Internal(format!("pty {id} vanished mid-spawn")))?
    };
    let _ = std::thread::spawn(move || {
        use std::io::Read;
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut osc7 = Osc7Parser::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    // Scan the bytes for OSC 7 sequences. CWD is
                    // reported on a separate event channel so the
                    // frontend store can react even if no view is
                    // attached to the PTY.
                    if let Some(new_cwd) = osc7.feed(&data) {
                        let mut cur = cwd_for_reader.lock();
                        if *cur != new_cwd {
                            *cur = new_cwd.clone();
                            let _ = app_handle.emit(
                                &format!("pty:cwd:{id_for_reader}"),
                                PtyCwdEvent {
                                    id: id_for_reader,
                                    cwd: new_cwd.display().to_string(),
                                },
                            );
                        }
                    }
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

/// Emitted when the shell's CWD changes (via OSC 7). The frontend
/// uses this to keep the directory explorer's root in sync with the
/// terminal's actual CWD.
#[derive(Serialize, Clone)]
pub struct PtyCwdEvent {
    pub id: PtyId,
    pub cwd: String,
}

/// Look up the current CWD of a PTY session. Returns the worktree
/// root if the session is unknown or the CWD hasn't been set.
pub fn cwd(id: PtyId) -> Option<PathBuf> {
    let reg = registry();
    let reg = reg.lock();
    reg.sessions
        .get(&id)
        .map(|s| s.cwd.lock().clone())
}

// ── OSC 7 parser ────────────────────────────────────────────────

/// State machine that pulls OSC 7 (`\x1b]7;file://…\x07`) sequences
/// out of a stream of PTY output bytes. The format is defined by
/// the `iterm2`/`ConEmu` convention; bash, zsh and fish all emit
/// some variant of it on `cd`.
///
/// We don't need to be a general ANSI parser — only the OSC 7
/// escape. Anything that doesn't match is dropped on the floor (the
/// raw bytes are still forwarded to the xterm.js view, so the
/// terminal renders normally). The parser is bounded so a runaway
/// or malformed sequence can't grow the buffer without limit.
struct Osc7Parser {
    /// Buffer that accumulates a potential OSC 7 payload between
    /// the start escape and the terminator.
    buf: Vec<u8>,
    /// True once we've seen the `\x1b]7;` prefix and are looking
    /// for the terminator. Reset on terminator or on overflow.
    in_seq: bool,
    /// Have we already captured the `\x1b]7;` prefix in `buf`?
    prefix_captured: bool,
}

impl Osc7Parser {
    fn new() -> Self {
        Self {
            buf: Vec::with_capacity(256),
            in_seq: false,
            prefix_captured: false,
        }
    }

    /// Feed a chunk of PTY output. Returns the parsed CWD if a
    /// complete OSC 7 sequence was seen within the chunk.
    ///
    /// The chunk boundary is irrelevant: we keep a rolling buffer
    /// and only reset on terminator or overflow. This means an OSC
    /// 7 split across two `read()` calls is handled correctly.
    fn feed(&mut self, data: &[u8]) -> Option<PathBuf> {
        const MAX_LEN: usize = 2048; // hard cap on a single sequence
        // The OSC 7 sequence is `\x1b]7;PAYLOAD\x07` (or ST). The
        // payload is conventionally a `file://` URL, but we don't
        // require the `file://` prefix here — `parse_osc7_payload`
        // strips it. This way we still capture CWDs from shells
        // that omit the scheme (rare, but possible).
        const PREFIX: &[u8] = b"\x1b]7;";

        let mut result: Option<PathBuf> = None;

        for &byte in data {
            if !self.in_seq {
                // Look for the start of an OSC 7. We re-scan from
                // the previous position so a sequence split across
                // chunk boundaries still matches.
                if byte == PREFIX[0] {
                    // Tentative match — start a fresh buffer and
                    // remember we're in a sequence.
                    self.buf.clear();
                    self.buf.push(byte);
                    self.prefix_captured = false;
                    self.in_seq = true;
                }
            } else {
                self.buf.push(byte);
                if self.buf.len() > MAX_LEN {
                    // Not a real OSC 7 (or a pathologically long
                    // one). Bail and start over.
                    self.in_seq = false;
                    self.buf.clear();
                    self.prefix_captured = false;
                    continue;
                }
                // Try to match the prefix incrementally. We do this
                // so a non-OSC-7 escape (e.g. `\x1b]0;…` for the
                // window title) that happens to start with the same
                // first byte doesn't get mis-accepted.
                if !self.prefix_captured {
                    if self.buf.len() < PREFIX.len() {
                        // Keep collecting.
                        continue;
                    }
                    if &self.buf[..PREFIX.len()] != PREFIX {
                        // This isn't an OSC 7 — discard and resume
                        // scanning for the next `\x1b`.
                        self.in_seq = false;
                        self.buf.clear();
                        self.prefix_captured = false;
                        continue;
                    }
                    self.prefix_captured = true;
                    // Now we're past the prefix; look for the
                    // terminator.
                }
                // Terminator: BEL (0x07) or ST (`\x1b\\`).
                if byte == 0x07 {
                    if let Some(p) = parse_osc7_payload(&self.buf[PREFIX.len()..self.buf.len() - 1]) {
                        result = Some(p);
                    }
                    self.in_seq = false;
                    self.buf.clear();
                    self.prefix_captured = false;
                } else if self.buf.len() >= 2
                    && self.buf[self.buf.len() - 2] == 0x1b
                    && byte == b'\\'
                {
                    if let Some(p) = parse_osc7_payload(&self.buf[PREFIX.len()..self.buf.len() - 2]) {
                        result = Some(p);
                    }
                    self.in_seq = false;
                    self.buf.clear();
                    self.prefix_captured = false;
                }
            }
        }
        result
    }
}


/// Parse the payload of an OSC 7 sequence — everything after
/// `file://` and before the terminator. Format: `file://HOSTNAME/PATH`.
/// Returns `None` if the payload doesn't have a recognizable path.
fn parse_osc7_payload(payload: &[u8]) -> Option<PathBuf> {
    let s = std::str::from_utf8(payload).ok()?;
    // Find the first `/` after the host portion. We don't use
    // `url::Url` because we want to keep this dependency-free
    // and the format is well-defined.
    let after_scheme = s.strip_prefix("file://")?;
    let slash = after_scheme.find('/')?;
    let encoded_path = &after_scheme[slash..];
    if encoded_path.is_empty() {
        return None;
    }
    let decoded = urlencoding_decode(encoded_path);
    let path = PathBuf::from(decoded);
    if path.as_os_str().is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Minimal percent-decoder for the path portion of an OSC 7 URL.
/// Handles the common `%XX` hex escapes; everything else is left
/// alone. This intentionally doesn't try to be a full URL decoder
/// (no `+` for space, no punycode, etc.) — paths on Unix don't use
/// those, and the OSC 7 spec is just RFC 3986 for the URL portion.
fn urlencoding_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = hex_value(bytes[i + 1]);
            let lo = hex_value(bytes[i + 2]);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as char);
                i += 3;
                continue;
            }
        }
        // Push the raw byte (as a char, since we started from a
        // &str — non-UTF-8 bytes already failed the parser above).
        out.push(s[i..].chars().next().unwrap_or(' '));
        i += 1;
    }
    out
}

fn hex_value(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_osc7() {
        let mut p = Osc7Parser::new();
        let s = b"\x1b]7;file://hostname/Users/me/code/proj\x07";
        assert_eq!(
            p.feed(s).unwrap(),
            PathBuf::from("/Users/me/code/proj")
        );
    }

    #[test]
    fn parses_st_terminator() {
        let mut p = Osc7Parser::new();
        let s = b"\x1b]7;file://h//tmp/foo\x1b\\";
        assert_eq!(p.feed(s).unwrap(), PathBuf::from("//tmp/foo"));
    }

    #[test]
    fn parses_split_chunk() {
        let mut p = Osc7Parser::new();
        assert!(p.feed(b"\x1b]7;file://hostnam").is_none());
        assert!(p.feed(b"e/Users/me").is_none());
        assert_eq!(p.feed(b"/code\x07").unwrap(), PathBuf::from("/Users/me/code"));
    }

    #[test]
    fn ignores_other_osc() {
        // OSC 0 (window title) should not be picked up.
        let mut p = Osc7Parser::new();
        let s = b"\x1b]0;some title\x07";
        assert!(p.feed(s).is_none());
    }

    #[test]
    fn decodes_percent_escapes() {
        let s = b"\x1b]7;file://h/Users/me/My%20Code\x07";
        let mut p = Osc7Parser::new();
        assert_eq!(
            p.feed(s).unwrap(),
            PathBuf::from("/Users/me/My Code")
        );
    }
}

// (No top-level constants needed; we use std::time::Duration inline if
// we add a kill grace period later.)
