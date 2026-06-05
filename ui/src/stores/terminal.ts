/**
 * Terminal store — manages the per-worktree PTY sessions.
 *
 * On first open of a worktree, the store spawns a PTY. Output arrives
 * via `pty:data:<id>` Tauri events. The xterm.js frontend renders it.
 *
 * Sessions are persisted across worktree navigation (the PTY keeps
 * running in the background). Closing a tab kills the PTY. The
 * backend cleans up on `wt remove` for the matching worktree.
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

interface TerminalState {
  sessions: Map<string, PtySession>;
  /** worktree → session id (one per worktree) */
  byWorktree: Map<string, number>;
  loading: boolean;

  /** Open (or focus) the terminal for a worktree. */
  open: (worktree: string, cols: number, rows: number) => Promise<number>;
  /** Close (kill) the terminal for a worktree. */
  close: (worktree: string) => Promise<void>;
  /** Send input bytes (frontend keystrokes). */
  send: (id: number, data: Uint8Array) => Promise<void>;
  /** Resize the PTY (xterm.js calls this on container resize). */
  resize: (id: number, cols: number, rows: number) => Promise<void>;

  /** Tear down everything (e.g. on repo close). */
  clear: () => Promise<void>;
}

let nextTempId = 1_000_000; // unlikely to collide with the backend's allocator

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: new Map(),
  byWorktree: new Map(),
  loading: false,

  open: async (worktree, cols, rows) => {
    const existing = get().byWorktree.get(worktree);
    if (existing !== undefined) {
      return existing;
    }
    // Optimistic placeholder
    const placeholderId = nextTempId++;
    set((s) => {
      const sessions = new Map(s.sessions);
      sessions.set(worktree, {
        id: placeholderId,
        worktree,
        status: "spawning",
        error: null,
      });
      const byWorktree = new Map(s.byWorktree);
      byWorktree.set(worktree, placeholderId);
      return { sessions, byWorktree };
    });

    try {
      const id = await invoke<number>("pty_spawn", { worktree, cols, rows });
      // Subscribe to events for this PTY. The callbacks update the
      // session status in place; we don't need to read the data here
      // (the Terminal component subscribes to its own copy of the
      // event when it mounts).
      let unlistenData: (() => void) | undefined;
      let unlistenExit: (() => void) | undefined;
      const teardown = () => {
        unlistenData?.();
        unlistenExit?.();
      };
      unlistenData = await listen<{ id: number; data: number[] }>(
        `pty:data:${id}`,
        () => {
          // No-op: the per-mount Terminal subscribes for its own
          // session id. We keep this listener registered as a no-op
          // so the event isn't "lost" if no component is mounted
          // yet — without it, xterm would miss early output.
        },
      );
      unlistenExit = await listen<{ id: number; code: number | null }>(
        `pty:exit:${id}`,
        () => {
          set((s) => {
            const sessions = new Map(s.sessions);
            const cur = sessions.get(worktree);
            if (cur && cur.id === id) {
              sessions.set(worktree, { ...cur, status: "exited" });
            }
            return { sessions };
          });
          teardown();
        },
      );
      // Replace placeholder with the real session.
      set((s) => {
        const sessions = new Map(s.sessions);
        sessions.set(worktree, {
          id,
          worktree,
          status: "running",
          error: null,
          unlisten: teardown,
        });
        const byWorktree = new Map(s.byWorktree);
        byWorktree.set(worktree, id);
        return { sessions, byWorktree };
      });
      return id;
    } catch (e) {
      set((s) => {
        const sessions = new Map(s.sessions);
        const cur = sessions.get(worktree);
        if (cur) {
          sessions.set(worktree, {
            ...cur,
            status: "error",
            error: parseError(e),
          });
        }
        return { sessions };
      });
      throw e;
    }
  },

  close: async (worktree) => {
    const session = get().sessions.get(worktree);
    if (!session) return;
    session.unlisten?.();
    try {
      await invoke("pty_kill", { id: session.id });
    } catch (e) {
      if (!(e instanceof WtRpcError && e.kind === "invalid_argument")) {
        console.warn("pty_kill failed", e);
      }
    }
    set((s) => {
      const sessions = new Map(s.sessions);
      sessions.delete(worktree);
      const byWorktree = new Map(s.byWorktree);
      byWorktree.delete(worktree);
      return { sessions, byWorktree };
    });
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
    set({ sessions: new Map(), byWorktree: new Map() });
  },
}));

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
