/**
 * Local selectors for the terminal strip + other components that
 * need quick access to the "currently selected worktree" without
 * dragging the whole graph store around.
 *
 * The "selected worktree" is independent of the graph's selected
 * commit: it's the worktree whose terminal is open in the bottom
 * strip, or the last one the user touched.
 */

import { useEffect, useState } from "react";
import { useRepoStore } from "@/stores/repo";
import type { Worktree } from "@/lib/types";

/** Returns the most recently refreshed worktree list. */
export function useWorktrees(): Worktree[] {
  return useRepoWorktrees();
}

function useRepoWorktrees(): Worktree[] {
  const repo = useRepoStore((s) => s.repo);
  const lastFetched = useRepoStore((s) => s.lastFetched);
  const [list, setList] = useState<Worktree[]>([]);
  useEffect(() => {
    if (!repo) {
      setList([]);
      return;
    }
    let cancelled = false;
    void import("@/lib/tauri").then(async ({ invoke }) => {
      try {
        const result = await invoke<{ items: Worktree[] }>("wt_list", { repo: repo.path });
        if (!cancelled) setList(result.items);
      } catch {
        if (!cancelled) setList([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [repo, lastFetched]);
  return list;
}

/** The currently "selected" worktree, used by the terminal strip. */
export function useSelectedWorktree(): [string | null, (path: string | null) => void] {
  const repo = useRepoStore((s) => s.repo);
  const [selected, setSelected] = useState<string | null>(null);
  // Default to the main worktree's path when a repo is opened.
  useEffect(() => {
    if (repo && selected === null) {
      setSelected(repo.path);
    }
    if (!repo) setSelected(null);
  }, [repo, selected]);
  return [selected, setSelected];
}
