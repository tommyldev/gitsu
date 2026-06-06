/**
 * SVG edge and track-line rendering for the commit graph.
 */

import type { LayoutEdge, LayoutRow } from "@/lib/dag";
import { LANE_COLORS, ROW_HEIGHT, CIRCLE_R, laneX } from "./graph-geometry";

export function EdgeLine({
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

export function TrackLines({
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
