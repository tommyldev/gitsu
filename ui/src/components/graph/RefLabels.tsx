/**
 * Branch and tag label rendering for the commit graph.
 */

import { truncate } from "@/lib/format";
import { branchLabelWidth, tagLabelWidth } from "./graph-geometry";

export function BranchLabel({ branch }: { branch: { name: string; is_local: boolean } }) {
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

export function TagLabel({ tag, xOffset }: { tag: { name: string; is_annotated: boolean }; xOffset: number }) {
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
