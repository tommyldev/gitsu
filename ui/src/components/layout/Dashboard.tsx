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
import { CommitComposer } from "@/components/commit/CommitComposer";
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
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1">
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
            </div>
          </div>
        </ResizablePane>
      )}

      {/* Right area: graph content stacked above the terminal strip.
          Both are always rendered — we use `display: none` rather
          than conditional rendering to hide the graph content in
          terminal mode. This keeps the TerminalStrip as a SINGLE
          React element that never unmounts, which is critical for
          CLI tools with TUIs (opencode, agent harnesses, etc.) that
          maintain internal state inside the xterm instance. The
          serialize/restore cycle works for plain text scrollback,
          but TUI state (curses buffers, alternate screen, etc.)
          cannot survive an unmount. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Graph content — hidden in terminal mode via display:none.
            The flex-basis is 0% when hidden, 100% when visible, so
            the flex container's space allocation is correct. */}
        <div
          className="flex overflow-hidden"
          style={{
            display: hideGraphPanel ? "none" : "flex",
            flex: hideGraphPanel ? "0 0 0%" : "1 1 0%",
          }}
        >
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
          {/* Right pane: staging / commit composer — toggleable via ⌘⌥B. */}
          {!hideCommitPanel && (
            <ResizablePane
              width={rightWidth}
              min={RIGHT_PANE_MIN}
              max={RIGHT_PANE_MAX}
              onResize={onRightResize}
              side="left"
            >
              <CommitComposer />
            </ResizablePane>
          )}
        </div>

        {/* Terminal + optional directory explorer — hidden entirely
            in graph mode (per design: graph view is graph + commit
            panel only; the terminal lives in "compact" / terminal
            mode toggled by Hide graph). We use `display: none`
            rather than conditional rendering so the TerminalStrip
            (and its live xterm instances) stay mounted across the
            mode switch — the same trade-off the graph subtree
            makes above, and the same reason the file viewer's
            `activeFile` state survives. TUI apps inside the
            terminal (opencode, agent harnesses, etc.) keep their
            alternate-screen / cursor state when the user toggles
            back. */}
        <div
          className="flex overflow-hidden"
          style={{
            display: hideGraphPanel ? "flex" : "none",
            flex: hideGraphPanel ? "1 1 0%" : "0 0 0%",
          }}
        >
          <TerminalStrip fillsAvailable={hideGraphPanel} />
          {/* The right pane is mode-aware: in graph mode it's the
              commit panel (controlled by `hideCommitPanel`), in
              terminal mode it's the file explorer (also controlled
              by `hideCommitPanel`, so the right toggle in the
              Header — and its ⌘⌥B hotkey — toggles whichever is
              currently shown). This is what the Header's right-
              toggle title already implies (see Header.tsx). */}
          {hideGraphPanel ? (
            !hideCommitPanel && (
              <ResizablePane
                width={rightWidth}
                min={RIGHT_PANE_MIN}
                max={RIGHT_PANE_MAX}
                onResize={onRightResize}
                side="left"
              >
                <DirectoryExplorer />
              </ResizablePane>
            )
          ) : (
            !hideCommitPanel && (
              <ResizablePane
                width={rightWidth}
                min={RIGHT_PANE_MIN}
                max={RIGHT_PANE_MAX}
                onResize={onRightResize}
                side="left"
              >
                <CommitPanel />
              </ResizablePane>
            )
          )}
        </div>
      </div>
    </div>
  );
}
