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
 * "working tree" pseudo-row is rendered immediately below the head
 * commit: a hollow ring, a dotted connector up to HEAD, a dotted track
 * line through the row, and a "+N −M" summary. The rest of the graph
 * is shifted down by one row height. This matches the convention in
 * Sublime Merge / GitHub Desktop / VS Code's Git Graph extension.
 *
 * The component is intentionally un-virtualized for v1. At 500
 * commits × 28px = 14,000px, modern browsers handle the SVG without
 * dropping frames. We can add windowed rendering in M2.5 if needed.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useGraphStore } from "@/stores/graph";
import { useRepoStore } from "@/stores/repo";
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
} from "./graph-geometry";

export function CommitGraph() {
  const { graph, layout, loading, error, selectedSha, select, fetchedFor, activePath } = useGraphStore();
  // We subscribe to the whole worktree list here so the working-tree
  // row updates as the 3s poll brings fresh `working_tree` data.
  // The re-render is cheap — the SVG only re-runs the diff for the
  // one row that changed.
  const worktrees = useRepoStore((s) => s.worktrees);
  const [menu, setMenu] = useState<CommitMenuTarget | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrolledFor = useRef<string | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  // Compute the working-tree state for the *active* worktree (the
  // one the graph was fetched for). We look it up by path because the
  // worktree list and the graph are addressed separately. If the
  // active worktree isn't in the list yet (e.g. graph loaded first
  // after a worktree switch), we just don't show the working-tree row
  // until the next poll lands.
  const activeWorktree = worktrees?.items.find((w) => w.path === activePath);
  const workingTree = activeWorktree?.working_tree ?? null;
  const hasUncommitted = !!workingTree && (
    workingTree.staged ||
    workingTree.modified ||
    workingTree.untracked ||
    workingTree.renamed ||
    workingTree.deleted
  );
  // When the working-tree row is visible, the rest of the graph shifts
  // down by one row so the head commit stays anchored at the same
  // scroll position.
  const yOffset = hasUncommitted ? WORKING_TREE_ROW_HEIGHT : 0;

  useEffect(() => {
    if (!layout || !graph || !containerRef.current) return;
    if (fetchedFor === lastScrolledFor.current) return;

    const targetSha = graph.head_sha || selectedSha;
    if (!targetSha) return;

    const rowIndex = layout.rows.findIndex((r) => r.sha === targetSha);
    if (rowIndex >= 0) {
      const y = rowIndex * ROW_HEIGHT + yOffset;
      const container = containerRef.current;
      const halfHeight = container.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, y - halfHeight + ROW_HEIGHT / 2),
        behavior: "smooth",
      });
      lastScrolledFor.current = fetchedFor;
    }
  }, [fetchedFor, layout, graph, selectedSha, yOffset]);

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
  // data instead of padding out to `layout.laneCount`.
  const rightmostLane = layout.rows.reduce((max, row) => Math.max(max, row.lane), 0);
  const graphWidth = Math.max(MIN_GRAPH_WIDTH, (rightmostLane + 1) * LANE_WIDTH + GRAPH_PAD_X * 2);

  // Column positions (absolute x coordinates)
  const labelX = 8; // small left padding
  const authorX = COL_LABELS + graphWidth + GRAPH_TO_LABEL_GAP;
  const dateX = authorX + COL_AUTHOR;
  const messageX = dateX + COL_DATE;
  const totalWidth = messageX + COL_MESSAGE;
  const totalHeight = layout.rows.length * ROW_HEIGHT + 8 + yOffset;
  // The head commit is always layout.rows[0] (newest first). Its lane
  // is where the working-tree node lives, so the dotted connector is
  // a straight vertical line.
  const headLane = layout.rows[0]?.lane ?? 0;
  const headColor = LANE_COLORS[headLane % LANE_COLORS.length];

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
                yOffset={yOffset}
              />
            ))}
            {/* Dotted connector from head commit down to the working-tree
                node. Rendered with the edges so the head's solid circle
                sits on top of it. */}
            {hasUncommitted && workingTree && (
              <line
                x1={laneX(headLane)}
                y1={yOffset - WORKING_TREE_ROW_HEIGHT / 2}
                x2={laneX(headLane)}
                y2={yOffset + ROW_HEIGHT / 2}
                stroke={headColor}
                strokeWidth={1.5}
                strokeDasharray="3,3"
                opacity={0.55}
              />
            )}
          </g>

          {/* Track lines (vertical lines through rows where no commit sits
              but a line is still passing through). Drawn before circles. */}
          <g>
            {layout.rows.map((row, i) => (
              <TrackLines key={`t-${row.sha}`} row={row} rowIndex={i} yOffset={yOffset} />
            ))}
            {/* Dotted track line through the working-tree row. Same
                visual language as the connector — emphasizes that the
                working tree is "on the way" to a future commit. */}
            {hasUncommitted && (
              <line
                x1={laneX(headLane)}
                y1={0}
                x2={laneX(headLane)}
                y2={WORKING_TREE_ROW_HEIGHT}
                stroke={headColor}
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
                  yOffset={yOffset}
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
              on top of the connector. The row is a "preview" of the next
              commit; not clickable in v1 (future: select HEAD and show
              workdir_diff in the right pane). */}
          {hasUncommitted && workingTree && (
            <WorkingTreeRow
              workingTree={workingTree}
              lane={headLane}
              y={0}
              labelX={labelX}
              messageX={messageX}
            />
          )}
        </svg>

        {menu && <CommitContextMenu target={menu} onClose={closeMenu} />}
      </div>
    </div>
  );
}
