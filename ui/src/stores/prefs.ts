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
 *
 * Persistence: localStorage under `gitsu:prefs:v1`. v1 lets us bump the
 * shape without nuking user prefs on future additions.
 */

import { create } from "zustand";

interface PrefsState {
  hideGraphPanel: boolean;
  setHideGraphPanel: (v: boolean) => void;
  toggleHideGraphPanel: () => void;
}

const STORAGE_KEY = "gitsu:prefs:v1";

function readInitial(): Pick<PrefsState, "hideGraphPanel"> {
  // SSR / non-browser safety — the app runs in a Tauri webview so this
  // is mostly defensive.
  if (typeof window === "undefined") return { hideGraphPanel: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { hideGraphPanel: false };
    const parsed = JSON.parse(raw) as { hideGraphPanel?: unknown };
    return { hideGraphPanel: parsed.hideGraphPanel === true };
  } catch (e) {
    console.warn("prefs: failed to read localStorage", e);
    return { hideGraphPanel: false };
  }
}

function persist(state: PrefsState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ hideGraphPanel: state.hideGraphPanel }),
    );
  } catch (e) {
    console.warn("prefs: failed to write localStorage", e);
  }
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  ...readInitial(),

  setHideGraphPanel: (v) => {
    set({ hideGraphPanel: v });
    persist(get());
  },

  toggleHideGraphPanel: () => {
    set({ hideGraphPanel: !get().hideGraphPanel });
    persist(get());
  },
}));
