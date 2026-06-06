/**
 * PTY (M5) types. Mirrors the Rust serde structs + the `pty:cwd`
 * event payload emitted by the per-worktree terminal sessions.
 */

export interface PtyInfo {
  id: number;
  worktree: string;
  pid: number | null;
}

/** Emitted on `pty:cwd:<id>` when the shell's CWD changes (OSC 7). */
export interface PtyCwdEvent {
  id: number;
  cwd: string;
}
