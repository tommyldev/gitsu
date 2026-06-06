/**
 * conflict-decorations — pure parser that scans a string for git
 * conflict markers and returns gitsu-typed `DecorationSource`s.
 *
 * The component `CodeFileView` accepts decorations as a typed
 * prop; this module is the only place that knows about the
 * `<{7} / ={7} / >{7}` shape. Tests live next to it.
 *
 * Two functions:
 *   - `scanConflictMarkers(content)` — single-pass parser. Pure,
 *     side-effect-free, no regex backtracking. Returns markers in
 *     document order.
 *   - `conflictDecorations(content)` — adapter from `string` to
 *     `DecorationSource[]`. Re-runs the parser and emits the
 *     per-line sources that `CodeFileView` consumes.
 *
 * The two-function split exists so we can unit-test the parser
 * independently of the decoration shape (which depends on
 * `@codemirror/view` types).
 */

export interface DecorationSource {
  /** Character offset (inclusive). For line decorations, this is
   * the start of the line. */
  from: number;
  /** Character offset (exclusive). For line decorations, this is
   * the end of the line content (excluding the trailing newline). */
  to: number;
  /** Tailwind-style class string. Resolved by the CodeMirror
   * theme to a background tint. */
  className?: string;
  /** Tooltip text (rendered via `aria-label`). */
  title?: string;
}

export type ConflictMarkerKind = "ours" | "theirs" | "separator" | "base";

export interface ConflictMarker {
  kind: ConflictMarkerKind;
  /** Start of the marker line (inclusive). */
  from: number;
  /** End of the marker line (exclusive, before the `\n` if any). */
  to: number;
  /** Full line text, including any trailing `>>>>>>> branch` suffix. */
  text: string;
  /** For `theirs` markers, the branch name extracted from
   * `>>>>>>> branch`. `null` when the marker is malformed. */
  branch: string | null;
}

const OURS_RE = /^<{7}(?=\s|$)/;
const SEP_RE = /^={7}(?=\s|$)/;
const THEIRS_RE = /^>{7}(?=\s|$)/;

/**
 * Single-pass scan. We walk the string looking for `<<<<<<<` /
 * `=======` / `>>>>>>>` at the start of a line. We track the
 * alternating "ours / separator / theirs" state so a marker in
 * the wrong place (e.g. a stray `=======` outside a conflict)
 * is still emitted as a `separator` — the editor renders it
 * with a neutral tint, not an error.
 */
export function scanConflictMarkers(content: string): ConflictMarker[] {
  const out: ConflictMarker[] = [];
  const len = content.length;
  let pos = 0;
  // Anchors: when we see a `<<<<<<<` we expect the next two
  // markers to be `=======` then `>>>>>>>`. Track the last
  // anchor's kind so we can classify based on sequence.
  let expected: "separator" | "theirs" | null = null;

  while (pos < len) {
    // Find the next line that begins with a 7-char marker. We do
    // a quick O(n) scan — no regex, no allocations beyond the
    // output array.
    const lineStart = pos;
    let lineEnd = lineStart;
    while (lineEnd < len && content.charCodeAt(lineEnd) !== 10 /* \n */) {
      lineEnd++;
    }
    const text = content.slice(lineStart, lineEnd);

    let kind: ConflictMarkerKind | null = null;
    let branch: string | null = null;
    if (OURS_RE.test(text)) {
      kind = "ours";
      expected = "separator";
    } else if (THEIRS_RE.test(text)) {
      kind = "theirs";
      branch = text.slice(7).trim() || null;
      expected = null;
    } else if (SEP_RE.test(text)) {
      // A separator that follows an ours-marker is a conflict
      // mid-line; an orphan separator (no preceding ours) is
      // labelled `base` so the UI can tint it neutrally.
      kind = expected === "separator" ? "separator" : "base";
      expected = "theirs";
    }

    if (kind !== null) {
      out.push({ kind, from: lineStart, to: lineEnd, text, branch });
    }

    // Advance past the newline (if any) so lineEnd becomes the
    // start of the next line.
    pos = lineEnd < len ? lineEnd + 1 : len;
  }
  return out;
}

/** CSS class strings for each marker kind. Names are stable so
 * callers / tests can rely on them. Defined here, not in CSS, so
 * the contract is in one place. */
const KIND_CLASS: Record<ConflictMarkerKind, string> = {
  ours: "cm-conflict-ours",
  separator: "cm-conflict-separator",
  base: "cm-conflict-base",
  theirs: "cm-conflict-theirs",
};

const KIND_TITLE: Record<ConflictMarkerKind, string> = {
  ours: "Conflict start (ours)",
  separator: "Conflict divider",
  base: "Stray conflict separator",
  theirs: "Conflict end (theirs)",
};

/**
 * Adapter: `string` → `DecorationSource[]` for `CodeFileView`.
 * Cheap to call on every keystroke; the parser is O(n) and the
 * result is tiny (markers are rare).
 */
export function conflictDecorations(content: string): DecorationSource[] {
  const markers = scanConflictMarkers(content);
  return markers.map((m) => ({
    from: m.from,
    to: m.to,
    className: KIND_CLASS[m.kind],
    title: m.branch ? `${KIND_TITLE[m.kind]} — ${m.branch}` : KIND_TITLE[m.kind],
  }));
}
