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
import type { CommitNode, WorkingTree } from "@/lib/types";
import type { LayoutEdge, LayoutRow } from "@/lib/dag";
import { CommitContextMenu, type CommitMenuTarget } from "./CommitContextMenu";

// ── Layout constants ───────────────────────────────────────────

const ROW_HEIGHT = 28;
const LANE_WIDTH = 16;
const GRAPH_PAD_X = 12;
const CIRCLE_R = 4;
const GRAPH_TO_LABEL_GAP = 16;
const MIN_GRAPH_WIDTH = 40;
// The working-tree pseudo-row is the same height as a commit row so
// the visual cadence matches — one "step" of head → working tree.
const WORKING_TREE_ROW_HEIGHT = 28;

const COL_LABELS = 160;
const COL_AUTHOR = 110;
const COL_DATE = 75;
const COL_MESSAGE = 240;

// Desaturated, monochrome-friendly lane palette
const LANE_COLORS = [
  "#5E6AD2", // accent (desaturated blue)
  "#6B7280", // cool gray
  "#9CA3AF", // lighter gray
  "#D1D5DB", // light gray
  "#A1A1AA", // muted gray
  "#7E82A6", // blue-gray
  "#8B8FA3", // slate
  "#787C8E", // dark slate
];

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
      <div className="flex h-full items-center justify-center text-fg-muted">
        <span className="animate-pulse text-[13px]">Loading commit graph…</span>
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
  if (!graph || !layout || layout.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted text-[13px]">
        No commits in this worktree.
      </div>
    );
  }

  // Compute the rightmost *actually used* lane so the column hugs the
  // data instead of padding out to `layout.laneCount`.
  const rightmostLane = layout.rows.reduce(
    (max, row) => Math.max(max, row.lane),
    0,
  );
  const graphWidth = Math.max(
    MIN_GRAPH_WIDTH,
    (rightmostLane + 1) * LANE_WIDTH + GRAPH_PAD_X * 2,
  );

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
    <div
      ref={containerRef}
      className="relative h-full overflow-auto bg-bg"
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
  );
}

function layoutRowIndexBySha(rows: LayoutRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) m.set(rows[i].sha, i);
  return m;
}

// ── Edge (line from a commit to a parent) ──────────────────────

function EdgeLine({
  edge,
  rowIndexBySha,
  yOffset,
}: {
  edge: LayoutEdge;
  rowIndexBySha: Map<string, number>;
  /** Shift rows down by this many px (working-tree row height). 0 = no row. */
  yOffset: number;
}) {
  const fromIndex = rowIndexBySha.get(edge.from_sha);
  if (fromIndex === undefined) return null;

  const parentIndex = rowIndexBySha.get(edge.to_sha);
  const childY = fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2 + yOffset;
  const parentY =
    parentIndex !== undefined
      ? parentIndex * ROW_HEIGHT + ROW_HEIGHT / 2 + yOffset
      : (fromIndex + 1) * ROW_HEIGHT + ROW_HEIGHT / 2 + yOffset;

  const childX = laneX(edge.from_lane);
  const parentX = laneX(edge.to_lane);

  // The edge color should match the "from" lane (the commit above).
  // This keeps the primary line an unbroken, consistent color.
  const edgeColor = LANE_COLORS[edge.from_lane % LANE_COLORS.length];

  if (childX === parentX && edge.to_known) {
    // Vertical line (same lane, known parent)
    return (
      <line
        x1={childX}
        y1={childY + CIRCLE_R}
        x2={parentX}
        y2={parentY}
        stroke={edgeColor}
        strokeWidth={1.5}
        opacity={0.65}
      />
    );
  }
  // Cubic Bezier curve
  const dy = (parentY - childY) * 0.5;
  const d = `M ${childX} ${childY + CIRCLE_R} C ${childX} ${childY + dy}, ${parentX} ${parentY - dy}, ${parentX} ${parentY}`;
  return (
    <path
      d={d}
      stroke={edgeColor}
      strokeWidth={1.5}
      fill="none"
      opacity={0.65}
    />
  );
}

// ── Track lines (vertical line through a row's lane) ───────────

function TrackLines({
  row,
  rowIndex,
  yOffset,
}: {
  row: LayoutRow;
  rowIndex: number;
  yOffset: number;
}) {
  const cx = laneX(row.lane);
  const color = LANE_COLORS[row.lane % LANE_COLORS.length];
  return (
    <line
      x1={cx}
      y1={rowIndex * ROW_HEIGHT + yOffset}
      x2={cx}
      y2={(rowIndex + 1) * ROW_HEIGHT + yOffset}
      stroke={color}
      strokeWidth={1.5}
      opacity={0.4}
    />
  );
}

// ── Single commit row ──────────────────────────────────────────

function CommitRow({
  row,
  node,
  index,
  yOffset,
  selected,
  totalWidth,
  labelX,
  authorX,
  dateX,
  messageX,
  onSelect,
  onContextMenu,
}: {
  row: LayoutRow;
  node: CommitNode;
  index: number;
  yOffset: number;
  selected: boolean;
  totalWidth: number;
  labelX: number;
  authorX: number;
  dateX: number;
  messageX: number;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const y = index * ROW_HEIGHT + yOffset;
  const cx = laneX(row.lane);
  const color = LANE_COLORS[row.lane % LANE_COLORS.length];
  const midY = y + ROW_HEIGHT / 2;

  // Label data
  const firstBranch = row.branches[0];
  const otherBranchCount = row.branches.length - 1;
  const firstTag = row.tags[0];
  const otherTagCount = row.tags.length - 1;

  let totalLabelWidth = 0;
  if (firstBranch) {
    totalLabelWidth += branchLabelWidth(firstBranch.name);
    if (otherBranchCount > 0) totalLabelWidth += 22;
    else totalLabelWidth += 4;
  }
  if (firstTag) {
    totalLabelWidth += tagLabelWidth(firstTag.name);
    if (otherTagCount > 0) totalLabelWidth += 22;
    else totalLabelWidth += 4;
  }

  return (
    <g
      style={{ cursor: "pointer" }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      {/* Row background for selection */}
      {selected && (
        <>
          <rect
            x={0}
            y={y}
            width={totalWidth}
            height={ROW_HEIGHT}
            fill="rgba(94, 106, 210, 0.06)"
          />
          {/* Subtle left accent border fading to transparent */}
          <rect
            x={0}
            y={y}
            width={2}
            height={ROW_HEIGHT}
            fill="url(#accent-fade)"
          />
        </>
      )}

      {/* Dotted connecting line from labels to node (if labels exist) */}
      {totalLabelWidth > 0 && (
        <line
          x1={labelX + totalLabelWidth}
          y1={midY}
          x2={cx - CIRCLE_R - 2}
          y2={midY}
          stroke="#6B7080"
          strokeWidth={1}
          strokeDasharray="3,3"
          opacity={0.9}
        />
      )}

      {/* Commit circle */}
      <circle
        cx={cx}
        cy={midY}
        r={CIRCLE_R + 1}
        fill={selected ? "#1A1B1D" : "#222326"}
        stroke={color}
        strokeWidth={1.5}
      />
      <circle
        cx={cx}
        cy={midY}
        r={CIRCLE_R - 0.5}
        fill={color}
      />

      {/* Branch / tag labels */}
      <g transform={`translate(${labelX}, ${midY})`}>
        {firstBranch && (
          <BranchLabel branch={firstBranch} />
        )}
        {otherBranchCount > 0 && (
          <text
            x={firstBranch ? branchLabelWidth(firstBranch.name) + 4 : 0}
            dominantBaseline="central"
            fontSize={10}
            fill="#5C616B"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
          >
            +{otherBranchCount}
          </text>
        )}
        {firstTag && (
          <TagLabel
            tag={firstTag}
            xOffset={firstBranch ? branchLabelWidth(firstBranch.name) + (otherBranchCount > 0 ? 22 : 4) : 0}
          />
        )}
        {otherTagCount > 0 && (
          <text
            x={
              (firstBranch ? branchLabelWidth(firstBranch.name) + (otherBranchCount > 0 ? 22 : 4) : 0) +
              (firstTag ? tagLabelWidth(firstTag.name) + 4 : 0)
            }
            dominantBaseline="central"
            fontSize={10}
            fill="#5C616B"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
          >
            +{otherTagCount}
          </text>
        )}
      </g>

      {/* Author column */}
      <text
        x={authorX}
        y={midY}
        dominantBaseline="central"
        fontSize={10}
        fill="#8A8F98"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {truncate(node.author_name || "?", 14)}
      </text>

      {/* Date column */}
      <text
        x={dateX}
        y={midY}
        dominantBaseline="central"
        fontSize={10}
        fill="#5C616B"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
      >
        {relativeTime(node.author_time)}
      </text>

      {/* Message column */}
      <text
        x={messageX}
        y={midY}
        dominantBaseline="central"
        fontSize={11}
        fill="#F4F5F8"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        <title>{node.summary}</title>
        {truncate(node.summary, Math.floor(COL_MESSAGE / 7))}
      </text>
    </g>
  );
}

// ── Working-tree pseudo-row (uncommitted changes) ──────────────

/**
 * Visual placeholder for the worktree's uncommitted state. Renders
 * below the head commit, in the head's lane, with a hollow ring (vs.
 * filled circles for real commits) and a `+N −M` line-count summary
 * (or a change-count fallback when libgit2 hasn't given us a diff
 * stat yet).
 *
 * Why a hollow ring? It's a common convention (Sublime Merge, Git
 * Graph extension) — the empty interior reads as "this isn't a real
 * commit yet, it's a placeholder for the next one". The dotted
 * connector and track line reinforce that the working tree is
 * "ephemeral" — present, but not part of the permanent history.
 */
function WorkingTreeRow({
  workingTree,
  lane,
  y,
  labelX,
  messageX,
}: {
  workingTree: WorkingTree;
  lane: number;
  y: number;
  labelX: number;
  messageX: number;
}) {
  const cx = laneX(lane);
  const color = LANE_COLORS[lane % LANE_COLORS.length];
  const midY = y + WORKING_TREE_ROW_HEIGHT / 2;

  // Prefer the libgit2 line-count stat (added/deleted). When the
  // caller hasn't given us a stat, fall back to counting change
  // *types* — less precise but still useful.
  const diff = workingTree.diff;
  const changeTypes =
    (workingTree.staged ? 1 : 0) +
    (workingTree.modified ? 1 : 0) +
    (workingTree.untracked ? 1 : 0) +
    (workingTree.renamed ? 1 : 0) +
    (workingTree.deleted ? 1 : 0);
  let summary: string;
  let title: string;
  if (diff && (diff.added > 0 || diff.deleted > 0)) {
    summary = `+${diff.added}  −${diff.deleted}`;
    title = `${diff.added} lines added, ${diff.deleted} lines deleted (working tree)`;
  } else {
    summary = `${changeTypes} change${changeTypes === 1 ? "" : "s"}`;
    title = `${changeTypes} uncommitted file change${changeTypes === 1 ? "" : "s"} in this worktree`;
  }

  // Match the branch-label width formula so the visual cadence
  // (left labels, then node circle, then right text) is consistent.
  const labelText = "Working tree";
  const labelW = Math.max(48, labelText.length * 6.2 + 16);

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* Selection-style row background is intentionally omitted —
          the working-tree row isn't selectable in v1. */}
      {/* Dotted connector from label column to node (mirrors the
          style used by real branches but uses a neutral stroke so it
          doesn't compete with the lane color). */}
      <line
        x1={labelX + labelW}
        y1={midY}
        x2={cx - CIRCLE_R - 2}
        y2={midY}
        stroke="#6B7080"
        strokeWidth={1}
        strokeDasharray="3,3"
        opacity={0.9}
      />

      {/* Hollow ring with a tiny inner dot — the "in-progress" cue. */}
      <circle
        cx={cx}
        cy={midY}
        r={CIRCLE_R + 1}
        fill="#1A1B1D"
        stroke={color}
        strokeWidth={1.5}
      />
      <circle cx={cx} cy={midY} r={1.2} fill={color} />

      {/* Label pill — uses a neutral muted style so it doesn't get
          confused with a real local branch. */}
      <g transform={`translate(${labelX}, ${midY})`}>
        <rect
          x={0}
          y={-8}
          width={labelW}
          height={16}
          rx={3}
          fill="rgba(255, 255, 255, 0.04)"
          style={{
            stroke: "rgba(255, 255, 255, 0.08)",
            strokeWidth: 1,
            strokeDasharray: "2,2",
          }}
        />
        <text
          x={8}
          y={0}
          dominantBaseline="central"
          fontSize={10}
          fontFamily="ui-monospace, SFMono-Regular, monospace"
          fill="#8A8F98"
        >
          <title>Uncommitted changes in this worktree</title>
          {labelText}
        </text>
      </g>

      {/* Summary on the right — line counts when available, otherwise
          a count of change types. Both are mono + muted so the eye
          can scan them quickly without competing with branch labels. */}
      <text
        x={messageX}
        y={midY}
        dominantBaseline="central"
        fontSize={11}
        fill="#A1A1AA"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
      >
        <title>{title}</title>
        {summary}
      </text>
    </g>
  );
}

function BranchLabel({ branch }: { branch: { name: string; is_local: boolean } }) {
  const display = truncate(branch.name, 14);
  const w = branchLabelWidth(branch.name);
  return (
    <g>
      <rect
        x={0}
        y={-8}
        width={w}
        height={16}
        rx={3}
        fill={branch.is_local ? "rgba(94, 106, 210, 0.15)" : "rgba(80, 90, 110, 0.25)"}
        style={{
          stroke: branch.is_local ? "rgba(94, 106, 210, 0.22)" : "rgba(255, 255, 255, 0.06)",
          strokeWidth: 1,
        }}
      />
      <text
        x={8}
        y={0}
        dominantBaseline="central"
        fontSize={10}
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fill={branch.is_local ? "#8A8F98" : "#6B7280"}
      >
        {display}
      </text>
    </g>
  );
}

function TagLabel({ tag, xOffset }: { tag: { name: string; is_annotated: boolean }; xOffset: number }) {
  const display = truncate(tag.name, 10);
  const w = tagLabelWidth(tag.name);
  return (
    <g transform={`translate(${xOffset}, 0)`}>
      <rect
        x={0}
        y={-8}
        width={w}
        height={16}
        rx={3}
        fill="rgba(120, 124, 142, 0.15)"
        style={{
          stroke: "rgba(255, 255, 255, 0.06)",
          strokeWidth: 1,
        }}
      />
      <text
        x={8}
        y={0}
        dominantBaseline="central"
        fontSize={10}
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fill="#8A8F98"
      >
        <tspan>{display}</tspan>
        {tag.is_annotated && <tspan dx={2} fill="#6B7280">*</tspan>}
      </text>
    </g>
  );
}

function branchLabelWidth(name: string): number {
  const display = truncate(name, 14);
  return Math.max(40, display.length * 6.2 + 16);
}

function tagLabelWidth(name: string): number {
  const display = truncate(name, 10);
  return Math.max(36, display.length * 6.2 + 16);
}

// ── Geometry helpers ───────────────────────────────────────────

function laneX(lane: number): number {
  return COL_LABELS + GRAPH_PAD_X + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function relativeTime(unixSecs: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - unixSecs));
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  if (diff < 86400 * 365)
    return new Date(unixSecs * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
  });
}
