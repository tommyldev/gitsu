/**
 * Commit-graph lane assignment + SVG layout.
 *
 * The Rust side returns the raw DAG (commits, parents, branches, tags).
 * The frontend owns the *visual* layout: assigning each commit to a
 * horizontal lane, and drawing the edges (lines) between commits and
 * their parents.
 *
 * ## Algorithm
 *
 * We process commits in display order (newest first, the same order
 * the libgit2 revwalker returns them). For each commit C:
 *
 * 1. Pick a lane for C:
 *    a. If a child already reserved a lane for C (a child C' said "my
 *       first parent should be in this lane"), use that lane. This
 *       makes the line continue straight up.
 *    b. Otherwise, take the lowest-numbered free lane, or allocate a
 *       new one.
 *
 * 2. Reserve lanes for C's parents:
 *    a. C's first parent inherits C's lane (so the line continues
 *       down to the parent).
 *    b. Other parents get the lowest free lane. (A merge commit with
 *       3 parents uses 1 inherited + 2 free lanes.)
 *
 * 3. Record edges (parent → child) for the SVG renderer to draw.
 *
 * The result is a "first-free" lane assignment: every commit gets a
 * lane, the first-parent vertical line is preserved, and merges
 * spread out. It's not the tightest packing (a more sophisticated
 * algorithm could reclaim lanes whose last user is in the past), but
 * it's correct, predictable, and easy to reason about. We can tighten
 * the packing in a follow-up without changing the data model.
 *
 * For more on lane-assignment algorithms, see Eric D. Sung's 2016
 * writeup of GitKraken's graph algorithm.
 */

import type { BranchRef, CommitGraph, CommitNode, TagRef } from "@/lib/types";

/** One row in the rendered graph (in display order). */
export interface LayoutRow {
  /** Commit SHA. */
  sha: string;
  /** The lane this commit is in. */
  lane: number;
  /**
   * The lane of each parent, in the same order as `CommitNode.parents`.
   * The first parent is `lane` itself (the line continues down).
   * Other parents are in different lanes.
   *
   * If a parent is not in the displayed graph (it's outside
   * `max_count`), its lane is the *reserved* lane we computed — the
   * edge will still draw to the top of the graph, but won't connect
   * to a node.
   */
  parentLanes: number[];
  /** Branch refs that point to this commit. */
  branches: BranchRef[];
  /** Tag refs that point to this commit. */
  tags: TagRef[];
  /** True if this is HEAD. */
  isHead: boolean;
}

/** A directed edge from a commit to one of its parents, for SVG drawing. */
export interface LayoutEdge {
  from_sha: string;
  from_lane: number;
  to_sha: string;
  to_lane: number;
  /** True if the parent commit is in the displayed graph. */
  to_known: boolean;
}

export interface GraphLayout {
  rows: LayoutRow[];
  edges: LayoutEdge[];
  /** Total number of lanes. */
  laneCount: number;
}

export function layout(graph: CommitGraph): GraphLayout {
  const bySha = new Map<string, CommitNode>();
  for (const node of graph.nodes) bySha.set(node.sha, node);

  // Map of "final lane for this commit"
  const laneMap = new Map<string, number>();

  // activeLanes tracks the downward edges propagating toward a commit.
  // A commit might be targeted by multiple children (a merge base).
  // The commit will resolve these by taking the lowest lane, and FREEING the rest!
  const activeLanes = new Map<string, Set<number>>();
  const freeLanes: number[] = [];
  let nextLane = 0;

  function getFreeLane() {
    if (freeLanes.length > 0) return freeLanes.pop()!;
    return nextLane++;
  }

  function freeLane(l: number) {
    if (!freeLanes.includes(l)) {
      freeLanes.push(l);
      // Sort descending so pop() gets the smallest lane number.
      freeLanes.sort((a, b) => b - a);
    }
  }

  function addActiveLane(sha: string, lane: number) {
    if (!activeLanes.has(sha)) activeLanes.set(sha, new Set());
    activeLanes.get(sha)!.add(lane);
  }

  // First pass: build a map of branches + tags by SHA for O(1) lookup
  const branchesBySha = new Map<string, BranchRef[]>();
  for (const b of graph.branches) {
    if (!branchesBySha.has(b.sha)) branchesBySha.set(b.sha, []);
    branchesBySha.get(b.sha)!.push(b);
  }
  const tagsBySha = new Map<string, TagRef[]>();
  for (const t of graph.tags) {
    if (!tagsBySha.has(t.sha)) tagsBySha.set(t.sha, []);
    tagsBySha.get(t.sha)!.push(t);
  }

  // Process commits in display order (newest first).
  for (const node of graph.nodes) {
    const lanes = activeLanes.get(node.sha);
    let lane: number;

    if (lanes && lanes.size > 0) {
      // Commit resolves multiple incoming lanes by taking the smallest one.
      const sortedLanes = Array.from(lanes).sort((a, b) => a - b);
      lane = sortedLanes[0];
      // The other branches have successfully merged here.
      // Their downward lineage ends, so their lanes are now free!
      for (let i = 1; i < sortedLanes.length; i++) {
        freeLane(sortedLanes[i]);
      }
    } else {
      // New branch head that had no incoming edges
      lane = getFreeLane();
    }

    laneMap.set(node.sha, lane);

    if (node.parents.length === 0) {
      // Lineage ends here. The lane is free!
      freeLane(lane);
    } else {
      // First parent inherits our lane (extends the vertical line).
      addActiveLane(node.parents[0], lane);
      // Other parents spawn new incoming lanes
      for (let i = 1; i < node.parents.length; i++) {
        addActiveLane(node.parents[i], getFreeLane());
      }
    }
  }

  // Helper to get the target lane for an edge, even if the parent is outside the graph.
  function getLane(sha: string): number {
    if (laneMap.has(sha)) return laneMap.get(sha)!;
    const lanes = activeLanes.get(sha);
    if (lanes && lanes.size > 0) return Math.min(...Array.from(lanes));
    return 0;
  }

  const edges: LayoutEdge[] = [];
  for (const node of graph.nodes) {
    for (let i = 0; i < node.parents.length; i++) {
      const p = node.parents[i];
      edges.push({
        from_sha: node.sha,
        from_lane: laneMap.get(node.sha)!,
        to_sha: p,
        to_lane: getLane(p),
        to_known: bySha.has(p),
      });
    }
  }

  const rows: LayoutRow[] = graph.nodes.map((node) => ({
    sha: node.sha,
    lane: laneMap.get(node.sha)!,
    parentLanes: node.parents.map((p) => getLane(p)),
    branches: branchesBySha.get(node.sha) ?? [],
    tags: tagsBySha.get(node.sha) ?? [],
    isHead: node.sha === graph.head_sha,
  }));

  return {
    rows,
    edges,
    laneCount: nextLane,
  };
}
