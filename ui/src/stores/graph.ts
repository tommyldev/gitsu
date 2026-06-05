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
  /** Path the graph was fetched for. Used to detect worktree switches. */
  fetchedFor: string | null;

  fetch: (worktreePath: string) => Promise<void>;
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
        fetchedFor: worktreePath,
        selectedSha,
      });
    } catch (e) {
      set({ loading: false, error: parseError(e) });
    }
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
