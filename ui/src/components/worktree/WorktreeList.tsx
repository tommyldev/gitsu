/**
 * Worktree list — the centerpiece of gitsu's M1 dashboard.
 *
 * Lists worktrees from `useRepoStore.worktrees` as rows. Each row
 * shows branch, status counts, ahead/behind, agent session, and
 * quick actions. Selecting a worktree is a no-op in M1 (the
 * commit-graph + diff viewer come in M2-M3); the row is informational
 * + the source of "current worktree" for downstream views.
 */

import { useMemo } from "react";
import clsx from "clsx";
import { Folder, AlertCircle, GitCommit, Trash2, GitMerge } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { Pill } from "@/components/ui/primitives";
import { displayBranch, isDetached, sortWorktrees } from "@/lib/worktree";
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
  const activePath = useGraphStore((s) => s.activePath);
  const sorted = useMemo(
    () => sortWorktrees(worktrees?.items ?? []),
    [worktrees],
  );

  if (!repo) return null;

  if (loading && !worktrees) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        <span className="animate-pulse text-[13px]">Loading worktrees…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger/10 p-3 text-[13px] text-danger">
        <AlertCircle size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
        <span>{error}</span>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-muted">
        <Folder size={32} className="opacity-50" strokeWidth={1.5} />
        <p className="text-[13px]">No worktrees found for this repository.</p>
        <p className="text-[11px]">
          Use <kbd className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px]">⌘N</kbd> to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Worktrees
        </h2>
        <span className="text-[11px] text-fg-muted">{sorted.length}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {sorted.map((wt, i) => (
          <WorktreeRow
            key={wt.path ?? `wt-${i}`}
            wt={wt}
            shortcutIndex={i + 1}
            isActive={!!wt.path && wt.path === activePath}
            onRemove={onRemove}
            onSelect={onSelect}
            onMerge={onMerge}
          />
        ))}
      </div>
    </div>
  );
}

function WorktreeRow({
  wt,
  shortcutIndex,
  isActive,
  onRemove,
  onSelect,
  onMerge,
}: {
  wt: Worktree;
  shortcutIndex: number;
  isActive: boolean;
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
  // ⌘/Ctrl + digit shortcut only valid for the first 9 rows. The
  // badge still renders for the 10th+ as a dimmed "—" so the layout
  // doesn't shift when worktrees are added/removed.
  const hasShortcut = shortcutIndex >= 1 && shortcutIndex <= 9;
  const shortcutLabel = hasShortcut ? String(shortcutIndex) : "·";

  return (
    <div
      onClick={() => onSelect?.(wt)}
      className={clsx(
        "group relative flex cursor-pointer items-stretch border-b border-white/[0.04] py-3 transition-all duration-150 ease-standard",
        isActive
          ? "bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] before:bg-accent before:shadow-[0_0_6px_rgba(94,106,210,0.25)]"
          : "hover:bg-white/[0.03] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] before:bg-transparent",
      )}
      title={hasShortcut ? `Switch to ${branchLabel} (⌘${shortcutIndex})` : branchLabel}
    >
      {/* Keyboard shortcut hint — fixed left rail, matches the
          Cmd/Ctrl + digit binding in App.tsx. */}
      <span
        aria-hidden
        className={clsx(
          "flex w-7 shrink-0 select-none items-center justify-center text-[10px] font-mono tabular-nums",
          hasShortcut ? "text-fg-muted" : "text-fg-muted/30",
        )}
      >
        {hasShortcut ? `⌘${shortcutLabel}` : "·"}
      </span>
      <div className="min-w-0 flex-1 pr-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Branch indicator dot */}
          <div
            className={clsx(
              "h-[6px] w-[6px] shrink-0 rounded-full",
              detached ? "bg-fg-muted" : "bg-accent",
            )}
          />
          <span
            className="truncate font-mono text-[13px] font-medium text-fg"
            title={branchLabel}
          >
            {branchLabel}
          </span>
          {detached && <Pill tone="default">detached</Pill>}
          {wt.is_current && <Pill tone="accent">current</Pill>}
          {wt.is_main && <Pill tone="success">main</Pill>}
          {wt.main_state && wt.main_state !== "is_main" && (
            <Pill tone={mainStateTone}>{wt.main_state}</Pill>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Pill tone={dirty ? "warning" : "success"}>{dirty ? "dirty" : "clean"}</Pill>
          {!wt.is_main && (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {onMerge && canMerge && (
                <button
                  className="rounded p-1 text-fg-muted transition-colors duration-150 hover:bg-white/[0.04] hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMerge(wt);
                  }}
                  title={`Merge ${branchLabel} into default`}
                >
                  <GitMerge size={12} strokeWidth={1.5} />
                </button>
              )}
              <button
                className="rounded p-1 text-fg-muted transition-colors duration-150 hover:bg-white/[0.04] hover:text-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(wt);
                }}
                title="Remove worktree"
              >
                <Trash2 size={12} strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="mt-1 truncate text-[11px] text-fg-muted" title={wt.path ?? ""}>
        {wt.path ?? "(no path)"}
      </p>

      {wt.commit && (
        <p className="mt-1 line-clamp-1 text-[11px] text-fg-muted">
          <GitCommit size={10} className="mr-1 inline" strokeWidth={1.5} />
          <span className="font-mono text-fg-muted">{wt.commit.short_sha}</span>{" "}
          <span title={wt.commit.message}>
            {wt.commit.message.split("\n")[0]?.trim() || "(empty)"}
          </span>
        </p>
      )}

      {wt.working_tree && (wt.working_tree.staged || wt.working_tree.modified || wt.working_tree.untracked) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {wt.working_tree.staged && wt.working_tree.diff && (
            <Pill tone="success">
              +{wt.working_tree.diff.added} -{wt.working_tree.diff.deleted} staged
            </Pill>
          )}
          {wt.working_tree.modified && <Pill tone="warning">modified</Pill>}
          {wt.working_tree.untracked && <Pill tone="warning">untracked</Pill>}
        </div>
      )}
      </div>
    </div>
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
