/**
 * Zustand store: current repository.
 *
 * Holds the active repo path, worktree list, default branch, and
 * last-fetched timestamp. Polling refresh is the source of truth for
 * worktree state; the FS watcher (added in v1.1) is a "refresh sooner"
 * signal.
 */

import { create } from "zustand";
import { invoke } from "@/lib/tauri";
import { WtRpcError, type IpcError, type RecentRepo, type VersionInfo, type WorktreeList } from "@/lib/types";

interface RepoState {
  // Currently-open repo (null when on the home/recents screen)
  repo: RecentRepo | null;
  worktrees: WorktreeList | null;
  version: VersionInfo | null;
  recents: RecentRepo[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;

  // Actions
  setRepo: (r: RecentRepo | null) => void;
  refresh: () => Promise<void>;
  refreshRecents: () => Promise<void>;
  openByPath: (path: string) => Promise<void>;
  pickAndOpen: () => Promise<void>;
  forget: (path: string) => Promise<void>;
  clearError: () => void;
}

const POLL_MS = 3000;

export const useRepoStore = create<RepoState>((set, get) => ({
  repo: null,
  worktrees: null,
  version: null,
  recents: [],
  loading: false,
  error: null,
  lastFetched: null,

  setRepo: (r) => set({ repo: r, worktrees: null, error: null }),

  refreshRecents: async () => {
    try {
      const recents = await invoke<RecentRepo[]>("recent_repos");
      set({ recents });
    } catch (e) {
      // Non-fatal — recents are a nice-to-have on the home screen.
      console.warn("refreshRecents", e);
    }
  },

  refresh: async () => {
    const { repo } = get();
    if (!repo) return;
    try {
      const [worktrees, version] = await Promise.all([
        invoke<WorktreeList>("wt_list", { repo: repo.path }),
        invoke<VersionInfo>("wt_version", { repo: repo.path }),
      ]);
      set({ worktrees, version, loading: false, error: null, lastFetched: Date.now() });
    } catch (e) {
      const err = parseError(e);
      set({ loading: false, error: err });
    }
  },

  openByPath: async (path) => {
    set({ loading: true, error: null });
    try {
      const r = await invoke<RecentRepo>("open_repo", { path });
      set({ repo: r, worktrees: null });
      await get().refresh();
      await get().refreshRecents();
    } catch (e) {
      set({ loading: false, error: parseError(e) });
    }
  },

  pickAndOpen: async () => {
    set({ loading: true, error: null });
    try {
      // The dialog plugin's pick_folder is invoked via the shell.
      // We use the dedicated Rust command for typed + cancellable behavior.
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = (await open({ directory: true, multiple: false })) as string | null;
      if (!picked) {
        set({ loading: false });
        return;
      }
      await get().openByPath(picked);
    } catch (e) {
      set({ loading: false, error: parseError(e) });
    }
  },

  forget: async (path) => {
    try {
      await invoke("forget_repo", { path });
      await get().refreshRecents();
    } catch (e) {
      set({ error: parseError(e) });
    }
  },

  clearError: () => set({ error: null }),
}));

// Background polling for worktree state. v1.1 swaps this for event-based
// refresh driven by the FS watcher.
let pollHandle: number | null = null;
export function startPolling() {
  stopPolling();
  pollHandle = window.setInterval(() => {
    useRepoStore.getState().refresh();
  }, POLL_MS);
}
export function stopPolling() {
  if (pollHandle !== null) {
    window.clearInterval(pollHandle);
    pollHandle = null;
  }
}

function parseError(e: unknown): string {
  if (e instanceof WtRpcError) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    const m = (e as IpcError).message;
    if (m) return m;
  }
  if (typeof e === "string") return e;
  return String(e);
}
