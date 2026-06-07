/**
 * Unified-diff patch parsing shared by the commit panel and the
 * standalone diff viewer. Skips git metadata and hunk headers,
 * emitting one classified line per visible patch row — each tagged
 * with its old/new file line numbers for gutter rendering.
 */

export interface ParsedLine {
  kind: "context" | "add" | "del" | "meta";
  content: string;
  /** 1-based line number in the old (pre-image) file. Set for
   * context and deletion rows; undefined for additions and meta. */
  oldLine?: number;
  /** 1-based line number in the new (post-image) file. Set for
   * context and addition rows; undefined for deletions and meta. */
  newLine?: number;
}

/** Matches a hunk header `@@ -old[,n] +new[,n] @@`, capturing the
 * 1-based start line of each side. */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parse a unified-diff patch into renderable lines. Metadata
 * (`diff --git`, `index`, mode/rename lines) and hunk headers are
 * dropped from the output; hunk headers still seed the per-line
 * old/new line numbers. */
export function parsePatch(patch: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    if (
      raw.startsWith("diff --git ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("old mode") ||
      raw.startsWith("new mode") ||
      raw.startsWith("similarity ") ||
      raw.startsWith("rename ") ||
      raw.startsWith("copy ")
    ) {
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = HUNK_HEADER.exec(raw);
      if (m) {
        oldLine = Number(m[1]);
        newLine = Number(m[2]);
      }
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.length === 0) {
      // Trailing artifact of the final newline: render an empty
      // context row, but don't number it or advance the counters.
      out.push({ kind: "context", content: "" });
      continue;
    }
    const c = raw[0];
    const content = raw.slice(1);
    if (c === "+") {
      out.push({ kind: "add", content, newLine });
      newLine++;
    } else if (c === "-") {
      out.push({ kind: "del", content, oldLine });
      oldLine++;
    } else if (c === " ") {
      out.push({ kind: "context", content, oldLine, newLine });
      oldLine++;
      newLine++;
    } else {
      out.push({ kind: "meta", content: raw });
    }
  }
  return out;
}
