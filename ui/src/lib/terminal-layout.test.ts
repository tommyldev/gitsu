import { describe, it, expect } from "vitest";
import {
  type Layout,
  findPane,
  findFilePaneByPath,
  removePane,
  collectPaneIds,
  mapLayout,
  firstPaneId,
  firstSessionId,
} from "@/lib/terminal-layout";

const pane = (id: string, sessionId: number | null): Layout => ({ kind: "pane", id, sessionId });
const filepane = (id: string, filePath: string): Layout => ({
  kind: "filepane",
  id,
  filePath,
  cwd: "/repo",
});
const split = (id: string, a: Layout, b: Layout): Layout => ({
  kind: "split",
  id,
  dir: "v",
  ratio: 0.5,
  a,
  b,
});

describe("findPane", () => {
  it("returns the matching leaf with its 0/1 path from the root", () => {
    const tree = split("s1", split("s2", pane("p1", 1), pane("p2", 2)), pane("p3", 3));
    expect(findPane(tree, "p1")?.path).toEqual([0, 0]);
    expect(findPane(tree, "p2")?.path).toEqual([0, 1]);
    expect(findPane(tree, "p3")?.path).toEqual([1]);
    expect(findPane(tree, "p1")?.layout).toEqual(pane("p1", 1));
  });

  it("returns null for an unknown id and [] for a root leaf", () => {
    expect(findPane(split("s1", pane("p1", 1), pane("p2", 2)), "nope")).toBeNull();
    expect(findPane(pane("solo", 9), "solo")?.path).toEqual([]);
  });
});

describe("findFilePaneByPath", () => {
  it("matches a file pane by absolute path, ignoring terminal panes", () => {
    const tree = split("s1", pane("p1", 1), filepane("f1", "/repo/a.ts"));
    expect(findFilePaneByPath(tree, "/repo/a.ts")?.path).toEqual([1]);
    expect(findFilePaneByPath(tree, "/repo/missing.ts")).toBeNull();
  });
});

describe("removePane", () => {
  it("collapses a single-child split into its surviving sibling", () => {
    const tree = split("s1", pane("p1", 1), pane("p2", 2));
    expect(removePane(tree, "p2")).toEqual(pane("p1", 1));
    expect(removePane(tree, "p1")).toEqual(pane("p2", 2));
  });

  it("collapses the nested split but keeps the outer structure", () => {
    const tree = split("s1", split("s2", pane("p1", 1), pane("p2", 2)), pane("p3", 3));
    expect(removePane(tree, "p2")).toEqual(split("s1", pane("p1", 1), pane("p3", 3)));
  });

  it("returns null when the root leaf itself is removed", () => {
    expect(removePane(pane("only", 1), "only")).toBeNull();
  });

  it("leaves the tree unchanged for an unknown id", () => {
    const tree = split("s1", pane("p1", 1), pane("p2", 2));
    expect(removePane(tree, "ghost")).toEqual(tree);
  });
});

describe("collectPaneIds", () => {
  it("lists every leaf id in left-to-right pre-order", () => {
    const tree = split("s1", split("s2", pane("p1", 1), pane("p2", 2)), filepane("f1", "/x"));
    expect(collectPaneIds(tree)).toEqual(["p1", "p2", "f1"]);
  });
});

describe("mapLayout", () => {
  it("rebuilds the tree applying fn to every node (e.g. equalizing ratios)", () => {
    const tree = split("s1", pane("p1", 1), pane("p2", 2));
    const equalized = mapLayout({ ...tree, ratio: 0.2 } as Layout, (l) =>
      l.kind === "split" ? { ...l, ratio: 0.5 } : l,
    );
    expect(equalized).toEqual(tree);
  });

  it("preserves structure under the identity transform", () => {
    const tree = split("s1", split("s2", pane("p1", 1), pane("p2", 2)), pane("p3", 3));
    expect(mapLayout(tree, (l) => l)).toEqual(tree);
  });
});

describe("firstPaneId / firstSessionId", () => {
  it("firstPaneId returns the left-most leaf id", () => {
    const tree = split("s1", split("s2", pane("p1", 1), pane("p2", 2)), pane("p3", 3));
    expect(firstPaneId(tree)).toBe("p1");
  });

  it("firstSessionId skips file panes and returns the first terminal session", () => {
    const tree = split("s1", filepane("f1", "/x"), pane("p2", 7));
    expect(firstSessionId(tree)).toBe(7);
  });

  it("firstSessionId returns null when there are no terminal panes", () => {
    const tree = split("s1", filepane("f1", "/x"), filepane("f2", "/y"));
    expect(firstSessionId(tree)).toBeNull();
  });
});
