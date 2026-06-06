/**
 * FileViewerPane — read-only viewer for a single file, rendered as
 * a leaf in the terminal strip's split layout.
 *
 * Lifecycle:
 *  - On mount (or when the file path changes), fetch the file via
 *    the `read_file` IPC command. While the request is in flight
 *    we show a "Loading…" placeholder; on success we render the
 *    content; on binary or error we show a small message.
 *  - On unmount, no cleanup is needed (no xterm, no PTY).
 *  - Closing the pane is the parent's responsibility (calls
 *    `closePane`); this component just renders a close button.
 *
 * Keyboard: ⌘W (the same global hotkey that closes terminal panes)
 * routes to the store's `closePane`, so we don't need to handle
 * it here.
 */
import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import clsx from "clsx";
import { readFile } from "@/lib/tauri";

export interface FileViewerPaneProps {
  paneId: string;
  worktree: string;
  filePath: string;
  /** The terminal CWD at the moment the file was opened. Display-only;
   * used to show a friendly relative path in the header (e.g. when the
   * user opens a file via the directory explorer rooted at the
   * terminal's CWD). */
  cwd: string;
  isFocused: boolean;
  onClose: (worktree: string, paneId: string) => void;
  onFocus: (worktree: string, paneId: string) => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; content: string; lineCount: number }
  | { kind: "binary" }
  | { kind: "error"; message: string };

export function FileViewerPane({
  paneId,
  worktree,
  filePath,
  cwd,
  isFocused,
  onClose,
  onFocus,
}: FileViewerPaneProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    readFile(filePath)
      .then((content) => {
        if (cancelled) return;
        if (content == null) {
          setState({ kind: "binary" });
        } else {
          // Count lines. We use the number of `\n` rather than
          // splitting so we don't allocate an array for large
          // files. Trailing line without a newline is still a line.
          let n = 1;
          for (const ch of content) if (ch === "\n") n++;
          setState({ kind: "ok", content, lineCount: n });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ kind: "error", message: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const displayPath = computeDisplayPath(filePath, cwd);

  return (
    <div
      onMouseDown={() => onFocus(worktree, paneId)}
      className={clsx(
        "group flex h-full w-full min-h-0 min-w-0 flex-col border bg-bg transition-colors duration-150",
        isFocused ? "border-accent/40" : "border-white/[0.04]",
      )}
    >
      <div
        className={clsx(
          "flex h-6 shrink-0 items-center gap-1.5 border-b px-1.5 transition-colors duration-150",
          isFocused ? "border-accent/30 bg-accent/[0.06]" : "border-white/[0.06] bg-bg-panel/60",
        )}
      >
        <FileText size={10} strokeWidth={1.5} className="text-fg-muted shrink-0" />
        <span
          className="truncate font-mono text-[10px] text-fg"
          title={filePath}
        >
          {displayPath}
        </span>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              void onClose(worktree, paneId);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Close file viewer"
            className="rounded p-1 text-fg-muted hover:bg-white/[0.06] hover:text-fg transition-colors duration-150"
          >
            <X size={10} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-bg">
        {state.kind === "loading" && (
          <div className="flex h-full items-center justify-center text-[11px] text-fg-muted">
            Loading…
          </div>
        )}
        {state.kind === "binary" && (
          <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-fg-muted">
            Binary file — preview unavailable
          </div>
        )}
        {state.kind === "error" && (
          <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-danger">
            {state.message}
          </div>
        )}
        {state.kind === "ok" && (
          <pre className="font-mono text-[11px] leading-[1.4] text-fg">
            <FileContent content={state.content} lineCount={state.lineCount} />
          </pre>
        )}
      </div>
    </div>
  );
}

/** Render the file content as a two-column layout: line numbers in
 * a muted gutter, content in a monospace block. We split on `\n`
 * once and render as React nodes — for files larger than ~5k lines
 * this is still snappy enough, and for huge files we accept the
 * cost (the viewer is read-only, so no editing keystrokes to
 * worry about). */
function FileContent({ content, lineCount }: { content: string; lineCount: number }) {
  // Build the gutter string once. The width is the number of
  // digits in the line count, padded to that width.
  const gutterWidth = String(lineCount).length;
  const lines = content.split("\n");
  return (
    <div className="flex">
      <div
        className="sticky left-0 select-none border-r border-white/[0.04] bg-bg px-2 py-1 text-right text-fg-subtle"
        style={{ minWidth: `${gutterWidth * 0.65 + 1.5}em` }}
      >
        {lines.map((_, i) => (
          <div key={i}>{String(i + 1).padStart(gutterWidth, " ")}</div>
        ))}
      </div>
      <div className="flex-1 px-2 py-1">
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre">
            {line || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Pick the shorter of (absolute path, path relative to cwd). When
 * the file lives under the terminal's CWD, showing the relative
 * path keeps the header readable. */
function computeDisplayPath(filePath: string, cwd: string): string {
  if (!cwd) return filePath;
  // Normalize trailing slashes on the cwd for prefix matching.
  const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
  if (filePath.startsWith(prefix)) {
    return filePath.slice(prefix.length);
  }
  return filePath;
}
