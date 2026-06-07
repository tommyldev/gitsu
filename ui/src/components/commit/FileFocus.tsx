/**
 * FileFocus — the "I clicked a file in the commit panel" view.
 *
 * Two modes, switched by a button in the header:
 *   - "diff" (default): the unified diff with +/- coloring.
 *   - "file": the full file content at the commit's tree (via
 *     `fileContent` IPC), rendered in `CodeFileView` with
 *     syntax highlighting. The "view file" toggle.
 *
 * The toggle is only meaningful in commit mode — in workdir
 * mode, the file is the working tree (no historical version
 * to view), so the button is disabled with a tooltip.
 *
 * No store change: file content is per-mount React state.
 * IPC contract: `file_content(repo, refName, path)` is the
 * same call the diff view eventually uses for per-line
 * rendering; we're just consuming the full blob here.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, FileCode2, GitCompare } from "lucide-react";
import { type FileDiff } from "@/lib/types";
import { fileContent } from "@/lib/tauri";
import { parseError } from "@/lib/errors";
import { CodeFileView } from "@/components/ui/CodeFileView";
import { UnifiedDiff } from "./UnifiedDiff";

interface FileFocusProps {
  file: FileDiff;
  /** The repo the commit lives in. Required for `fileContent`. */
  repo: string;
  /** The commit whose tree the file should be read from. When
   * null (workdir mode), the "view file" toggle is disabled. */
  commitSha: string | null;
  onBack: () => void;
}

type ViewMode = "diff" | "file";
type FileLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; content: string }
  | { kind: "binary" }
  | { kind: "error"; message: string };

export function FileFocus({ file, repo, commitSha, onBack }: FileFocusProps) {
  const path = file.new_path ?? file.old_path ?? "(unknown)";
  const [mode, setMode] = useState<ViewMode>("diff");
  const [state, setState] = useState<FileLoadState>({ kind: "idle" });

  // Reset the cached file when the file, the ref, or the mode
  // changes. Going from file → diff throws the content away;
  // going back re-fetches.
  useEffect(() => {
    if (mode !== "file" || !commitSha || file.is_binary) return;
    let cancelled = false;
    setState({ kind: "loading" });
    fileContent(repo, commitSha, file.new_path ?? file.old_path ?? "")
      .then((content) => {
        if (cancelled) return;
        if (content == null) setState({ kind: "binary" });
        else setState({ kind: "ok", content });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: parseError(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, repo, commitSha, file.new_path, file.old_path, file.is_binary]);

  // Switching the file (e.g. clicking a different row in the
  // diff list) should reset back to the default diff mode and
  // clear any cached file content.
  useEffect(() => {
    setMode("diff");
    setState({ kind: "idle" });
  }, [file.new_path, file.old_path, file.status]);

  const fileModeDisabled = !commitSha || file.is_binary;
  const fileModeTooltip = !commitSha
    ? "Workdir diffs have no historical version to view"
    : file.is_binary
      ? "Binary file — no syntax-highlighted view"
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] bg-bg-subtle/40 px-3 py-2 shadow-[inset_0-1px_0_rgba(255,255,255,0.04)]">
        <button
          onClick={onBack}
          className="rounded p-1 text-fg-muted transition-colors duration-150 hover:bg-white/[0.04] hover:text-fg"
          title="Back to graph"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
        </button>
        <span className="truncate font-mono text-[12px] text-fg">{path}</span>
        <div className="ml-auto flex items-center gap-2">
          <div
            className="flex items-center overflow-hidden rounded-md border border-white/[0.08]"
            title={
              fileModeDisabled
                ? fileModeTooltip
                : "Toggle between unified diff and the full file at this commit"
            }
          >
            <button
              onClick={() => setMode("diff")}
              className={
                "flex items-center gap-1 px-2 py-1 text-[10px] transition-colors duration-150 " +
                (mode === "diff"
                  ? "bg-white/[0.08] text-fg"
                  : "text-fg-muted hover:text-fg")
              }
            >
              <GitCompare size={10} strokeWidth={1.5} />
              Diff
            </button>
            <button
              disabled={fileModeDisabled}
              onClick={() => setMode("file")}
              className={
                "flex items-center gap-1 border-l border-white/[0.08] px-2 py-1 text-[10px] transition-colors duration-150 " +
                (mode === "file"
                  ? "bg-white/[0.08] text-fg"
                  : "text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-fg-muted")
              }
            >
              <FileCode2 size={10} strokeWidth={1.5} />
              View file
            </button>
          </div>
          <span className="flex gap-2 font-sans text-[11px]">
            <span className="text-success">+{file.additions}</span>
            <span className="text-danger">−{file.deletions}</span>
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-bg">
        {mode === "diff" ? (
          file.is_binary ? (
            <div className="flex h-full items-center justify-center text-[13px] text-fg-muted">
              Binary file — no preview.
            </div>
          ) : (
            <UnifiedDiff patch={file.patch} path={path} />
          )
        ) : state.kind === "loading" || state.kind === "idle" ? (
          <div className="flex h-full items-center justify-center text-[13px] text-fg-muted">
            Loading file…
          </div>
        ) : state.kind === "binary" ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-[13px] text-fg-muted">
            Binary file — no syntax-highlighted view.
          </div>
        ) : state.kind === "error" ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-[13px] text-danger">
            {state.message}
          </div>
        ) : (
          <CodeFileView value={state.content} path={path} />
        )}
      </div>
    </div>
  );
}
