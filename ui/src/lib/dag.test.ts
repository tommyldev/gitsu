import { describe, it, expect } from "vitest";
import { layout } from "@/lib/dag";
import type { CommitGraph, CommitNode, BranchRef, TagRef } from "@/lib/types";

function node(sha: string, parents: string[]): CommitNode {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    parents,
    author_name: "t",
    author_email: "t@t.io",
    author_time: 1700000000,
    committer_time: 1700000000,
    summary: sha,
    body: "",
    tree: "deadbeef",
  };
}

function graphOf(nodes: CommitNode[], branches: BranchRef[] = [], tags: TagRef[] = []): CommitGraph {
  return {
    nodes,
    branches,
    tags,
    head_sha: nodes[0]?.sha ?? "",
    max_count: nodes.length,
    truncated: false,
    lane_count: 0,
  };
}

describe("layout", () => {
  it("assigns a lane to every commit in a linear history", () => {
    const c1 = node("aaaa", []);
    const c2 = node("bbbb", ["aaaa"]);
    const c3 = node("cccc", ["bbbb"]);
    // revwalker returns newest first
    const g = graphOf([c3, c2, c1]);
    const l = layout(g);
    expect(l.rows).toHaveLength(3);
    expect(l.laneCount).toBeGreaterThanOrEqual(1);
    for (const row of l.rows) {
      expect(row.lane).toBeGreaterThanOrEqual(0);
      expect(row.lane).toBeLessThan(l.laneCount);
    }
  });

  it("uses a separate lane for a branch", () => {
    // main:  c1 -> c2 -> c3
    // feat:  c2 -> c4
    const c1 = node("aaaa", []);
    const c2 = node("bbbb", ["aaaa"]);
    const c3 = node("cccc", ["bbbb"]);
    const c4 = node("dddd", ["bbbb"]);
    const g = graphOf([c3, c4, c2, c1]);
    const l = layout(g);
    // c1, c2 share lane 0 (linear main). c3 is in lane 0 (first parent = c2).
    // c4's first parent is c2 (lane 0) — so c4 also tries lane 0,
    // but c3 is already in lane 0, so c4 gets lane 1.
    const bySha = new Map(l.rows.map((r) => [r.sha, r]));
    expect(bySha.get("aaaa")!.lane).toBe(0);
    expect(bySha.get("bbbb")!.lane).toBe(0);
    expect(bySha.get("cccc")!.lane).toBe(0);
    expect(bySha.get("dddd")!.lane).toBeGreaterThanOrEqual(1);
  });

  it("records edges from each commit to each of its parents", () => {
    const c1 = node("aaaa", []);
    const c2 = node("bbbb", ["aaaa"]);
    const c3 = node("cccc", ["bbbb"]);
    const g = graphOf([c3, c2, c1]);
    const l = layout(g);
    // N-commit linear history has N-1 edges (the root has no parents).
    expect(l.edges).toHaveLength(2);
    const byShaFromTo = l.edges.map((e) => `${e.from_sha.slice(0, 4)}->${e.to_sha.slice(0, 4)}`);
    expect(byShaFromTo).toContain("cccc->bbbb");
    expect(byShaFromTo).toContain("bbbb->aaaa");
  });

  it("first parent shares the commit's lane", () => {
    const c1 = node("aaaa", []);
    const c2 = node("bbbb", ["aaaa"]);
    const c3 = node("cccc", ["bbbb"]);
    const g = graphOf([c3, c2, c1]);
    const l = layout(g);
    const bySha = new Map(l.rows.map((r) => [r.sha, r]));
    // For c3, first parent is c2, both in lane 0
    expect(bySha.get("cccc")!.parentLanes[0]).toBe(0);
    expect(bySha.get("bbbb")!.parentLanes[0]).toBe(0);
  });

  it("attach branches and tags to the right rows", () => {
    const c1 = node("aaaa", []);
    const c2 = node("bbbb", ["aaaa"]);
    const g = graphOf(
      [c2, c1],
      [{ name: "main", is_local: true, sha: "bbbb", upstream: null }],
      [{ name: "v1", sha: "aaaa", is_annotated: true }],
    );
    const l = layout(g);
    const bySha = new Map(l.rows.map((r) => [r.sha, r]));
    expect(bySha.get("bbbb")!.branches.map((b) => b.name)).toEqual(["main"]);
    expect(bySha.get("aaaa")!.tags.map((t) => t.name)).toEqual(["v1"]);
  });

  it("isHead is true for the row whose sha matches head_sha", () => {
    const c1 = node("aaaa", []);
    const c2 = node("bbbb", ["aaaa"]);
    const g: CommitGraph = { ...graphOf([c2, c1]), head_sha: "bbbb" };
    const l = layout(g);
    const bySha = new Map(l.rows.map((r) => [r.sha, r]));
    expect(bySha.get("bbbb")!.isHead).toBe(true);
    expect(bySha.get("aaaa")!.isHead).toBe(false);
  });

  it("handles a merge commit (3 parents, 3 lanes)", () => {
    // main:  c1 -> c2 -> m
    // feat1: c1 -> c3 -> m
    // feat2: c1 -> c4 -> m
    const c1 = node("aaaa", []);
    const c2 = node("bbbb", ["aaaa"]);
    const c3 = node("cccc", ["aaaa"]);
    const c4 = node("dddd", ["aaaa"]);
    const m = node("eeee", ["bbbb", "cccc", "dddd"]); // octopus merge
    const g = graphOf([m, c2, c3, c4, c1]);
    const l = layout(g);
    // m should have parentLanes of length 3
    const mRow = l.rows.find((r) => r.sha === "eeee")!;
    expect(mRow.parentLanes).toHaveLength(3);
    // First parent shares m's lane
    expect(mRow.parentLanes[0]).toBe(mRow.lane);
    // Other parents are in different lanes
    expect(mRow.parentLanes[1]).not.toBe(mRow.lane);
    expect(mRow.parentLanes[2]).not.toBe(mRow.lane);
    // All three distinct
    expect(new Set(mRow.parentLanes).size).toBe(3);
  });
});
