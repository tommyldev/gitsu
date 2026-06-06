/**
 * Hooks store — snapshot of `.config/wt.toml` for the current repo.
 * Updated whenever the user installs/uninstalls via the Hooks manager.
 */

import { create } from "zustand";
import { hooksSnapshot, hooksInstall, hooksUninstall, wtStepCopyIgnored } from "@/lib/tauri";
import { type HookConfigSnapshot } from "@/lib/types";
import { parseError } from "@/lib/errors";

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
      const snap = await hooksSnapshot(repoPath);
      set({ snapshot: snap, fetchedFor: repoPath, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: parseError(e) });
    }
  },

  install: async (repoPath, withWorktreeinclude) => {
    set({ loading: true });
    try {
      const snap = await hooksInstall(repoPath, withWorktreeinclude);
      set({ snapshot: snap, fetchedFor: repoPath, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: parseError(e) });
    }
  },

  uninstall: async (repoPath) => {
    set({ loading: true });
    try {
      const snap = await hooksUninstall(repoPath);
      set({ snapshot: snap, fetchedFor: repoPath, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: parseError(e) });
    }
  },

  recopy: async (repoPath, from, to) => {
    try {
      await wtStepCopyIgnored(repoPath, from, to);
    } catch (e) {
      set({ error: parseError(e) });
    }
  },

  dismissBanner: () => set({ dismissed: true }),

  clear: () => set({ snapshot: null, fetchedFor: null, error: null, dismissed: false }),
}));