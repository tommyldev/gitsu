/**
 * Pure geometry constants and helpers for the commit graph.
 * No React, no IO — these are pure functions of their inputs.
 */

import type { LayoutRow } from "@/lib/dag";

// ── Layout constants ───────────────────────────────────────────

export const ROW_HEIGHT = 28;
export const LANE_WIDTH = 16;
export const GRAPH_PAD_X = 12;
export const CIRCLE_R = 4;
export const GRAPH_TO_LABEL_GAP = 16;
export const MIN_GRAPH_WIDTH = 40;
// The working-tree pseudo-row is the same height as a commit row so
// the visual cadence matches — one "step" of head → working tree.
export const WORKING_TREE_ROW_HEIGHT = 28;

export const COL_LABELS = 160;
export const COL_AUTHOR = 110;
export const COL_DATE = 75;
export const COL_MESSAGE = 240;

// Desaturated, monochrome-friendly lane palette
export const LANE_COLORS = [
  "#5E6AD2", // accent (desaturated blue)
  "#6B7280", // cool gray
  "#9CA3AF", // lighter gray
  "#D1D5DB", // light gray
  "#A1A1AA", // muted gray
  "#7E82A6", // blue-gray
  "#8B8FA3", // slate
  "#787C8E", // dark slate
];

// ── Geometry helpers ───────────────────────────────────────────

export function laneX(lane: number): number {
  return COL_LABELS + GRAPH_PAD_X + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

export function branchLabelWidth(name: string): number {
  const display = name.length <= 14 ? name : name.slice(0, 13) + "…";
  return Math.max(40, display.length * 6.2 + 16);
}

export function tagLabelWidth(name: string): number {
  const display = name.length <= 10 ? name : name.slice(0, 9) + "…";
  return Math.max(36, display.length * 6.2 + 16);
}

export function layoutRowIndexBySha(rows: LayoutRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) m.set(rows[i].sha, i);
  return m;
}
