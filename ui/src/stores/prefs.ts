/**
 * Zustand store: small UI preferences that need to survive page reloads
 * but don't belong in the SQLite-backed `settings` table (which is for
 * things like keybinds, theme, worktree path template).
 *
 * Currently:
 *   - `hideGraphPanel`: collapse the center (graph) + right (commit
 *     panel) panes so the worktree list spans the full width. Useful
 *     on small windows or when you only need to scan the worktree
 *     list and don't want the commit DAG rendered.
 *   - `hideWorktreeList`: independently hide the left worktree list
 *     (cmux ⌘B convention).
 *   - `hideCommitPanel`: independently hide the right commit panel
 *     while keeping the center graph visible (cmux ⌘⌥B convention).
 *
 * The three flags are orthogonal — a user can hide any combination.
 * `hideGraphPanel` is the "compact mode" preset that hides both the
 * graph and the commit panel; the per-side flags are surgical
 * toggles for users who want graph-but-no-panel or panel-but-no-list.
 *
 * Persistence: the `persist` middleware (zustand/middleware) under
 * `gitsu:prefs:v1` in localStorage. `partialize` writes only the flags
 * (never the actions); a legacy-aware storage adapter rewraps the flat
 * blob older builds wrote so upgrades don't drop a user's prefs.
 */

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";

interface PrefsState {
  hideGraphPanel: boolean;
  hideWorktreeList: boolean;
  hideCommitPanel: boolean;

  setHideGraphPanel: (v: boolean) => void;
  toggleHideGraphPanel: () => void;

  setHideWorktreeList: (v: boolean) => void;
  toggleHideWorktreeList: () => void;

  setHideCommitPanel: (v: boolean) => void;
  toggleHideCommitPanel: () => void;
}

const STORAGE_KEY = "gitsu:prefs:v1";

/**
 * Backward-compatible storage. Earlier builds wrote a flat
 * `{ hideGraphPanel, … }` blob; `persist` expects a `{ state, version }`
 * envelope. On read, rewrap the legacy shape so existing users keep
 * their panel prefs across this upgrade. `window`-guarded for SSR /
 * non-browser safety (mostly defensive — the app runs in a webview).
 */
const prefsStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(name);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && "state" in parsed) return raw;
      return JSON.stringify({ state: parsed, version: 0 });
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(name, value);
  },
  removeItem: (name) => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(name);
  },
};

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set, get) => ({
      hideGraphPanel: false,
      hideWorktreeList: false,
      hideCommitPanel: false,

      setHideGraphPanel: (v) => set({ hideGraphPanel: v }),
      toggleHideGraphPanel: () => set({ hideGraphPanel: !get().hideGraphPanel }),

      setHideWorktreeList: (v) => set({ hideWorktreeList: v }),
      toggleHideWorktreeList: () => set({ hideWorktreeList: !get().hideWorktreeList }),

      setHideCommitPanel: (v) => set({ hideCommitPanel: v }),
      toggleHideCommitPanel: () => set({ hideCommitPanel: !get().hideCommitPanel }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => prefsStorage),
      // Persist only the flags, never the action functions.
      partialize: (s) => ({
        hideGraphPanel: s.hideGraphPanel,
        hideWorktreeList: s.hideWorktreeList,
        hideCommitPanel: s.hideCommitPanel,
      }),
    },
  ),
);
