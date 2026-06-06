/**
 * Working-tree pseudo-row (uncommitted changes) for the commit graph.
 *
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

import type { WorkingTree } from "@/lib/types";
import { LANE_COLORS, CIRCLE_R, laneX, WORKING_TREE_ROW_HEIGHT } from "./graph-geometry";

export function WorkingTreeRow({
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

      {/* Dotted ring — the "uncommitted changes attached to HEAD"
          cue. Uses a dashed stroke (matching the connector/track dash
          pattern elsewhere) so the empty interior reads as "not a
          real commit yet". No inner fill: the dashed stroke is the
          indicator on its own, and a solid dot would compete with
          the dotted language. */}
      <circle
        cx={cx}
        cy={midY}
        r={CIRCLE_R + 1}
        fill="#1A1B1D"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="2,2"
      />

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
