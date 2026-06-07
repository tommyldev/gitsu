import { describe, it, expect } from "vitest";
import { parsePatch } from "./diff";

/** A standard modify hunk: one context, one del, one add, one
 * context. Mirrors what libgit2 emits (prefixes re-attached). */
const MODIFY = [
  "diff --git a/README.md b/README.md",
  "index e69de29..d00491f 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,3 +1,3 @@",
  " line one",
  "-old two",
  "+new two",
  " line three",
  "",
].join("\n");

describe("parsePatch", () => {
  it("classifies context / add / del rows", () => {
    const kinds = parsePatch(MODIFY).map((l) => l.kind);
    // Trailing "" from the final newline yields one extra context row.
    expect(kinds).toEqual(["context", "del", "add", "context", "context"]);
  });

  it("drops metadata and hunk-header lines", () => {
    const contents = parsePatch(MODIFY).map((l) => l.content);
    expect(contents).not.toContain("@@ -1,3 +1,3 @@");
    expect(contents.some((c) => c.startsWith("diff --git"))).toBe(false);
  });

  it("numbers context rows on both sides", () => {
    const [ctx] = parsePatch(MODIFY);
    expect(ctx).toMatchObject({ kind: "context", oldLine: 1, newLine: 1 });
  });

  it("numbers a deletion on the old side only", () => {
    const del = parsePatch(MODIFY).find((l) => l.kind === "del")!;
    expect(del.oldLine).toBe(2);
    expect(del.newLine).toBeUndefined();
  });

  it("numbers an addition on the new side only", () => {
    const add = parsePatch(MODIFY).find((l) => l.kind === "add")!;
    expect(add.newLine).toBe(2);
    expect(add.oldLine).toBeUndefined();
  });

  it("advances numbering past the change", () => {
    const last = parsePatch(MODIFY).find((l) => l.content === "line three")!;
    expect(last).toMatchObject({ oldLine: 3, newLine: 3 });
  });

  it("does not number the trailing empty row", () => {
    const rows = parsePatch(MODIFY);
    const trailing = rows[rows.length - 1];
    expect(trailing).toEqual({ kind: "context", content: "" });
  });

  it("reseeds line numbers at each hunk header", () => {
    const patch = [
      "@@ -10,2 +10,2 @@",
      " ctx a",
      "-del b",
      "+add b",
      "@@ -20,1 +20,2 @@",
      " ctx c",
      "+add d",
    ].join("\n");
    const rows = parsePatch(patch);
    expect(rows[0]).toMatchObject({ content: "ctx a", oldLine: 10, newLine: 10 });
    expect(rows[1]).toMatchObject({ kind: "del", content: "del b", oldLine: 11 });
    expect(rows[2]).toMatchObject({ kind: "add", content: "add b", newLine: 11 });
    // Second hunk restarts from its header, not from where the first left off.
    expect(rows[3]).toMatchObject({ content: "ctx c", oldLine: 20, newLine: 20 });
    expect(rows[4]).toMatchObject({ kind: "add", content: "add d", newLine: 21 });
  });

  it("handles a single-line hunk header without counts", () => {
    const patch = ["@@ -5 +5 @@", "-a", "+b"].join("\n");
    const rows = parsePatch(patch);
    expect(rows[0]).toMatchObject({ kind: "del", oldLine: 5 });
    expect(rows[1]).toMatchObject({ kind: "add", newLine: 5 });
  });

  it("treats the no-newline marker as an unnumbered meta row", () => {
    const patch = ["@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file"].join(
      "\n",
    );
    const meta = parsePatch(patch).find((l) => l.kind === "meta")!;
    expect(meta.content).toBe("\\ No newline at end of file");
    expect(meta.oldLine).toBeUndefined();
    expect(meta.newLine).toBeUndefined();
  });
});
