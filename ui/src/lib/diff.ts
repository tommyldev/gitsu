/**
 * Unified-diff patch parsing shared by the commit panel and the
 * standalone diff viewer. Skips git metadata and hunk headers,
 * emitting one classified line per visible patch row.
 */

export interface ParsedLine {
  kind: "context" | "add" | "del" | "meta";
  content: string;
}

/** Parse a unified-diff patch into renderable lines. Metadata
 * (`diff --git`, `index`, mode/rename lines) and hunk headers are
 * dropped; only the hunk bodies are returned. */
export function parsePatch(patch: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let inHunk = false;
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
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.length === 0) {
      out.push({ kind: "context", content: "" });
      continue;
    }
    const c = raw[0];
    const content = raw.slice(1);
    if (c === "+") out.push({ kind: "add", content });
    else if (c === "-") out.push({ kind: "del", content });
    else if (c === " ") out.push({ kind: "context", content });
    else out.push({ kind: "meta", content: raw });
  }
  return out;
}
