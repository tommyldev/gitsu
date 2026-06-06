/**
 * Dashboard — the repo-open pane composition: worktree list (left),
 * then either the graph + commit panel, or the terminal strip + file
 * explorer when the graph is hidden ("compact"/terminal mode).
 * Extracted from App. Pane widths are owned by App and threaded in;
 * the worktree select/merge handlers read the stores directly.
 */

import { useRepoStore } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { useTerminalStore } from "@/stores/terminal";
import { useMergeStore } from "@/stores/merge";
import { WorktreeList } from "@/components/worktree/WorktreeList";
import { CommitGraph } from "@/components/graph/CommitGraph";
import { CommitPanel } from "@/components/commit/CommitPanel";
import { TerminalStrip } from "@/components/terminal/TerminalStrip";
import { DirectoryExplorer } from "@/components/directory/DirectoryExplorer";
import { ResizablePane } from "./ResizablePane";
import type { Worktree } from "@/lib/types";

const LEFT_PANE_MIN = 220;
const LEFT_PANE_MAX = 480;
const RIGHT_PANE_MIN = 280;
const RIGHT_PANE_MAX = 600;

export function Dashboard({
  hideWorktreeList,
  hideGraphPanel,
  hideCommitPanel,
  leftWidth,
  rightWidth,
  onLeftResize,
  onRightResize,
  onRemoveWorktree,
}: {
  hideWorktreeList: boolean;
  hideGraphPanel: boolean;
  hideCommitPanel: boolean;
  leftWidth: number;
  rightWidth: number;
  onLeftResize: (w: number) => void;
  onRightResize: (w: number) => void;
  onRemoveWorktree: (wt: Worktree) => void;
}) {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left pane: worktree list — toggleable via ⌘B. */}
      {!hideWorktreeList && (
        <ResizablePane
          width={leftWidth}
          min={LEFT_PANE_MIN}
          max={LEFT_PANE_MAX}
          onResize={onLeftResize}
          side="right"
        >
          <WorktreeList
            onRemove={onRemoveWorktree}
            onSelect={(wt) => {
              if (wt.path) {
                void useGraphStore.getState().setActive(wt.path);
                useTerminalStore.getState().setSelectedWorktree(wt.path);
              }
            }}
            onMerge={(wt) => {
              if (wt.is_main) return;
              if (!wt.branch || !wt.path) return;
              const target = useRepoStore.getState().worktrees?.default_branch ?? "main";
              useMergeStore.getState().open(wt.path, wt.branch, target);
            }}
          />
        </ResizablePane>
      )}

      {hideGraphPanel ? (
        <>
          <TerminalStrip fillsAvailable />
          {/* Right pane: directory explorer. In terminal view
              the commit panel is replaced by a file tree
              rooted at the focused terminal's CWD. The
              explorer is always visible — ⌘⌥B is not
              relevant here since the two sidebars serve
              different "modes" (graph vs terminal). */}
          <ResizablePane
            width={rightWidth}
            min={RIGHT_PANE_MIN}
            max={RIGHT_PANE_MAX}
            onResize={onRightResize}
            side="left"
          >
            <DirectoryExplorer />
          </ResizablePane>
        </>
      ) : (
        <>
          <div className="flex-1 overflow-hidden bg-bg">
            <CommitGraph />
          </div>
          {/* Right pane: commit panel — toggleable via ⌘⌥B. */}
          {!hideCommitPanel && (
            <ResizablePane
              width={rightWidth}
              min={RIGHT_PANE_MIN}
              max={RIGHT_PANE_MAX}
              onResize={onRightResize}
              side="left"
            >
              <CommitPanel />
            </ResizablePane>
          )}
        </>
      )}
    </div>
  );
}
