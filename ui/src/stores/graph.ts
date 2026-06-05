/**
 * Zustand store: commit graph for the currently-open worktree.
 *
 * The graph is fetched on worktree change + manual refresh. We don't
 * poll — the graph changes less often than the worktree list, and a
 * stale graph is harmless. The graph layout (lanes) is recomputed on
 * each fetch; it's pure and fast (<5ms for 500 commits).
 */

import { create } from "zustand";
import { invoke } from "@/lib/tauri";
import { WtRpcError, type CommitGraph, type IpcError } from "@/lib/types";
import { layout, type GraphLayout } from "@/lib/dag";

interface GraphState {
  graph: CommitGraph | null;
  layout: GraphLayout | null;
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
  selectedSha: string | null;
  /**
   * Path the graph was fetched for. Used to detect worktree switches
   * and to drive the worktree-list row highlight.
   *
   * Note: this can diverge from `wt list`'s `is_current` — the user
   * can view a graph for any worktree without `cd`-ing the OS-level
   * current. That divergence is intentional: the gitsu "active
   * worktree" is a UI concept, the worktrunk "current worktree" is a
   * shell concept.
   */
  activePath: string | null;
  /** Alias kept for backwards compat with existing readers. */
  fetchedFor: string | null;

  fetch: (worktreePath: string) => Promise<void>;
  /**
   * Switch the active worktree. Triggers a graph fetch for the new
   * path; clears the selected commit (the new graph starts on HEAD).
   * Pass `null` to clear (e.g. on repo close).
   */
  setActive: (worktreePath: string | null) => Promise<void>;
  select: (sha: string | null) => void;
  clear: () => void;
}

const MAX_COMMITS = 500;

export const useGraphStore = create<GraphState>((set, get) => ({
  graph: null,
  layout: null,
  loading: false,
  error: null,
  lastFetched: null,
  selectedSha: null,
  activePath: null,
  fetchedFor: null,

  fetch: async (worktreePath: string) => {
    // If the worktree hasn't changed and we have data, skip.
    if (get().fetchedFor === worktreePath && get().graph) return;
    set({ loading: true, error: null });
    try {
      const graph = await invoke<CommitGraph>("graph_build", {
        repo: worktreePath,
        refName: null,
        maxCount: MAX_COMMITS,
      });
      const layoutResult = layout(graph);
      // Pre-select HEAD so the right pane has something to show.
      const selectedSha = graph.head_sha || graph.nodes[0]?.sha || null;
      set({
        graph,
        layout: layoutResult,
        loading: false,
        error: null,
        lastFetched: Date.now(),
        activePath: worktreePath,
        fetchedFor: worktreePath,
        selectedSha,
      });
    } catch (e) {
      set({ loading: false, error: parseError(e) });
    }
  },

  setActive: async (worktreePath: string | null) => {
    if (worktreePath === null) {
      set({ activePath: null, fetchedFor: null });
      return;
    }
    // Same path → no-op (graph already loaded).
    if (get().activePath === worktreePath && get().graph) return;
    // Clear selection so the new graph starts on HEAD; the
    // right-pane commit panel relies on selectedSha matching a node
    // in `graph`.
    set({ selectedSha: null, activePath: worktreePath });
    await get().fetch(worktreePath);
  },

  select: (sha) => set({ selectedSha: sha }),

  clear: () =>
    set({
      graph: null,
      layout: null,
      loading: false,
      error: null,
      lastFetched: null,
      selectedSha: null,
      activePath: null,
      fetchedFor: null,
    }),
}));

function parseError(e: unknown): string {
  if (e instanceof WtRpcError) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    return (e as IpcError).message ?? String(e);
  }
  if (typeof e === "string") return e;
  return String(e);
}
