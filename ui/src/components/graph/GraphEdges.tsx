/**
 * SVG edge and track-line rendering for the commit graph.
 */

import type { LayoutEdge, LayoutRow } from "@/lib/dag";
import { LANE_COLORS, ROW_HEIGHT, CIRCLE_R, laneX, rowY } from "./graph-geometry";

export function EdgeLine({
  edge,
  rowIndexBySha,
  headRowIndex,
  hasPending,
}: {
  edge: LayoutEdge;
  rowIndexBySha: Map<string, number>;
  /** Row index of the worktree's HEAD commit. -1 if not found. */
  headRowIndex: number;
  /** Whether the working-tree row is present. */
  hasPending: boolean;
}) {
  const fromIndex = rowIndexBySha.get(edge.from_sha);
  if (fromIndex === undefined) return null;

  const parentIndex = rowIndexBySha.get(edge.to_sha);
  const childY = rowY(fromIndex, headRowIndex, hasPending) + ROW_HEIGHT / 2;
  const parentY =
    parentIndex !== undefined
      ? rowY(parentIndex, headRowIndex, hasPending) + ROW_HEIGHT / 2
      : rowY(fromIndex + 1, headRowIndex, hasPending) + ROW_HEIGHT / 2;

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

export function TrackLines({
  row,
  rowIndex,
  headRowIndex,
  hasPending,
}: {
  row: LayoutRow;
  rowIndex: number;
  /** Row index of the worktree's HEAD commit. -1 if not found. */
  headRowIndex: number;
  /** Whether the working-tree row is present. */
  hasPending: boolean;
}) {
  const cx = laneX(row.lane);
  const color = LANE_COLORS[row.lane % LANE_COLORS.length];
  const y1 = rowY(rowIndex, headRowIndex, hasPending);
  const y2 = rowY(rowIndex + 1, headRowIndex, hasPending);
  return (
    <line
      x1={cx}
      y1={y1}
      x2={cx}
      y2={y2}
      stroke={color}
      strokeWidth={1.5}
      opacity={0.4}
    />
  );
}
