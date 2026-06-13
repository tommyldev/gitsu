/**
 * Zustand store: staging area for the active worktree (the commit
 * composer in graph view).
 *
 * Owns the `git status` entry list, the draft commit message, and
 * the stage/unstage/commit actions. The CommitComposer panel and
 * the graph's pending working-tree node both read from here, so the
 * node's "fill" tracks staging progress live.
 *
 * Fetches are deduped per worktree (the composer and the graph both
 * sync on the same poll signal). After a successful commit we
 * refresh the repo poll + commit graph so the pending node
 * "solidifies" into the new head commit.
 */

import { create } from "zustand";
import {
  gitStatusList,
  gitStage,
  gitUnstage,
  gitStageAll,
  gitUnstageAll,
  gitCommit,
} from "@/lib/tauri";
import type { StatusEntry } from "@/lib/types";
import { parseError } from "@/lib/errors";
import { useRepoStore } from "./repo";
import { useGraphStore } from "./graph";

interface StagingState {
  /** Worktree path the entries belong to. */
  worktree: string | null;
  entries: StatusEntry[];
  loading: boolean;
  error: string | null;
  /** Draft commit message (survives panel re-renders). */
  message: string;
  committing: boolean;
  /** Bumped when the pending graph node is clicked — the composer
   *  focuses its message box in response. */
  focusToken: number;
  /** Bumped when the user clicks the pending working-tree row in
   *  the graph. The composer uses this to switch from the commit-
   *  inspect view back to the staging UI, in addition to focusing
   *  the message box. */
  workdirToken: number;

  fetch: (worktree: string) => Promise<void>;
  stage: (path: string) => Promise<void>;
  unstage: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  setMessage: (m: string) => void;
  /** Commit the index. Returns true on success. */
  commit: () => Promise<boolean>;
  requestFocus: () => void;
  /** Pending working-tree row in the graph was clicked: focus the
   *  message box AND signal the composer to switch back to the
   *  staging UI. */
  requestWorkdir: () => void;
  clear: () => void;
}

export const useStagingStore = create<StagingState>((set, get) => {
  /** Run a mutation, then refresh the entry list. Errors land in
   *  `error` (the composer shows them inline). */
  const mutate = async (fn: (worktree: string) => Promise<void>) => {
    const { worktree } = get();
    if (!worktree) return;
    try {
      await fn(worktree);
      set({ error: null });
    } catch (e) {
      set({ error: parseError(e) });
    }
    await get().fetch(worktree);
  };

  return {
    worktree: null,
    entries: [],
    loading: false,
    error: null,
    message: "",
    committing: false,
    focusToken: 0,
    workdirToken: 0,

    fetch: async (worktree) => {
      // Dedupe: one in-flight status read per worktree.
      if (get().loading && get().worktree === worktree) return;
      // Switching worktrees discards the other tree's draft state.
      if (get().worktree !== worktree) {
        set({ worktree, entries: [], message: "", error: null });
      }
      set({ loading: true });
      try {
        const entries = await gitStatusList(worktree);
        // A poll may have switched the active worktree mid-flight.
        if (get().worktree === worktree) set({ entries, loading: false });
      } catch (e) {
        if (get().worktree === worktree) set({ error: parseError(e), loading: false });
      }
    },

    stage: (path) => mutate((wt) => gitStage(wt, path)),
    unstage: (path) => mutate((wt) => gitUnstage(wt, path)),
    stageAll: () => mutate((wt) => gitStageAll(wt)),
    unstageAll: () => mutate((wt) => gitUnstageAll(wt)),

    setMessage: (m) => set({ message: m }),

    commit: async () => {
      const { worktree, message } = get();
      if (!worktree || !message.trim()) return false;
      set({ committing: true });
      try {
        await gitCommit(worktree, message);
        set({ message: "", error: null, committing: false });
        // Solidify the pending node: refresh the worktree poll (the
        // working-tree row disappears) and the graph (the new head
        // commit appears as a real, filled node). The graph fetch
        // dedupes by worktree, so we must `force: true` here — the
        // graph store would otherwise short-circuit, `selectedSha`
        // would stay on the (now-gone) working-tree row, and the
        // right panel would render its blank state instead of the
        // new HEAD's details.
        await get().fetch(worktree);
        await useRepoStore.getState().refresh();
        await useGraphStore.getState().fetch(worktree, { force: true });
        return true;
      } catch (e) {
        set({ error: parseError(e), committing: false });
        return false;
      }
    },

    requestFocus: () => set((s) => ({ focusToken: s.focusToken + 1 })),

    /** The pending working-tree row in the graph was clicked. Bump
     *  both tokens: `focusToken` focuses the message box, `workdirToken`
     *  signals the composer to switch out of commit-inspect mode. */
    requestWorkdir: () =>
      set((s) => ({
        focusToken: s.focusToken + 1,
        workdirToken: s.workdirToken + 1,
      })),

    clear: () =>
      set({
        worktree: null,
        entries: [],
        loading: false,
        error: null,
        message: "",
        committing: false,
        focusToken: 0,
        workdirToken: 0,
      }),
  };
});

/** Staging progress for the pending graph node: fraction of changed
 *  paths that are fully staged (no remaining unstaged side). */
export function stagedRatio(entries: StatusEntry[]): number {
  if (entries.length === 0) return 0;
  let staged = 0;
  for (const e of entries) {
    if (e.staged !== null && e.unstaged === null) staged++;
  }
  return staged / entries.length;
}
