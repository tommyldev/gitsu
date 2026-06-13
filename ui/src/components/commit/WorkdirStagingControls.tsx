/**
 * Staging affordances for the CommitPanel's "Working tree" mode.
 *
 * - `WorkdirStagingBar` — header strip with staged/unstaged counts
 *   and Stage all / Unstage all actions.
 * - `StageFileButton` — per-row toggle rendered at the right edge of
 *   each file in the diff list.
 *
 * Both read the same staging store as the left-pane CommitComposer
 * and the graph's pending node, so staging from here fills the node
 * and updates the composer too. Committing happens in the composer
 * (left pane) — the bar links the two.
 */

import { Plus, Check } from "lucide-react";
import { useStagingStore } from "@/stores/staging";

export function WorkdirStagingBar() {
  const entries = useStagingStore((s) => s.entries);
  const committing = useStagingStore((s) => s.committing);
  const stagedCount = entries.filter((e) => e.staged !== null).length;
  const unstagedCount = entries.filter((e) => e.unstaged !== null).length;
  const { stageAll, unstageAll } = useStagingStore.getState();

  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2">
      <div className="min-w-0">
        <span className="text-[13px] font-medium text-fg">Uncommitted changes</span>
        <p className="truncate text-[11px] text-fg-muted">
          {stagedCount} staged · {unstagedCount} unstaged — commit from the Changes
          panel on the left.
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <button
          className="btn-ghost px-2 py-1 text-[11px]"
          disabled={unstagedCount === 0 || committing}
          onClick={() => void stageAll()}
        >
          Stage all
        </button>
        <button
          className="btn-ghost px-2 py-1 text-[11px]"
          disabled={stagedCount === 0 || committing}
          onClick={() => void unstageAll()}
        >
          Unstage all
        </button>
      </div>
    </div>
  );
}

/** Stage/unstage toggle for one path. `+` while anything is
 *  unstaged; a green check (click to unstage) once fully staged. */
export function StageFileButton({ path }: { path: string }) {
  const entry = useStagingStore((s) => s.entries.find((e) => e.path === path));
  const committing = useStagingStore((s) => s.committing);
  if (!entry) return null;

  const { stage, unstage } = useStagingStore.getState();
  const fullyStaged = entry.staged !== null && entry.unstaged === null;

  return (
    <button
      className="mr-2 shrink-0 rounded p-1 transition-colors duration-150 hover:bg-white/[0.08]"
      disabled={committing}
      onClick={(e) => {
        e.stopPropagation();
        void (fullyStaged ? unstage(path) : stage(path));
      }}
      title={fullyStaged ? `Staged — click to unstage ${path}` : `Stage ${path}`}
      aria-label={fullyStaged ? `Unstage ${path}` : `Stage ${path}`}
    >
      {fullyStaged ? (
        <Check size={13} className="text-success" strokeWidth={2} />
      ) : (
        <Plus size={13} className="text-fg-muted hover:text-fg" strokeWidth={1.5} />
      )}
    </button>
  );
}
