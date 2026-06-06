/**
 * Terminal store types — split into a PTY-session slice and a
 * layout-tree slice (composed in `./index`). The pure layout model
 * (`Layout`, tree ops) lives in `@/lib/terminal-layout`.
 */

import type { Layout, SplitDir } from "@/lib/terminal-layout";

export type PtyStatus = "spawning" | "running" | "exited" | "error";

export interface PtySession {
  id: number;
  worktree: string;
  status: PtyStatus;
  error: string | null;
  /**
   * Current working directory as reported by the shell via OSC 7
   * (`\x1b]7;file://…\x07`). Defaults to `worktree` on spawn and
   * updates as the user runs `cd` (or any command that changes the
   * directory, since most shells emit OSC 7 from their PROMPT_COMMAND
   * equivalent). The directory explorer reads this to know where to
   * root its file tree.
   */
  cwd: string;
  /**
   * Bytes that arrived from the PTY while no view was attached (e.g.
   * the user switched worktrees). Drained by the next `attachView`.
   * Bounded to `PENDING_DATA_CAP` so a long-running build can't OOM
   * the renderer.
   */
  pendingData: Uint8Array;
  /**
   * Live views that want byte-by-byte delivery. When non-empty, new
   * PTY output is dispatched here instead of going to `pendingData`.
   */
  dataListeners: Set<(data: Uint8Array) => void>;
  /**
   * Cleanup for the store-owned `pty:data` + `pty:exit` subscriptions.
   * Called on pane close, repo clear, and PTY exit.
   */
  unlisten?: () => void;
  /**
   * Cleanup for the store-owned `pty:cwd` subscription. The CWD
   * event is emitted from the Rust reader thread whenever the
   * shell reports a new working directory (OSC 7).
   */
  unlistenCwd?: () => void;
  /**
   * Snapshot of the xterm's visual state captured on the last view
   * unmount (e.g. user switched worktrees). Written back to the new
   * xterm on the next mount so the scrollback (and any in-progress
   * prompt) survives the switch — the byte stream we replay from
   * `pendingData` only covers the time the view was unmounted, so
   * without this the user would see a blank terminal every time
   * they came back. Set by `setSerializedState`; cleared on
   * `closePane` / `clear` along with the rest of the session.
   */
  serializedState?: string;
}

/** PTY-session lifecycle slice: live sessions + the IO/teardown ops. */
export interface PtySlice {
  /** All live PTY sessions, keyed by backend id. */
  sessions: Map<number, PtySession>;

  /** Send input bytes to a session. */
  send: (id: number, data: Uint8Array) => Promise<void>;
  /** Resize a session's PTY. */
  resize: (id: number, cols: number, rows: number) => Promise<void>;

  /**
   * Attach a view to a PTY session. Atomically:
   *   1. Drains any bytes buffered while no view was attached
   *      (the user switched worktrees and came back) — these go in
   *      the returned `pending` so the caller can write them to
   *      xterm in one shot before live delivery starts.
   *   2. Registers `cb` as a live listener for future PTY output.
   * The returned `unsubscribe` removes the listener. While at least
   * one listener is registered, new PTY output goes to listeners
   * instead of `pendingData`.
   *
   * Returns `{ pending: Uint8Array, unsubscribe: () => void }`. If
   * the session id is unknown, `pending` is empty and `unsubscribe`
   * is a no-op.
   */
  attachView: (
    sessionId: number,
    cb: (data: Uint8Array) => void,
  ) => { pending: Uint8Array; unsubscribe: () => void };

  /**
   * Persist a snapshot of the xterm visual state for the given
   * session. Called by the view on unmount so the next mount can
   * restore the scrollback (the byte stream replay in `attachView`
   * only covers the time the view was unmounted). No-op if the
   * session was already torn down.
   */
  setSerializedState: (sessionId: number, state: string) => void;

  /** Tear down everything (e.g. on repo close). */
  clear: () => Promise<void>;
}

/** Layout slice: the per-worktree split/pane tree + focus/zoom ops. */
export interface LayoutSlice {
  /** Per-worktree layout tree (the split + pane structure). */
  layouts: Map<string, Layout>;
  /** Currently-focused pane per worktree, for keystroke routing. */
  focusedPane: Map<string, string>;
  /** Worktree path whose terminal layout the strip is currently rendering.
   * Lifted to the store so the App-level hotkey listener can target
   * split/close/zoom/etc. on the same worktree the user is looking at. */
  selectedWorktree: string | null;
  /** Worktree path of the most recently closed pane (capped at REOPEN_STACK_MAX). */
  reopenStack: string[];
  /** Per-worktree zoomed paneId. `null`/absent means "show the full tree." */
  zoomedPane: Map<string, string | null>;

  /** Ensure at least one pane exists in the worktree. If one
   * already does, this is a no-op and returns the existing session
   * id. The TerminalStrip calls this automatically the first time
   * a worktree is selected; other call sites (merge dialog, command
   * palette, hotkeys) use it as the entry point for "open terminal"
   * affordances. */
  ensurePane: (worktree: string) => Promise<number>;
  /** Split the given pane in the given direction. Spawns a PTY for the new sibling. */
  splitPane: (worktree: string, paneId: string, dir: SplitDir) => Promise<number>;
  /** Open a file in a read-only viewer pane next to the focused pane.
   * No PTY is spawned — the viewer fetches file contents via the
   * `read_file` IPC command. `filePath` is absolute, `cwd` is the
   * terminal CWD at the moment of opening (display-only). */
  openFile: (worktree: string, filePath: string, cwd: string) => void;
  /** Close (kill + remove) a pane. Collapses the parent split.
   * Filepanes are simply removed (no PTY to kill). */
  closePane: (worktree: string, paneId: string) => Promise<void>;
  /** Close every pane in the worktree except `keepPaneId`. */
  closeOthers: (worktree: string, keepPaneId: string) => Promise<void>;
  /** Update a split's ratio (clamped to 0.15..0.85). */
  setRatio: (worktree: string, splitId: string, ratio: number) => void;
  /** Mark a pane as focused (for visual indicator + future input routing). */
  setFocus: (worktree: string, paneId: string) => void;
  /** Set which worktree the terminal strip is rendering. */
  setSelectedWorktree: (worktree: string | null) => void;
  /** Re-spawn a terminal in the most recently closed-from worktree. */
  reopenLastClosed: () => Promise<number | null>;
  /** Reset every split ratio in a worktree to 0.5. */
  equalizeSplits: (worktree: string) => void;
  /** Toggle zoom on the focused pane. When zoomed, the strip renders only that pane. */
  toggleZoom: (worktree: string) => void;
  /** Pre-order pane focus navigation. `null` worktrees are no-ops. */
  focusNextPane: (worktree: string) => void;
  focusPrevPane: (worktree: string) => void;
  focusFirstPane: (worktree: string) => void;
  focusLastPane: (worktree: string) => void;
}

export type TerminalState = PtySlice & LayoutSlice;
