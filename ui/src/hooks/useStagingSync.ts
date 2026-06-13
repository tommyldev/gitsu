/**
 * Keeps the staging store in sync with the active worktree.
 *
 * The repo store polls `wt list` every 3s; its `working_tree`
 * summary is our cheap change signal. When the summary (or the
 * active worktree) changes, we re-read the full per-path status.
 * Both the CommitComposer panel and the CommitGraph's pending node
 * call this — the store dedupes concurrent fetches.
 */

import { useEffect } from "react";
import { useGraphStore } from "@/stores/graph";
import { useRepoStore } from "@/stores/repo";
import { useStagingStore } from "@/stores/staging";
import type { WorkingTree } from "@/lib/types";

export function useStagingSync(): {
  activePath: string | null;
  workingTree: WorkingTree | null;
  hasUncommitted: boolean;
} {
  const activePath = useGraphStore((s) => s.activePath);
  const worktrees = useRepoStore((s) => s.worktrees);

  const workingTree =
    worktrees?.items.find((w) => w.path === activePath)?.working_tree ?? null;
  const hasUncommitted =
    !!workingTree &&
    (workingTree.staged ||
      workingTree.modified ||
      workingTree.untracked ||
      workingTree.renamed ||
      workingTree.deleted);

  // Poll objects are recreated every 3s; compare by value so we only
  // re-read the per-path status when something actually changed.
  const signature = workingTree
    ? [
        workingTree.staged,
        workingTree.modified,
        workingTree.untracked,
        workingTree.renamed,
        workingTree.deleted,
        workingTree.diff?.added ?? 0,
        workingTree.diff?.deleted ?? 0,
      ].join("|")
    : "clean";

  useEffect(() => {
    if (activePath) void useStagingStore.getState().fetch(activePath);
  }, [activePath, signature]);

  return { activePath, workingTree, hasUncommitted };
}
