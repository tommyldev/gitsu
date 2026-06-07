import { useMemo } from "react";
import clsx from "clsx";
import { parsePatch } from "@/lib/diff";
import { useHighlighter } from "@/lib/highlight";

/**
 * UnifiedDiff — renders a unified diff with per-line +/- coloring,
 * old/new line-number gutters, and per-token syntax highlighting
 * (the grammar is chosen from `path`; until it loads, rows render as
 * plain text).
 *
 * `dense` tightens the padding + font for the inline expansion in
 * the diff file list; the default sizing is for the full-pane
 * file-focus view.
 */
export function UnifiedDiff({
  patch,
  path,
  dense = false,
}: {
  patch: string;
  path?: string;
  dense?: boolean;
}) {
  const lines = useMemo(() => parsePatch(patch), [patch]);
  const highlight = useHighlighter(path);

  // Highlight once per (patch, grammar) rather than on every render.
  // Meta rows (e.g. the no-newline marker) aren't code, so stay raw.
  const rows = useMemo(
    () =>
      lines.map((line) => ({
        line,
        tokens:
          highlight && line.kind !== "meta" && line.content.length > 0
            ? highlight(line.content)
            : null,
      })),
    [lines, highlight],
  );

  return (
    <pre
      className={clsx(
        "overflow-x-auto font-mono leading-relaxed",
        dense ? "p-2 text-[11px]" : "p-3 text-[12px]",
      )}
    >
      <code>
        {rows.map(({ line, tokens }, i) => (
          <div
            key={i}
            className={clsx(
              "flex",
              line.kind === "add" &&
                "bg-success/10 shadow-[inset_2px_0_0_rgba(76,175,80,0.6)]",
              line.kind === "del" &&
                "bg-danger/10 shadow-[inset_2px_0_0_rgba(239,83,80,0.6)]",
              (line.kind === "meta" || line.kind === "context") && "text-fg",
            )}
          >
            <span className="inline-block w-10 shrink-0 select-none pr-2 text-right tabular-nums text-fg-subtle">
              {line.oldLine ?? ""}
            </span>
            <span className="inline-block w-10 shrink-0 select-none pr-2 text-right tabular-nums text-fg-subtle">
              {line.newLine ?? ""}
            </span>
            <span
              className={clsx(
                "inline-block w-4 shrink-0 select-none text-center",
                line.kind === "add"
                  ? "text-success"
                  : line.kind === "del"
                    ? "text-danger"
                    : "text-fg-muted",
              )}
            >
              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
            </span>
            <span className="whitespace-pre pl-1">
              {tokens
                ? tokens.map((tok, j) => (
                    <span key={j} style={tok.style}>
                      {tok.text}
                    </span>
                  ))
                : line.content}
            </span>
          </div>
        ))}
      </code>
    </pre>
  );
}
