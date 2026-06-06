import { describe, it, expect } from "vitest";
import {
  scanConflictMarkers,
  conflictDecorations,
  type ConflictMarker,
} from "./conflict-decorations";

/** Build a full conflict block: ours / separator / theirs. */
function conflict(
  ours: string,
  theirs: string,
  branch = "feature/foo",
): string {
  return `before\n<<<<<<< HEAD\n${ours}\n=======\n${theirs}\n>>>>>>> ${branch}\nafter`;
}

describe("scanConflictMarkers", () => {
  it("returns no markers in clean content", () => {
    expect(scanConflictMarkers("hello\nworld\n")).toEqual([]);
  });

  it("detects a complete ours/separator/theirs block", () => {
    const src = conflict("a", "b");
    const markers = scanConflictMarkers(src);
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.kind)).toEqual(["ours", "separator", "theirs"]);
  });

  it("extracts the branch name from the theirs marker", () => {
    const src = conflict("a", "b", "feature/awesome");
    const markers = scanConflictMarkers(src);
    const theirs = markers.find((m) => m.kind === "theirs")!;
    expect(theirs.branch).toBe("feature/awesome");
  });

  it("handles a theirs marker without a branch suffix", () => {
    const src = "<<<<<<<\na\n=======\nb\n>>>>>>>\n";
    const markers = scanConflictMarkers(src);
    const theirs = markers.find((m) => m.kind === "theirs")!;
    expect(theirs.branch).toBeNull();
  });

  it("classifies a stray separator as `base`", () => {
    const src = "no conflict here\n=======\nstill no conflict\n";
    const markers = scanConflictMarkers(src);
    expect(markers).toHaveLength(1);
    expect(markers[0].kind).toBe("base");
  });

  it("classifies an ours marker with no matching separator as ours (no expectations)", () => {
    const src = "<<<<<<<\na\n";
    const markers = scanConflictMarkers(src);
    expect(markers).toHaveLength(1);
    expect(markers[0].kind).toBe("ours");
  });

  it("emits markers in document order with correct offsets", () => {
    const src = conflict("a", "b");
    const markers = scanConflictMarkers(src);
    expect(markers[0].from).toBe(src.indexOf("<<<<<<<"));
    expect(markers[0].to).toBe(src.indexOf("\n", markers[0].from));
    expect(markers[1].from).toBe(src.indexOf("======="));
    expect(markers[2].from).toBe(src.indexOf(">>>>>>>"));
    // Offsets are strictly increasing.
    for (let i = 1; i < markers.length; i++) {
      expect(markers[i].from).toBeGreaterThan(markers[i - 1].from);
    }
  });

  it("does not match fewer than 7 angle/equals signs", () => {
    const src = "<<<<<< not a marker\n";
    expect(scanConflictMarkers(src)).toEqual([]);
  });

  it("does not match 8+ angle/equals signs (must be exactly 7)", () => {
    const src = "<<<<<<<<oops\n";
    expect(scanConflictMarkers(src)).toEqual([]);
  });
});

describe("conflictDecorations", () => {
  it("returns one decoration per marker with the right class", () => {
    const src = conflict("a", "b");
    const decs = conflictDecorations(src);
    expect(decs).toHaveLength(3);
    expect(decs[0].className).toBe("cm-conflict-ours");
    expect(decs[1].className).toBe("cm-conflict-separator");
    expect(decs[2].className).toBe("cm-conflict-theirs");
  });

  it("emits `cm-conflict-base` for stray separators", () => {
    const decs = conflictDecorations("=======\n");
    expect(decs).toHaveLength(1);
    expect(decs[0].className).toBe("cm-conflict-base");
  });

  it("includes the branch name in the theirs marker's title", () => {
    const decs = conflictDecorations(conflict("a", "b", "main"));
    const theirs = decs.find((d) => d.className === "cm-conflict-theirs")!;
    expect(theirs.title).toContain("main");
  });

  it("returns an empty array for clean content", () => {
    expect(conflictDecorations("hello world")).toEqual([]);
  });

  it("covers the full marker kinds", () => {
    // Type-level smoke test: every ConflictMarkerKind has a class.
    const kinds: ConflictMarker["kind"][] = ["ours", "separator", "base", "theirs"];
    const seen = new Set(conflictDecorations(conflict("a", "b")).map((d) => d.className));
    for (const k of kinds) {
      const expected = `cm-conflict-${k}`;
      // The `base` class only appears for stray separators, so we
      // skip it here.
      if (k === "base") continue;
      expect(seen.has(expected)).toBe(true);
    }
  });
});
