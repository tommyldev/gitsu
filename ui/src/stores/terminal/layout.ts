/**
 * Layout slice: the per-worktree split/pane tree plus the
 * split/close/focus/zoom/reopen operations. PTY spawning is delegated
 * to `spawnPty` from the pty slice; the pure tree transforms live in
 * `@/lib/terminal-layout`.
 */

import type { StateCreator } from "zustand";
import { ptyKill } from "@/lib/tauri";
import { WtRpcError } from "@/lib/errors";
import {
  type Layout,
  findPane,
  findFilePaneByPath,
  updateAt,
  removePane,
  collectPaneIds,
  mapLayout,
  firstPaneId,
  firstSessionId,
  newPaneId,
  newSplitId,
} from "@/lib/terminal-layout";
import { spawnPty } from "./pty";
import type { LayoutSlice, TerminalState } from "./types";

const REOPEN_STACK_MAX = 10;

export const createLayoutSlice: StateCreator<TerminalState, [], [], LayoutSlice> = (set, get) => ({
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
    const id = await spawnPty(set, get, worktree);
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
      const id = await spawnPty(set, get, worktree);
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

  /**
   * Open a file in a read-only viewer pane. Behavior:
   *  - If the worktree has no layout, create one with the file
   *    viewer as the only leaf.
   *  - If the worktree has a layout, find the focused pane and
   *    split it vertically (right) with the new file viewer.
   *  - The new file viewer gets focus.
   *  - Clicking the same file twice from the explorer is a no-op
   *    (we don't open duplicate viewers for the same path).
   */
  openFile: (worktree, filePath, cwd) => {
    const layout = get().layouts.get(worktree);
    const newFilePane: Layout = {
      kind: "filepane",
      id: newPaneId(),
      filePath,
      cwd,
    };
    if (!layout) {
      // No layout yet — make the file viewer the only leaf. We
      // still need a terminal pane for the worktree to be
      // "alive", so spawn a PTY too. If the spawn fails the
      // explorer will still work, but the worktree won't have
      // a terminal in the strip.
      set((s) => {
        const layouts = new Map(s.layouts);
        layouts.set(worktree, newFilePane);
        const focused = new Map(s.focusedPane);
        focused.set(worktree, newFilePane.id);
        return { layouts, focusedPane: focused };
      });
      return;
    }
    // If the file is already open, just focus it instead of
    // opening a duplicate. We scan by filePath since pane ids
    // are freshly generated.
    const dup = findFilePaneByPath(layout, filePath);
    if (dup) {
      set((s) => {
        const focused = new Map(s.focusedPane);
        focused.set(worktree, dup.layout.id);
        return { focusedPane: focused };
      });
      return;
    }
    const focusedPaneId = get().focusedPane.get(worktree);
    const found = focusedPaneId ? findPane(layout, focusedPaneId) : null;
    if (!found) {
      // No focused pane — attach the file viewer as a vertical
      // split at the root level.
      const split: Layout = {
        kind: "split",
        id: newSplitId(),
        dir: "v",
        ratio: 0.5,
        a: layout,
        b: newFilePane,
      };
      set((s) => {
        const layouts = new Map(s.layouts);
        layouts.set(worktree, split);
        const focused = new Map(s.focusedPane);
        focused.set(worktree, newFilePane.id);
        return { layouts, focusedPane: focused };
      });
      return;
    }
    // Split the focused pane vertically with the new file pane.
    const split: Layout = {
      kind: "split",
      id: newSplitId(),
      dir: "v",
      ratio: 0.5,
      a: found.layout,
      b: newFilePane,
    };
    set((s) => {
      const layouts = new Map(s.layouts);
      layouts.set(worktree, updateAt(layout, found.path, () => split));
      const focused = new Map(s.focusedPane);
      focused.set(worktree, newFilePane.id);
      return { layouts, focusedPane: focused };
    });
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
          void ptyKill(sessionId).catch((e) => {
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
});
