/**
 * CommitGraph — the centerpiece of M2.
 *
 * Renders a DAG of commits as a scrollable SVG:
 * - Each row is 28px tall
 * - Each lane is 12px wide
 * - Vertical track lines connect commits in the same lane
 * - Cubic-Bezier edges curve between different lanes
 * - Commit circle is filled (colored by SHA) with author avatar
 * - Branch + tag labels appear on the left of the graph column
 * - Author / date / message columns follow to the right of the graph
 *
 * When the active worktree has uncommitted changes (`Worktree.working_tree`
 * with any of staged/modified/untracked/renamed/deleted set), a
 * "working tree" pseudo-row is rendered immediately above the HEAD
 * commit: a hollow ring, a dotted connector down to HEAD, a dotted track
 * line through the row, and a "+N −M" summary. Rows at or below HEAD
 * shift down by one row height to accommodate it. Rows above HEAD are
 * unaffected. This matches the convention in Sublime Merge / GitHub
 * Desktop / VS Code's Git Graph extension.
 *
 * When HEAD is the newest commit (row 0), the pending node appears at
 * the top of the graph. When HEAD is an older commit (e.g. detached
 * HEAD at n-5), the pending node sprouts from n-5's position.
 *
 * The component is intentionally un-virtualized for v1. At 500
 * commits × 28px = 14,000px, modern browsers handle the SVG without
 * dropping frames. We can add windowed rendering in M2.5 if needed.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useGraphStore } from "@/stores/graph";
import { useStagingStore, stagedRatio } from "@/stores/staging";
import { useStagingSync } from "@/hooks/useStagingSync";
import { AlertCircle } from "lucide-react";
import { CommitContextMenu, type CommitMenuTarget } from "./CommitContextMenu";
import { GitActionsBar } from "./GitActionsBar";
import { EdgeLine, TrackLines } from "./GraphEdges";
import { CommitRow } from "./CommitRow";
import { WorkingTreeRow } from "./WorkingTreeRow";
import {
  ROW_HEIGHT,
  LANE_COLORS,
  LANE_WIDTH,
  MIN_GRAPH_WIDTH,
  GRAPH_TO_LABEL_GAP,
  GRAPH_PAD_X,
  COL_LABELS,
  COL_AUTHOR,
  COL_DATE,
  COL_MESSAGE,
  WORKING_TREE_ROW_HEIGHT,
  laneX,
  layoutRowIndexBySha,
  rowY,
  pendingRowY,
} from "./graph-geometry";

export function CommitGraph() {
  const { graph, layout, loading, error, selectedSha, select, fetchedFor } = useGraphStore();
  const [menu, setMenu] = useState<CommitMenuTarget | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrolledFor = useRef<string | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  // Keep the staging store in sync with the active worktree — the
  // pending node's fill tracks composer staging progress live.
  const { workingTree, hasUncommitted } = useStagingSync();
  const stagingEntries = useStagingStore((s) => s.entries);

  // Find the row index of the worktree's HEAD commit so the pending
  // node sprouts from the correct position (not always row 0).
  const headRowIndex = graph && layout
    ? layout.rows.findIndex((r) => r.sha === graph.head_sha)
    : -1;
  // The lane the HEAD commit occupies.
  const headLane = headRowIndex >= 0
    ? layout!.rows[headRowIndex].lane
    : (layout?.rows[0]?.lane ?? 0);
  const headColor = LANE_COLORS[headLane % LANE_COLORS.length];

  // When HEAD is at row 0 (newest commit), the pending node can
  // share HEAD's lane — nothing is above it, so no visual confusion.
  // When HEAD is NOT at row 0 (e.g. detached HEAD at n-5), the
  // pending node must go on a NEW lane so it doesn't visually
  // connect to the commits above HEAD. It forks from HEAD with a
  // dotted Bezier curve, like a real branch would.
  // Use headLane + 1 to keep the fork tight (right next to the
  // main branch) rather than jumping to a far-away lane.
  const isFork = headRowIndex > 0;
  const pendingLane = isFork ? headLane + 1 : headLane;
  const pendingColor = LANE_COLORS[pendingLane % LANE_COLORS.length];

  useEffect(() => {
    if (!layout || !graph || !containerRef.current) return;
    if (fetchedFor === lastScrolledFor.current) return;

    const targetSha = graph.head_sha || selectedSha;
    if (!targetSha) return;

    const rowIndex = layout.rows.findIndex((r) => r.sha === targetSha);
    if (rowIndex >= 0) {
      const y = rowY(rowIndex, headRowIndex, hasUncommitted);
      const container = containerRef.current;
      const halfHeight = container.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, y - halfHeight + ROW_HEIGHT / 2),
        behavior: "smooth",
      });
      lastScrolledFor.current = fetchedFor;
    }
  }, [fetchedFor, layout, graph, selectedSha, headRowIndex, hasUncommitted]);

  if (loading && !graph) {
    return (
      <div className="flex h-full flex-col">
        <GitActionsBar />
        <div className="flex flex-1 items-center justify-center text-fg-muted">
          <span className="animate-pulse text-[13px]">Loading commit graph…</span>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col">
        <GitActionsBar />
        <div className="m-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger/10 p-3 text-[13px] text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
          <span>{error}</span>
        </div>
      </div>
    );
  }
  if (!graph || !layout || layout.rows.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <GitActionsBar />
        <div className="flex flex-1 items-center justify-center text-fg-muted text-[13px]">
          No commits in this worktree.
        </div>
      </div>
    );
  }

  // Compute the rightmost *actually used* lane so the column hugs the
  // data instead of padding out to `layout.laneCount`. When the
  // pending node is on a fork lane, include it in the width calc.
  const rightmostLane = layout.rows.reduce((max, row) => Math.max(max, row.lane), 0);
  const effectiveMaxLane = hasUncommitted ? Math.max(rightmostLane, pendingLane) : rightmostLane;
  const graphWidth = Math.max(MIN_GRAPH_WIDTH, (effectiveMaxLane + 1) * LANE_WIDTH + GRAPH_PAD_X * 2);

  // Column positions (absolute x coordinates)
  const labelX = 8; // small left padding
  const authorX = COL_LABELS + graphWidth + GRAPH_TO_LABEL_GAP;
  const dateX = authorX + COL_AUTHOR;
  const messageX = dateX + COL_DATE;
  const totalWidth = messageX + COL_MESSAGE;
  // Total height includes the working-tree row when present.
  const totalHeight = layout.rows.length * ROW_HEIGHT + 8 + (hasUncommitted ? WORKING_TREE_ROW_HEIGHT : 0);

  // Y position of the pending node — sits right above HEAD.
  const pendingY = pendingRowY(headRowIndex);
  // Y position of the HEAD commit's midpoint (for the connector).
  const headRowY = rowY(headRowIndex >= 0 ? headRowIndex : 0, headRowIndex, hasUncommitted);
  const headMidY = headRowY + ROW_HEIGHT / 2;
  const pendingMidY = pendingY + WORKING_TREE_ROW_HEIGHT / 2;

  return (
    <div className="flex h-full flex-col">
      <GitActionsBar />
      <div
        ref={containerRef}
        className="relative flex-1 overflow-auto bg-bg"
        onClick={closeMenu}
      >
        <svg
          width={totalWidth}
          height={totalHeight}
          viewBox={`0 0 ${totalWidth} ${totalHeight}`}
          style={{ display: "block" }}
        >
          <defs>
            <linearGradient id="accent-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(94,106,210,0.6)" />
              <stop offset="100%" stopColor="rgba(94,106,210,0)" />
            </linearGradient>
          </defs>
          {/* Edges first (so circles sit on top of them) */}
          <g>
            {layout.edges.map((edge, i) => (
              <EdgeLine
                key={`e-${i}-${edge.from_sha}-${edge.to_sha}`}
                edge={edge}
                rowIndexBySha={layoutRowIndexBySha(layout.rows)}
                headRowIndex={headRowIndex}
                hasPending={hasUncommitted}
              />
            ))}
            {/* Dotted connector from the working-tree node to the HEAD
                commit. When HEAD is at row 0, it's a straight vertical
                line (pending node is above HEAD in the same lane).
                When HEAD is at row N > 0 (fork scenario), it's a
                dotted Bezier curve from the pending lane to HEAD's
                lane — visually this is a branch fork from HEAD. */}
            {hasUncommitted && workingTree && !isFork && (
              <line
                x1={laneX(headLane)}
                y1={pendingMidY}
                x2={laneX(headLane)}
                y2={headMidY}
                stroke={headColor}
                strokeWidth={1.5}
                strokeDasharray="3,3"
                opacity={0.55}
              />
            )}
            {hasUncommitted && workingTree && isFork && (
              <path
                d={`M ${laneX(pendingLane)} ${pendingMidY} C ${laneX(pendingLane)} ${pendingMidY + (headMidY - pendingMidY) * 0.5}, ${laneX(headLane)} ${headMidY - (headMidY - pendingMidY) * 0.5}, ${laneX(headLane)} ${headMidY}`}
                stroke={pendingColor}
                strokeWidth={1.5}
                fill="none"
                strokeDasharray="3,3"
                opacity={0.55}
              />
            )}
          </g>

          {/* Track lines (vertical lines through rows where no commit sits
              but a line is still passing through). Drawn before circles. */}
          <g>
            {layout.rows.map((row, i) => (
              <TrackLines
                key={`t-${row.sha}`}
                row={row}
                rowIndex={i}
                headRowIndex={headRowIndex}
                hasPending={hasUncommitted}
              />
            ))}
            {/* Dotted track line through the working-tree row, in the
                pending node's lane. Only spans the pending row itself
                — no track line above it (it's a fresh branch). */}
            {hasUncommitted && (
              <line
                x1={laneX(pendingLane)}
                y1={pendingY}
                x2={laneX(pendingLane)}
                y2={pendingY + WORKING_TREE_ROW_HEIGHT}
                stroke={pendingColor}
                strokeWidth={1.5}
                strokeDasharray="3,3"
                opacity={0.4}
              />
            )}
          </g>

          {/* Commit circles + label columns */}
          <g>
            {layout.rows.map((row, i) => {
              const node = graph.nodes.find((n) => n.sha === row.sha);
              if (!node) return null;
              return (
                <CommitRow
                  key={row.sha}
                  row={row}
                  node={node}
                  index={i}
                  headRowIndex={headRowIndex}
                  hasPending={hasUncommitted}
                  selected={selectedSha === row.sha}
                  totalWidth={totalWidth}
                  labelX={labelX}
                  authorX={authorX}
                  dateX={dateX}
                  messageX={messageX}
                  onSelect={() => select(row.sha)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    select(row.sha);
                    setMenu({
                      sha: row.sha,
                      shortSha: row.sha.slice(0, 7),
                      summary: node.summary,
                      branches: row.branches,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                />
              );
            })}
          </g>

          {/* Working-tree pseudo-row. Drawn last so its hollow circle sits
              on top of the connector. When HEAD is at row 0, it's in the
              HEAD's lane (vertical continuation). When HEAD is at row N > 0,
              it forks onto its own lane with nothing above it. */}
          {hasUncommitted && workingTree && (
            <WorkingTreeRow
              workingTree={workingTree}
              lane={pendingLane}
              y={pendingY}
              labelX={labelX}
              messageX={messageX}
              totalWidth={totalWidth}
              stagedRatio={stagedRatio(stagingEntries)}
              onClick={() => useStagingStore.getState().requestWorkdir()}
            />
          )}
        </svg>

        {menu && <CommitContextMenu target={menu} onClose={closeMenu} />}
      </div>
    </div>
  );
}
