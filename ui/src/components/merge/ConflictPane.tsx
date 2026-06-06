/**
 * ConflictPane — per-file ours/theirs/working resolver, extracted
 * from ConflictEditor.
 *
 * M8 upgrade: the plain `<textarea>` is replaced with a
 * CodeMirror 6 editor (via `CodeFileView`) in editable mode,
 * with the gitsu dark theme and syntax highlighting. Conflict
 * markers (`<<<<<<<` / `=======` / `>>>>>>>`) are decorated
 * in-place via `conflictDecorations` so the user sees the
 * conflict regions as colored blocks rather than plain text.
 *
 * ⌘S / Ctrl-S saves the resolution (calls `onMarkResolved`).
 * The "Mark resolved" button stays as the always-works fallback.
 *
 * A small "unsaved" pill renders in the header when the editor
 * diverges from the file's pre-resolution state (`parts.working`).
 */

import { useMemo } from "react";
import { Check, GitMerge, Loader2 } from "lucide-react";
import type { ConflictParts } from "@/lib/types";
import { CodeFileView } from "@/components/ui/CodeFileView";
import { conflictDecorations } from "@/lib/conflict-decorations";
import { Pill } from "@/components/ui/primitives";

interface ConflictPaneProps {
  selected: string | null;
  parts: ConflictParts | null;
  content: string;
  busy: boolean;
  error: string | null;
  totalResolved: number;
  totalPaths: number;
  onContentChange: (value: string) => void;
  onUseOurs: () => void;
  onUseBase: () => void;
  onUseTheirs: () => void;
  onSkip: () => void;
  onMarkResolved: () => void;
  onCompleteMerge: () => void;
  phase: string;
}

export function ConflictPane({
  selected,
  parts,
  content,
  busy,
  error,
  totalResolved,
  totalPaths,
  onContentChange,
  onUseOurs,
  onUseBase,
  onUseTheirs,
  onSkip,
  onMarkResolved,
  onCompleteMerge,
  phase,
}: ConflictPaneProps) {
  // Dirty = editor content differs from the pre-resolution
  // working file. When the parts load, `content` is set to
  // `parts.working`; any edit (typing or "Use ..." button)
  // diverges from that baseline.
  const dirty = !!parts && content !== (parts.working ?? "");

  const decorations = useMemo(() => conflictDecorations(content), [content]);

  if (error) {
    return (
      <div className="border-b border-warning/20 bg-warning/10 px-3 py-2 text-[11px] text-warning">
        {error}
      </div>
    );
  }

  if (selected && parts) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] bg-bg px-3 py-1.5 text-[11px]">
          <code className="font-mono text-fg">{selected}</code>
          {dirty && (
            <Pill tone="warning" title="You have unsaved changes. ⌘S to mark resolved.">
              unsaved
            </Pill>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={onUseOurs}
              disabled={!parts.ours}
              className="rounded border border-white/[0.08] bg-bg-panel px-2 py-0.5 text-fg-muted hover:border-accent/50 hover:text-fg disabled:opacity-50 transition-colors duration-150"
            >
              Use ours
            </button>
            <button
              onClick={onUseBase}
              disabled={parts.base === null || parts.base === undefined}
              className="rounded border border-white/[0.08] bg-bg-panel px-2 py-0.5 text-fg-muted hover:border-accent/50 hover:text-fg disabled:opacity-50 transition-colors duration-150"
            >
              Use base
            </button>
            <button
              onClick={onUseTheirs}
              disabled={!parts.theirs}
              className="rounded border border-white/[0.08] bg-bg-panel px-2 py-0.5 text-fg-muted hover:border-accent/50 hover:text-fg disabled:opacity-50 transition-colors duration-150"
            >
              Use theirs
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <CodeFileView
            value={content}
            path={selected}
            onChange={onContentChange}
            onSave={() => {
              // ⌘S / Ctrl-S → mark the file as resolved using the
              // current editor content. The store's markResolved
              // closure already reads `content` from state, so we
              // don't need to pass the value through; we just
              // kick the action.
              void onMarkResolved();
            }}
            decorations={decorations}
            className="h-full"
          />
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-white/[0.06] bg-bg px-3 py-2">
          <span className="text-[11px] text-fg-muted">
            {totalResolved}/{totalResolved + totalPaths} resolved
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onSkip}
              disabled={totalPaths <= 1}
              className="rounded-md border border-white/[0.08] bg-bg-panel px-2 py-1 text-[11px] text-fg-muted hover:text-fg disabled:opacity-50 transition-colors duration-150"
            >
              Skip
            </button>
            <button
              onClick={onMarkResolved}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] text-white hover:bg-accent-hover disabled:opacity-50 transition-colors duration-150"
            >
              {busy ? (
                <Loader2 size={11} className="animate-spin" strokeWidth={1.5} />
              ) : (
                <Check size={11} strokeWidth={1.5} />
              )}
              Mark resolved
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (totalPaths === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-fg-muted">
        <Check size={28} className="text-success" strokeWidth={1.5} />
        <p className="text-[13px]">All conflicts resolved.</p>
        <button
          onClick={onCompleteMerge}
          disabled={phase === "running"}
          className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-[11px] text-white hover:bg-accent-hover disabled:opacity-50 transition-colors duration-150"
        >
          {phase === "running" ? (
            <Loader2 size={11} className="animate-spin" strokeWidth={1.5} />
          ) : (
            <GitMerge size={11} strokeWidth={1.5} />
          )}
          Complete merge
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center text-fg-muted">
      <Loader2 size={16} className="mr-2 animate-spin" strokeWidth={1.5} />
      <span className="text-[13px]">Loading…</span>
    </div>
  );
}
