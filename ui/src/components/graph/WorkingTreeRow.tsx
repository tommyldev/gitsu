/**
 * Working-tree pseudo-row (uncommitted changes) for the commit graph.
 *
 * The pending node for the worktree's *next* commit. Renders below
 * the head commit, in the head's lane, with a dashed hollow ring (vs.
 * filled circles for real commits) and a `+N −M` line-count summary.
 *
 * The ring's interior fills with the lane color as the user stages
 * files in the commit composer (`stagedRatio` 0 → 1); at 1 the dash
 * becomes a solid stroke — "ready to commit". Committing replaces
 * this row with the real (solid) head commit on the next graph fetch.
 *
 * Clicking anywhere in the row focuses the composer's message box.
 */

import type { WorkingTree } from "@/lib/types";
import { LANE_COLORS, CIRCLE_R, laneX, WORKING_TREE_ROW_HEIGHT } from "./graph-geometry";

export function WorkingTreeRow({
  workingTree,
  lane,
  y,
  labelX,
  messageX,
  totalWidth,
  stagedRatio,
  onClick,
}: {
  workingTree: WorkingTree;
  lane: number;
  y: number;
  labelX: number;
  messageX: number;
  totalWidth: number;
  /** Fraction (0–1) of changed paths that are fully staged. */
  stagedRatio: number;
  onClick: () => void;
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
  const ratio = Math.min(1, Math.max(0, stagedRatio));

  return (
    <g onClick={onClick} style={{ cursor: "pointer" }}>
      {/* Row-wide hit target so the whole row is clickable, not just
          the tiny ring. */}
      <rect
        x={0}
        y={y}
        width={totalWidth}
        height={WORKING_TREE_ROW_HEIGHT}
        fill="transparent"
      >
        <title>Click to write a commit message</title>
      </rect>
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

      {/* Pending ring — dashed while changes are unstaged; the inner
          disc grows with staging progress and the stroke turns solid
          at 100% staged ("ready to commit"). */}
      <circle
        cx={cx}
        cy={midY}
        r={CIRCLE_R + 1}
        fill="#101113"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={ratio >= 1 ? undefined : "2,2"}
      />
      {ratio > 0 && (
        <circle
          cx={cx}
          cy={midY}
          r={Math.max(1, (CIRCLE_R - 0.5) * ratio)}
          fill={color}
          style={{ transition: "r 250ms cubic-bezier(0.25, 0.1, 0.25, 1.0)" }}
        />
      )}

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
