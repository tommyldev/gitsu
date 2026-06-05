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

/** Max bytes of PTY output retained per session while no view is
 * attached. ~1 MB ≈ 5× xterm's default 1000-line scrollback. The
 * buffer is a sliding window — oldest bytes are dropped on overflow. */
const PENDING_DATA_CAP = 1024 * 1024;

/** Append `chunk` to `buf`, returning a new Uint8Array. If the result
 * would exceed `PENDING_DATA_CAP`, drop the oldest bytes (sliding
 * window). Allocates twice on overflow, once otherwise. */
function appendBounded(buf: Uint8Array, chunk: Uint8Array): Uint8Array {
  const combined = new Uint8Array(buf.length + chunk.length);
  combined.set(buf, 0);
  combined.set(chunk, buf.length);
  if (combined.length <= PENDING_DATA_CAP) return combined;
  return combined.slice(combined.length - PENDING_DATA_CAP);
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
   * id. The TerminalStrip calls this automatically the first time
   * a worktree is selected; other call sites (merge dialog, command
   * palette, hotkeys) use it as the entry point for "open terminal"
   * affordances. */
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
      sessions.set(tempId, {
        id: tempId,
        worktree,
        status: "spawning",
        error: null,
        pendingData: new Uint8Array(0),
        dataListeners: new Set(),
      });
      return { sessions };
    });
    try {
      const id = await invoke<number>("pty_spawn", { worktree, cols: 80, rows: 24 });

      // The store owns both subscriptions (data + exit) so PTY output
      // is captured even when no view is mounted (e.g. user switched
      // to a different worktree). The data handler either dispatches
      // to live listeners or appends to `pendingData` (bounded).
      let unlistenExit: (() => void) | undefined;
      let unlistenData: (() => void) | undefined;
      const teardown = () => {
        unlistenExit?.();
        unlistenData?.();
      };

      unlistenData = await listen<{ id: number; data: number[] }>(
        `pty:data:${id}`,
        (event) => {
          const bytes = new Uint8Array(event.payload.data);
          // If a view is attached, dispatch synchronously. Reading
          // listeners via `get()` (not `set`) avoids creating a new
          // state object on every keystroke echo.
          const sess = get().sessions.get(id);
          if (sess && sess.dataListeners.size > 0) {
            for (const cb of sess.dataListeners) {
              try {
                cb(bytes);
              } catch (e) {
                console.warn("pty data listener threw", e);
              }
            }
            return;
          }
          // No view — buffer in state, bounded by PENDING_DATA_CAP.
          set((s) => {
            const sessions = new Map(s.sessions);
            const cur = sessions.get(id);
            if (!cur) return {};
            sessions.set(id, { ...cur, pendingData: appendBounded(cur.pendingData, bytes) });
            return { sessions };
          });
        },
      );

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
        sessions.set(id, {
          id,
          worktree,
          status: "running",
          error: null,
          pendingData: new Uint8Array(0),
          dataListeners: new Set(),
          unlisten: teardown,
          serializedState: undefined,
        });
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

    attachView: (sessionId, cb) => {
      // Atomically: drain pending → register cb. Reading the pending
      // buffer into a local first lets the view write it to xterm
      // before live delivery starts. If the session id is unknown
      // (e.g. it was just closed), we return an empty buffer and a
      // no-op unsubscribe.
      let pending: Uint8Array = new Uint8Array(0);
      set((s) => {
        const sessions = new Map(s.sessions);
        const cur = sessions.get(sessionId);
        if (!cur) return {};
        pending = cur.pendingData;
        const listeners = new Set(cur.dataListeners);
        listeners.add(cb);
        sessions.set(sessionId, {
          ...cur,
          pendingData: new Uint8Array(0),
          dataListeners: listeners,
        });
        return { sessions };
      });
      return {
        pending,
        unsubscribe: () => {
          set((s) => {
            const sessions = new Map(s.sessions);
            const cur = sessions.get(sessionId);
            if (!cur) return {};
            const listeners = new Set(cur.dataListeners);
            listeners.delete(cb);
            sessions.set(sessionId, { ...cur, dataListeners: listeners });
            return { sessions };
          });
        },
      };
    },

    setSerializedState: (sessionId, state) => {
      set((s) => {
        const sessions = new Map(s.sessions);
        const cur = sessions.get(sessionId);
        if (!cur) return {};
        sessions.set(sessionId, { ...cur, serializedState: state });
        return { sessions };
      });
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
