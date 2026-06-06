/**
 * PTY-session slice: spawning, IO, event subscriptions, and teardown.
 * `spawnPty` is a standalone helper (parameterized by the store's
 * `set`/`get`) so the layout slice can spawn sessions without the
 * pty internals leaking onto the public store API.
 */

import type { StateCreator } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { ptySpawn, ptySend, ptyResize, ptyKill } from "@/lib/tauri";
import { parseError } from "@/lib/errors";
import { newTempSessionId } from "@/lib/terminal-layout";
import type { PtySlice, TerminalState } from "./types";

type TerminalSet = Parameters<StateCreator<TerminalState>>[0];
type TerminalGet = Parameters<StateCreator<TerminalState>>[1];

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

/** Spawn a PTY and wire up its event listeners. Returns the real
 * backend id once the shell is running (or throws on failure). */
export async function spawnPty(
  set: TerminalSet,
  get: TerminalGet,
  worktree: string,
): Promise<number> {
  const tempId = newTempSessionId();
  // Optimistic placeholder so the pane can render a "spawning"
  // state immediately. We replace this with the real id once
  // `pty_spawn` resolves. `cwd` starts at the worktree root — the
  // shell will report its actual CWD via OSC 7 once it boots and
  // emits its first prompt.
  set((s) => {
    const sessions = new Map(s.sessions);
    sessions.set(tempId, {
      id: tempId,
      worktree,
      status: "spawning",
      error: null,
      cwd: worktree,
      pendingData: new Uint8Array(0),
      dataListeners: new Set(),
    });
    return { sessions };
  });
  try {
    const id = await ptySpawn(worktree, 80, 24);

    // The store owns both subscriptions (data + exit) so PTY output
    // is captured even when no view is mounted (e.g. user switched
    // to a different worktree). The data handler either dispatches
    // to live listeners or appends to `pendingData` (bounded).
    // We also subscribe to `pty:cwd` so the directory explorer
    // stays in sync with the shell's actual working directory.
    let unlistenExit: (() => void) | undefined;
    let unlistenData: (() => void) | undefined;
    let unlistenCwd: (() => void) | undefined;
    const teardown = () => {
      unlistenExit?.();
      unlistenData?.();
      unlistenCwd?.();
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

    unlistenCwd = await listen<{ id: number; cwd: string }>(
      `pty:cwd:${id}`,
      (event) => {
        set((s) => {
          const sessions = new Map(s.sessions);
          const cur = sessions.get(id);
          if (!cur) return {};
          // Only update if the CWD actually changed. The Rust
          // side already deduplicates, but checking here too
          // avoids pointless map churn on no-op events.
          if (cur.cwd === event.payload.cwd) return {};
          sessions.set(id, { ...cur, cwd: event.payload.cwd });
          return { sessions };
        });
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
        cwd: worktree,
        pendingData: new Uint8Array(0),
        dataListeners: new Set(),
        unlisten: teardown,
        unlistenCwd,
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
}

export const createPtySlice: StateCreator<TerminalState, [], [], PtySlice> = (set, get) => ({
  sessions: new Map(),

  send: async (id, data) => {
    try {
      await ptySend(id, Array.from(data));
    } catch (e) {
      console.warn("pty_send failed", e);
    }
  },

  resize: async (id, cols, rows) => {
    try {
      await ptyResize(id, cols, rows);
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
        await ptyKill(session.id);
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
});
