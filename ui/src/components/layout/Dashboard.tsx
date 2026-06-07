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
import { useFileViewerStore } from "@/stores/fileViewer";
import { WorktreeList } from "@/components/worktree/WorktreeList";
import { CommitGraph } from "@/components/graph/CommitGraph";
import { CommitPanel } from "@/components/commit/CommitPanel";
import { FileFocus } from "@/components/commit/FileFocus";
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
  const activeFile = useFileViewerStore((s) => s.file);
  const fileRepo = useFileViewerStore((s) => s.repo);
  const fileCommitSha = useFileViewerStore((s) => s.commitSha);
  const closeFile = useFileViewerStore((s) => s.close);

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

      {/* Right area: main content stacked above the terminal strip.
          The flex-col wrapper keeps the terminal always mounted —
          in graph mode it sits at the bottom as a fixed-height
          panel, and in terminal mode it fills the available
          vertical space. This avoids the mount/unmount cycle that
          was destroying xterm instances and losing scrollback when
          the user toggled between views. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top section: either the terminal (filling available) +
            directory explorer, or the commit graph + commit panel. */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
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
                {activeFile ? (
                  <FileFocus
                    file={activeFile}
                    repo={fileRepo}
                    commitSha={fileCommitSha}
                    onBack={closeFile}
                  />
                ) : (
                  <CommitGraph />
                )}
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

        {/* Bottom section: terminal strip — only rendered in graph
            mode as a fixed-height panel. In terminal mode the
            terminal is already in the top section (fillsAvailable),
            so we skip it here to avoid a double render. */}
        {!hideGraphPanel && <TerminalStrip fillsAvailable={false} />}
      </div>
    </div>
  );
}
