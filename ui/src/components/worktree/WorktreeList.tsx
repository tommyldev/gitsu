/**
 * Worktree list — the centerpiece of gitsu's M1 dashboard.
 *
 * Lists worktrees from `useRepoStore.worktrees` as cards. Each card
 * shows branch, status counts, ahead/behind, agent session, and
 * quick actions. Selecting a worktree is a no-op in M1 (the
 * commit-graph + diff viewer come in M2-M3); the card is informational
 * + the source of "current worktree" for downstream views.
 */

import { useMemo } from "react";
import clsx from "clsx";
import { GitBranch, Folder, AlertCircle, GitCommit, Trash2, GitMerge } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { Card, Pill } from "@/components/ui/primitives";
import { displayBranch, isDetached } from "@/lib/worktree";
import type { Worktree } from "@/lib/types";

export function WorktreeList({
  onRemove,
  onSelect,
  onMerge,
}: {
  onRemove: (wt: Worktree) => void;
  onSelect?: (wt: Worktree) => void;
  onMerge?: (wt: Worktree) => void;
}) {
  const { worktrees, loading, error, repo } = useRepoStore();
  const sorted = useMemo(
    () =>
      (worktrees?.items ?? []).slice().sort((a, b) => {
        if (a.is_current) return -1;
        if (b.is_current) return 1;
        if (a.is_main) return -1;
        if (b.is_main) return 1;
        // Detached worktrees sort to the bottom; otherwise sort by
        // branch name (or statusline, for detached).
        const ka = isDetached(a);
        const kb = isDetached(b);
        if (ka !== kb) return ka ? 1 : -1;
        return displayBranch(a).localeCompare(displayBranch(b));
      }),
    [worktrees],
  );

  if (!repo) return null;

  if (loading && !worktrees) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        <span className="animate-pulse">Loading worktrees…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-muted">
        <Folder size={32} className="opacity-50" />
        <p>No worktrees found for this repository.</p>
        <p className="text-xs">
          Use <kbd className="rounded bg-bg-subtle px-1.5 py-0.5">⌘N</kbd> to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {sorted.map((wt) => (
        <WorktreeCard
          key={wt.path}
          wt={wt}
          onRemove={onRemove}
          onSelect={onSelect}
          onMerge={onMerge}
        />
      ))}
    </div>
  );
}

function WorktreeCard({
  wt,
  onRemove,
  onSelect,
  onMerge,
}: {
  wt: Worktree;
  onRemove: (wt: Worktree) => void;
  onSelect?: (wt: Worktree) => void;
  onMerge?: (wt: Worktree) => void;
}) {
  const dirty = !!wt.working_tree && (wt.working_tree.staged || wt.working_tree.modified || wt.working_tree.untracked);
  const mainStateTone = mainStateToTone(wt.main_state);
  const detached = isDetached(wt);
  const branchLabel = displayBranch(wt);
  // Detached worktrees can't be merged via `wt switch --create <branch>`
  // (you'd need a real branch name), so we hide the merge button
  // for them. The "create worktree at this commit" path in the
  // commit context menu still works.
  const canMerge = !wt.is_main && !detached;

  return (
    <Card
      interactive
      onClick={() => onSelect?.(wt)}
      className={clsx(
        "group flex flex-col gap-2",
        wt.is_current && "border-accent/40",
        detached && "border-fg-subtle/30",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {detached ? (
            <GitBranch size={16} className="shrink-0 text-fg-muted" />
          ) : (
            <GitBranch size={16} className="shrink-0 text-accent" />
          )}
          <span className="truncate font-mono text-sm font-medium" title={branchLabel}>
            {branchLabel}
          </span>
          {detached && <Pill tone="default">detached</Pill>}
          {wt.is_current && <Pill tone="accent">current</Pill>}
          {wt.is_main && <Pill tone="success">main</Pill>}
          {wt.main_state && wt.main_state !== "is_main" && (
            <Pill tone={mainStateTone}>{wt.main_state}</Pill>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Pill tone={dirty ? "warning" : "success"}>{dirty ? "dirty" : "clean"}</Pill>
          {!wt.is_main && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
              {onMerge && canMerge && (
                <button
                  className="rounded p-1 text-fg-subtle hover:bg-accent/15 hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMerge(wt);
                  }}
                  title={`Merge ${branchLabel} into default`}
                >
                  <GitMerge size={12} />
                </button>
              )}
              <button
                className="rounded p-1 text-fg-subtle hover:bg-danger/15 hover:text-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(wt);
                }}
                title="Remove worktree"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>
      </header>

      <p className="truncate text-xs text-fg-muted" title={wt.path ?? ""}>
        {wt.path ?? "(no path)"}
      </p>

      {wt.commit && (
        <p className="line-clamp-1 text-xs text-fg-muted">
          <GitCommit size={10} className="mr-1 inline" />
          <span className="font-mono text-fg-subtle">{wt.commit.short_sha}</span>{" "}
          <span title={wt.commit.message}>
            {wt.commit.message.split("\n")[0]?.trim() || "(empty)"}
          </span>
        </p>
      )}

      {wt.working_tree && (wt.working_tree.staged || wt.working_tree.modified || wt.working_tree.untracked) && (
        <footer className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-fg-muted">
          {wt.working_tree.staged && wt.working_tree.diff && (
            <Pill tone="success">
              +{wt.working_tree.diff.added} -{wt.working_tree.diff.deleted} staged
            </Pill>
          )}
          {wt.working_tree.modified && <Pill tone="warning">modified</Pill>}
          {wt.working_tree.untracked && <Pill tone="warning">untracked</Pill>}
        </footer>
      )}
    </Card>
  );
}

function mainStateToTone(s: string | null | undefined): "default" | "success" | "warning" | "danger" | "accent" {
  switch (s) {
    case "is_main":
    case "merged":
      return "success";
    case "diverged":
    case "behind":
      return "warning";
    case "ahead":
      return "accent";
    default:
      return "default";
  }
}
