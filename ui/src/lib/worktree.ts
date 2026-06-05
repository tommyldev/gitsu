/**
 * Small helpers for rendering worktree data. The Rust side uses
 * `Option<String>` for `branch` and `path` because worktrunk emits
 * `null` for detached-HEAD / broken worktrees. These helpers give
 * the UI a single place to handle that without littering call sites.
 */

import type { Worktree } from "@/lib/types";

/**
 * Display label for a worktree's branch. Falls back to the short
 * SHA or "detached" for a detached-HEAD worktree. Returns
 * "branch-name", "detached @ a1b2c3d", or just "detached" if no
 * useful identifier is available.
 */
export function displayBranch(wt: Pick<Worktree, "branch" | "commit" | "statusline">): string {
  if (wt.branch) return wt.branch;
  // Detached: try the statusline (wt formats it like "a1b2c3d (detached)"),
  // then the short SHA, then a generic label.
  if (wt.statusline) return `${wt.statusline} (detached)`;
  const sha = wt.commit?.short_sha;
  if (sha) return `detached @ ${sha}`;
  return "detached";
}

/**
 * True if the worktree is detached (no branch). We treat a null
 * branch as detached even if `wt.worktree.detached` is missing —
 * wt's JSON can omit that field, but a missing branch is the more
 * reliable signal.
 */
export function isDetached(wt: Pick<Worktree, "branch">): boolean {
  return wt.branch === null || wt.branch === "";
}

/**
 * Sort order for the worktree list. Centralized here so the
 * `WorktreeList` row order and the `Cmd/Ctrl + N` keyboard shortcut
 * always agree (shortcut index 1 = top row).
 *
 * Order:
 *   1. `is_current` first (the worktree the user is on)
 *   2. `is_main` second (the primary / default-branch worktree)
 *   3. Detached worktrees last
 *   4. Otherwise alphabetical by displayBranch
 */
export function sortWorktrees(list: Worktree[]): Worktree[] {
  return list.slice().sort((a, b) => {
    if (a.is_current) return -1;
    if (b.is_current) return 1;
    if (a.is_main) return -1;
    if (b.is_main) return 1;
    const ka = isDetached(a);
    const kb = isDetached(b);
    if (ka !== kb) return ka ? 1 : -1;
    return displayBranch(a).localeCompare(displayBranch(b));
  });
}
