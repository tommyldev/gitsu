/**
 * Single commit row for the graph.
 */

import type { CommitNode } from "@/lib/types";
import type { LayoutRow } from "@/lib/dag";
import {
  LANE_COLORS,
  ROW_HEIGHT,
  CIRCLE_R,
  laneX,
  branchLabelWidth,
  tagLabelWidth,
  rowY,
} from "./graph-geometry";
import { BranchLabel, TagLabel } from "./RefLabels";
import { truncate, relativeTime } from "@/lib/format";

export function CommitRow({
  row,
  node,
  index,
  headRowIndex,
  hasPending,
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
  /** Row index of the worktree's HEAD commit. -1 if not found. */
  headRowIndex: number;
  /** Whether the working-tree row is present. */
  hasPending: boolean;
  selected: boolean;
  totalWidth: number;
  labelX: number;
  authorX: number;
  dateX: number;
  messageX: number;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const y = rowY(index, headRowIndex, hasPending);
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
        fill={selected ? "#101113" : "#141519"}
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
        {truncate(node.summary, Math.floor(240 / 7))}
      </text>
    </g>
  );
}
