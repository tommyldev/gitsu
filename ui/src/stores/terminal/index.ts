/**
 * Terminal store — manages per-worktree PTY sessions laid out as a
 * tree of split panes. Composed from two slices:
 *   - `./pty`    — PTY session lifecycle: spawn, IO, events, teardown.
 *   - `./layout` — the per-worktree split/pane tree + focus/zoom ops.
 * The pure layout model + tree transforms live in
 * `@/lib/terminal-layout`.
 *
 * Layout model: each worktree has a `Layout` tree. Leaves are panes
 * (one PTY each); internal nodes are splits. Splits can be nested
 * (e.g. a horizontal split inside the right half of a vertical
 * split). Closing a pane collapses its parent split; the sibling
 * takes the parent's place.
 *
 * Lifecycle of a pane:
 *   1. The TerminalStrip auto-calls `ensurePane(worktree)` the first
 *      time a worktree is selected, which spawns a PTY in the
 *      worktree's cwd and creates a single-pane layout. Subsequent
 *      selections of the same worktree are a no-op (the shell +
 *      layout already exist; output buffered while the view was
 *      unmounted is replayed via `pendingData` when the view
 *      reattaches).
 *   2. `splitPane(worktree, paneId, dir)` creates a new sibling pane
 *      and calls `pty_spawn` for it. The new pane gets focus.
 *   3. Output arrives via `pty:data:<id>` Tauri events; the xterm
 *      instance writes to the screen.
 *   4. `closePane(worktree, paneId)` kills the PTY and removes the
 *      pane. If it was the only pane, the worktree's layout is gone.
 *
 * Layouts are in-memory only (reset on app restart).
 */

import { create } from "zustand";
import { createPtySlice } from "./pty";
import { createLayoutSlice } from "./layout";
import type { TerminalState } from "./types";

export const useTerminalStore = create<TerminalState>((...a) => ({
  ...createPtySlice(...a),
  ...createLayoutSlice(...a),
}));

// Re-exports for consumers importing from `@/stores/terminal`.
export type { Layout, SplitDir } from "@/lib/terminal-layout";
export type { PtyStatus, PtySession, TerminalState } from "./types";
export type { PtyInfo } from "@/lib/types";
