/**
 * Terminal store — manages per-worktree PTY sessions laid out as a
 * tree of split panes.
 *
 * Layout model: each worktree has a `Layout` tree. Leaves are panes
 * (one PTY each); internal nodes are splits. Splits can be nested
 * (e.g. a horizontal split inside the right half of a vertical
 * split). Closing a pane collapses its parent split; the sibling
 * takes the parent's place.
 *
 * Lifecycle of a pane:
 *   1. `splitPane(worktree, paneId, dir)` creates a new sibling pane
 *      and calls `pty_spawn` for it. The new pane gets focus.
 *   2. Output arrives via `pty:data:<id>` Tauri events; the xterm
 *      instance writes to the screen.
 *   3. `closePane(worktree, paneId)` kills the PTY and removes the
 *      pane. If it was the only pane, the worktree's layout is gone.
 *
 * Layouts are in-memory only (reset on app restart). Persisting the
 * tree shape can come later — the SQLite store can hold a JSON blob
 * per worktree if we want to restore on reopen.
 *
 * Hotkey-driven extras (cmux-style):
 *   - `closeOthers`: close every pane in a worktree except the given one
 *   - `reopenLastClosed`: re-spawn a terminal in the most recently
 *     closed-from worktree. We don't preserve sessionIds (PTYs are
 *     not checkpointed), so "reopen" = "spawn fresh in that worktree."
 *   - `equalizeSplits`: reset every split ratio in a worktree to 0.5
 *   - `setZoom` / zoomed pane: render only the focused pane in the
 *     worktree's terminal strip until zoom is toggled off
 *   - `prevPane` / `nextPane` / `firstPane` / `lastPane`: pre-order
 *     pane navigation (good enough for small split trees; the
 *     spatial version is a follow-up)
 */

import { create } from "zustand";
import { invoke } from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";
import { WtRpcError, type IpcError, type PtyInfo } from "@/lib/types";

export type PtyStatus = "spawning" | "running" | "exited" | "error";

export interface PtySession {
  id: number;
  worktree: string;
  status: PtyStatus;
  error: string | null;
  unlisten?: () => void;
}

// ── Layout tree ────────────────────────────────────────────────

export type SplitDir = "h" | "v";
/** `h` = horizontal divider → panes stack vertically; `v` = vertical divider → panes side by side. */

export type Layout =
  | { kind: "split"; id: string; dir: SplitDir; ratio: number; a: Layout; b: Layout }
  | { kind: "pane"; id: string; sessionId: number | null };

let nextTempSessionId = 1_000_000; // unlikely to collide with the backend's allocator
let nextPaneId = 1;
let nextSplitId = 1;
const newPaneId = () => `pane-${nextPaneId++}`;
const newSplitId = () => `split-${nextSplitId++}`;
const newTempSessionId = () => nextTempSessionId++;

/** Walk the tree to find a pane. Returns `{ layout, path }` where
 * `path` is an array of `0`/`1` indices from the root. */
function findPane(
  layout: Layout,
  paneId: string,
  path: number[] = [],
): { layout: Layout; path: number[] } | null {
  if (layout.kind === "pane") {
    return layout.id === paneId ? { layout, path } : null;
  }
  const a = findPane(layout.a, paneId, [...path, 0]);
  if (a) return a;
  return findPane(layout.b, paneId, [...path, 1]);
}

function updateAt(
  layout: Layout,
  path: number[],
  updater: (l: Layout) => Layout,
): Layout {
  if (path.length === 0) return updater(layout);
  if (layout.kind !== "split") return layout;
  const [head, ...rest] = path;
  if (head === 0) return { ...layout, a: updateAt(layout.a, rest, updater) };
  return { ...layout, b: updateAt(layout.b, rest, updater) };
}

/** Remove the pane with the given id. If removing the leaf leaves
 * a single-child split, collapse the parent. Returns the new tree,
 * or `null` if the root was the removed pane. */
function removePane(layout: Layout, paneId: string): Layout | null {
  if (layout.kind === "pane") {
    return layout.id === paneId ? null : layout;
  }
  const a = removePane(layout.a, paneId);
  if (a === null) return layout.b;
  const b = removePane(layout.b, paneId);
  if (b === null) return layout.a;
  return { ...layout, a, b };
}

function collectPaneIds(layout: Layout, out: string[] = []): string[] {
  if (layout.kind === "pane") {
    out.push(layout.id);
    return out;
  }
  collectPaneIds(layout.a, out);
  collectPaneIds(layout.b, out);
  return out;
}

function mapLayout(layout: Layout, fn: (l: Layout) => Layout): Layout {
  if (layout.kind === "pane") return fn(layout);
  return fn({ ...layout, a: mapLayout(layout.a, fn), b: mapLayout(layout.b, fn) });
}

function firstPaneId(layout: Layout): string | null {
  if (layout.kind === "pane") return layout.id;
  return firstPaneId(layout.a) ?? firstPaneId(layout.b);
}

function firstSessionId(layout: Layout): number | null {
  if (layout.kind === "pane") return layout.sessionId;
  return firstSessionId(layout.a) ?? firstSessionId(layout.b);
}

// ── Store ──────────────────────────────────────────────────────

const REOPEN_STACK_MAX = 10;

interface TerminalState {
  /** All live PTY sessions, keyed by backend id. */
  sessions: Map<number, PtySession>;
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
   * id. Used as the entry point for "open terminal" affordances
   * (the strip's empty state, the merge dialog, etc.). */
  ensurePane: (worktree: string) => Promise<number>;
  /** Split the given pane in the given direction. Spawns a PTY for the new sibling. */
  splitPane: (worktree: string, paneId: string, dir: SplitDir) => Promise<number>;
  /** Close (kill + remove) a pane. Collapses the parent split. */
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

  /** Send input bytes to a session. */
  send: (id: number, data: Uint8Array) => Promise<void>;
  /** Resize a session's PTY. */
  resize: (id: number, cols: number, rows: number) => Promise<void>;

  /** Tear down everything (e.g. on repo close). */
  clear: () => Promise<void>;
}

export const useTerminalStore = create<TerminalState>((set, get) => {
  // Spawn a PTY and wire up its event listeners. Returns the real
  // backend id once the shell is running (or throws on failure).
  const spawnPty = async (worktree: string): Promise<number> => {
    const tempId = newTempSessionId();
    // Optimistic placeholder so the pane can render a "spawning"
    // state immediately. We replace this with the real id once
    // `pty_spawn` resolves.
    set((s) => {
      const sessions = new Map(s.sessions);
      sessions.set(tempId, { id: tempId, worktree, status: "spawning", error: null });
      return { sessions };
    });
    try {
      const id = await invoke<number>("pty_spawn", { worktree, cols: 80, rows: 24 });
      // Subscribe to exit events so we can mark the session as exited.
      // (Data events are subscribed by the per-mount TerminalSessionView.)
      let unlistenExit: (() => void) | undefined;
      const teardown = () => unlistenExit?.();
      unlistenExit = await listen<{ id: number; code: number | null }>(
        `pty:exit:${id}`,
        () => {
          set((s) => {
            const sessions = new Map(s.sessions);
            const cur = sessions.get(id);
            if (cur) sessions.set(id, { ...cur, status: "exited" });
            return { sessions };
          });
          teardown();
        },
      );
      // Replace the placeholder with the real session.
      set((s) => {
        const sessions = new Map(s.sessions);
        sessions.delete(tempId);
        sessions.set(id, { id, worktree, status: "running", error: null, unlisten: teardown });
        return { sessions };
      });
      return id;
    } catch (e) {
      set((s) => {
        const sessions = new Map(s.sessions);
        const cur = sessions.get(tempId);
        if (cur) sessions.set(tempId, { ...cur, status: "error", error: parseError(e) });
        return { sessions };
      });
      throw e;
    }
  };

  return {
    sessions: new Map(),
    layouts: new Map(),
    focusedPane: new Map(),
    selectedWorktree: null,
    reopenStack: [],
    zoomedPane: new Map(),

    ensurePane: async (worktree: string) => {
      // If the worktree already has a layout, return the first
      // session id we find (so callers can keep using the return
      // value uniformly). The pane count and focus stay as-is.
      const existing = get().layouts.get(worktree);
      if (existing) {
        const id = firstSessionId(existing);
        if (id != null) return id;
      }
      const id = await spawnPty(worktree);
      const paneId = newPaneId();
      set((s) => {
        const layouts = new Map(s.layouts);
        layouts.set(worktree, { kind: "pane", id: paneId, sessionId: id });
        const focused = new Map(s.focusedPane);
        focused.set(worktree, paneId);
        return { layouts, focusedPane: focused };
      });
      return id;
    },

    splitPane: async (worktree, paneId, dir) => {
      const layout = get().layouts.get(worktree);
      if (!layout) {
        // No layout yet — fall back to ensurePane.
        return get().ensurePane(worktree);
      }
      const found = findPane(layout, paneId);
      if (!found) {
        // Pane id is stale (the tree was rebuilt); spawn fresh.
        return get().ensurePane(worktree);
      }
      const newPane = { kind: "pane" as const, id: newPaneId(), sessionId: null };
      const split: Layout = {
        kind: "split",
        id: newSplitId(),
        dir,
        ratio: 0.5,
        a: found.layout, // existing pane keeps its session
        b: newPane,
      };
      set((s) => {
        const layouts = new Map(s.layouts);
        layouts.set(worktree, updateAt(layout, found.path, () => split));
        const focused = new Map(s.focusedPane);
        focused.set(worktree, newPane.id);
        return { layouts, focusedPane: focused };
      });
      // Spawn the new pane's PTY. If the spawn fails, undo the split.
      try {
        const id = await spawnPty(worktree);
        set((s) => {
          const layouts = new Map(s.layouts);
          const cur = layouts.get(worktree);
          if (!cur) return {};
          // Find the newPane in the new tree and set its sessionId.
          const found2 = findPane(cur, newPane.id);
          if (!found2) return {};
          layouts.set(worktree, updateAt(cur, found2.path, () => ({ ...newPane, sessionId: id })));
          return { layouts };
        });
        return id;
      } catch (e) {
        // Roll back: remove the new pane (which collapses the split back).
        set((s) => {
          const layouts = new Map(s.layouts);
          const cur = layouts.get(worktree);
          if (cur) {
            const rolled = removePane(cur, newPane.id);
            if (rolled === null) layouts.delete(worktree);
            else layouts.set(worktree, rolled);
          }
          return { layouts };
        });
        throw e;
      }
    },

    closePane: async (worktree, paneId) => {
      const layout = get().layouts.get(worktree);
      if (!layout) return;
      const found = findPane(layout, paneId);
      if (!found) return;
      const sessionId = found.layout.kind === "pane" ? found.layout.sessionId : null;
      const newLayout = removePane(layout, paneId);
      set((s) => {
        const layouts = new Map(s.layouts);
        const sessions = new Map(s.sessions);
        const focused = new Map(s.focusedPane);
        const zoomed = new Map(s.zoomedPane);
        if (newLayout === null) {
          layouts.delete(worktree);
          focused.delete(worktree);
          zoomed.delete(worktree);
        } else {
          layouts.set(worktree, newLayout);
          // If the focused pane was removed, focus the next leaf in
          // a left-to-right pre-order traversal.
          if (focused.get(worktree) === paneId) {
            const next = firstPaneId(newLayout);
            if (next) focused.set(worktree, next);
            else focused.delete(worktree);
          }
          // If the zoomed pane was removed, clear zoom for this worktree.
          if (zoomed.get(worktree) === paneId) {
            zoomed.delete(worktree);
          }
        }
        if (sessionId != null) {
          const sess = sessions.get(sessionId);
          if (sess) {
            sess.unlisten?.();
            sessions.delete(sessionId);
            // Best-effort kill; swallow errors so close stays snappy.
            void invoke("pty_kill", { id: sessionId }).catch((e) => {
              if (!(e instanceof WtRpcError && e.kind === "invalid_argument")) {
                console.warn("pty_kill", e);
              }
            });
          }
          // Track this worktree for reopen-last-closed (⌘⇧T).
          const stack = [worktree, ...s.reopenStack].slice(0, REOPEN_STACK_MAX);
          return { layouts, sessions, focusedPane: focused, zoomedPane: zoomed, reopenStack: stack };
        }
        return { layouts, sessions, focusedPane: focused, zoomedPane: zoomed };
      });
    },

    closeOthers: async (worktree, keepPaneId) => {
      const layout = get().layouts.get(worktree);
      if (!layout) return;
      const ids = collectPaneIds(layout);
      await Promise.all(
        ids.filter((id) => id !== keepPaneId).map((id) => get().closePane(worktree, id)),
      );
    },

    setRatio: (worktree, splitId, ratio) => {
      const layout = get().layouts.get(worktree);
      if (!layout) return;
      // Find the split by id; clamp ratio so panes never get squashed.
      const clamped = Math.max(0.15, Math.min(0.85, ratio));
      const newLayout = mapLayout(layout, (l) =>
        l.kind === "split" && l.id === splitId ? { ...l, ratio: clamped } : l,
      );
      set((s) => {
        const layouts = new Map(s.layouts);
        layouts.set(worktree, newLayout);
        return { layouts };
      });
    },

    setFocus: (worktree, paneId) => {
      set((s) => {
        const focused = new Map(s.focusedPane);
        focused.set(worktree, paneId);
        return { focusedPane: focused };
      });
    },

    setSelectedWorktree: (worktree) => {
      set({ selectedWorktree: worktree });
    },

    reopenLastClosed: async () => {
      const [worktree, ...rest] = get().reopenStack;
      if (!worktree) return null;
      set({ reopenStack: rest });
      try {
        return await get().ensurePane(worktree);
      } catch (e) {
        console.warn("reopenLastClosed", e);
        return null;
      }
    },

    equalizeSplits: (worktree) => {
      const layout = get().layouts.get(worktree);
      if (!layout) return;
      const newLayout = mapLayout(layout, (l) =>
        l.kind === "split" ? { ...l, ratio: 0.5 } : l,
      );
      set((s) => {
        const layouts = new Map(s.layouts);
        layouts.set(worktree, newLayout);
        return { layouts };
      });
    },

    toggleZoom: (worktree) => {
      const focused = get().focusedPane.get(worktree);
      if (!focused) return;
      set((s) => {
        const zoomed = new Map(s.zoomedPane);
        if (zoomed.get(worktree) === focused) {
          zoomed.delete(worktree);
        } else {
          zoomed.set(worktree, focused);
        }
        return { zoomedPane: zoomed };
      });
    },

    focusNextPane: (worktree) => {
      const layout = get().layouts.get(worktree);
      if (!layout) return;
      const ids = collectPaneIds(layout);
      if (ids.length === 0) return;
      const current = get().focusedPane.get(worktree);
      const idx = current ? ids.indexOf(current) : -1;
      const next = ids[(idx + 1) % ids.length];
      if (next) get().setFocus(worktree, next);
    },

    focusPrevPane: (worktree) => {
      const layout = get().layouts.get(worktree);
      if (!layout) return;
      const ids = collectPaneIds(layout);
      if (ids.length === 0) return;
      const current = get().focusedPane.get(worktree);
      const idx = current ? ids.indexOf(current) : 0;
      const prev = ids[(idx - 1 + ids.length) % ids.length];
      if (prev) get().setFocus(worktree, prev);
    },

    focusFirstPane: (worktree) => {
      const layout = get().layouts.get(worktree);
      if (!layout) return;
      const first = firstPaneId(layout);
      if (first) get().setFocus(worktree, first);
    },

    focusLastPane: (worktree) => {
      const layout = get().layouts.get(worktree);
      if (!layout) return;
      // Last in pre-order: right-most leaf. Walk right-leaning splits.
      let cur: Layout = layout;
      while (cur.kind === "split") cur = cur.b;
      get().setFocus(worktree, cur.id);
    },

    send: async (id, data) => {
      try {
        await invoke("pty_send", { id, data: Array.from(data) });
      } catch (e) {
        console.warn("pty_send failed", e);
      }
    },

    resize: async (id, cols, rows) => {
      try {
        await invoke("pty_resize", { id, cols, rows });
      } catch (e) {
        console.debug("pty_resize", e);
      }
    },

    clear: async () => {
      const { sessions } = get();
      for (const session of sessions.values()) {
        session.unlisten?.();
        try {
          await invoke("pty_kill", { id: session.id });
        } catch {
          // ignore
        }
      }
      set({
        sessions: new Map(),
        layouts: new Map(),
        focusedPane: new Map(),
        selectedWorktree: null,
        zoomedPane: new Map(),
        reopenStack: [],
      });
    },
  };
});

function parseError(e: unknown): string {
  if (e instanceof WtRpcError) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    return (e as IpcError).message ?? String(e);
  }
  if (typeof e === "string") return e;
  return String(e);
}

// Re-export for type use elsewhere
export type { PtyInfo };
