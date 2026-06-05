/**
 * Hooks store — snapshot of `.config/wt.toml` for the current repo.
 * Updated whenever the user installs/uninstalls via the Hooks manager.
 */

import { create } from "zustand";
import { invoke } from "@/lib/tauri";
import { WtRpcError, type IpcError, type HookConfigSnapshot } from "@/lib/types";

interface HooksState {
  snapshot: HookConfigSnapshot | null;
  fetchedFor: string | null;
  loading: boolean;
  error: string | null;
  /** Dismissed by the user so the banner doesn't reappear every refresh. */
  dismissed: boolean;

  fetch: (repoPath: string) => Promise<void>;
  install: (repoPath: string, withWorktreeinclude: boolean) => Promise<void>;
  uninstall: (repoPath: string) => Promise<void>;
  recopy: (repoPath: string, from: string, to: string) => Promise<void>;
  dismissBanner: () => void;
  clear: () => void;
}

export const useHooksStore = create<HooksState>((set, get) => ({
  snapshot: null,
  fetchedFor: null,
  loading: false,
  error: null,
  dismissed: false,

  fetch: async (repoPath) => {
    if (get().fetchedFor === repoPath) return;
    set({ loading: true });
    try {
      const snap = await invoke<HookConfigSnapshot>("hooks_snapshot", { repo: repoPath });
      set({ snapshot: snap, fetchedFor: repoPath, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: parseError(e) });
    }
  },

  install: async (repoPath, withWorktreeinclude) => {
    set({ loading: true });
    try {
      const snap = await invoke<HookConfigSnapshot>("hooks_install", {
        repo: repoPath,
        withWorktreeinclude,
      });
      set({ snapshot: snap, fetchedFor: repoPath, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: parseError(e) });
    }
  },

  uninstall: async (repoPath) => {
    set({ loading: true });
    try {
      const snap = await invoke<HookConfigSnapshot>("hooks_uninstall", { repo: repoPath });
      set({ snapshot: snap, fetchedFor: repoPath, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: parseError(e) });
    }
  },

  recopy: async (repoPath, from, to) => {
    try {
      await invoke("wt_step_copy_ignored", {
        repo: repoPath,
        from,
        to,
        force: true,
      });
    } catch (e) {
      set({ error: parseError(e) });
    }
  },

  dismissBanner: () => set({ dismissed: true }),

  clear: () => set({ snapshot: null, fetchedFor: null, error: null, dismissed: false }),
}));

function parseError(e: unknown): string {
  if (e instanceof WtRpcError) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    return (e as IpcError).message ?? String(e);
  }
  if (typeof e === "string") return e;
  return String(e);
}
