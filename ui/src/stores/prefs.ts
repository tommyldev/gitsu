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
 * Persistence: localStorage under `gitsu:prefs:v1`. v1 lets us bump the
 * shape without nuking user prefs on future additions.
 */

import { create } from "zustand";

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

interface Persisted {
  hideGraphPanel?: boolean;
  hideWorktreeList?: boolean;
  hideCommitPanel?: boolean;
}

function readInitial(): Persisted {
  // SSR / non-browser safety — the app runs in a Tauri webview so this
  // is mostly defensive.
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Persisted;
    return {
      hideGraphPanel: parsed.hideGraphPanel === true,
      hideWorktreeList: parsed.hideWorktreeList === true,
      hideCommitPanel: parsed.hideCommitPanel === true,
    };
  } catch (e) {
    console.warn("prefs: failed to read localStorage", e);
    return {};
  }
}

function persist(state: PrefsState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        hideGraphPanel: state.hideGraphPanel,
        hideWorktreeList: state.hideWorktreeList,
        hideCommitPanel: state.hideCommitPanel,
      }),
    );
  } catch (e) {
    console.warn("prefs: failed to write localStorage", e);
  }
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  hideGraphPanel: false,
  hideWorktreeList: false,
  hideCommitPanel: false,
  ...readInitial(),

  setHideGraphPanel: (v) => {
    set({ hideGraphPanel: v });
    persist(get());
  },

  toggleHideGraphPanel: () => {
    set({ hideGraphPanel: !get().hideGraphPanel });
    persist(get());
  },

  setHideWorktreeList: (v) => {
    set({ hideWorktreeList: v });
    persist(get());
  },

  toggleHideWorktreeList: () => {
    set({ hideWorktreeList: !get().hideWorktreeList });
    persist(get());
  },

  setHideCommitPanel: (v) => {
    set({ hideCommitPanel: v });
    persist(get());
  },

  toggleHideCommitPanel: () => {
    set({ hideCommitPanel: !get().hideCommitPanel });
    persist(get());
  },
}));
