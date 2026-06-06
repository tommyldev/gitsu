/**
 * ConflictEditor (M8) — the visual side of merge-conflict resolution.
 *
 * Layout (v1):
 * - Left: file list with status pills (unresolved / staged)
 * - Right: textarea with the working file (conflict markers in place)
 *   + action buttons ("Use ours entirely", "Use theirs entirely",
 *   "Mark resolved")
 *
 * The actual staging happens through `merge_stage_resolution`. The
 * editor is a thin client over that command.
 *
 * Per-hunk resolution is deferred to M8.5 (a richer CodeMirror-based
 * editor with side-by-side ours/theirs). For now, the user can
 * either edit the markers out manually or take a whole side.
 */

import { AlertCircle, ArrowRight, GitMerge, Loader2, X } from "lucide-react";
import { useMergeStore } from "@/stores/merge";
import { ConflictFileList } from "./ConflictFileList";
import { ConflictPane } from "./ConflictPane";
import { useConflictResolver } from "./useConflictResolver";
import clsx from "clsx";

function Button({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "rounded-md px-3 py-1.5 text-[11px] transition-colors duration-150",
        primary
          ? "flex items-center gap-1.5 bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          : "text-fg-muted hover:text-fg",
        disabled && !primary && "opacity-50",
      )}
    >
      {children}
    </button>
  );
}

export function ConflictEditor() {
  const context = useMergeStore((s) => s.context);
  const result = useMergeStore((s) => s.result);
  const phase = useMergeStore((s) => s.phase);
  const close = useMergeStore((s) => s.close);

  const {
    paths,
    selected,
    parts,
    content,
    busy,
    error,
    resolved,
    setSelected,
    setContent,
    markResolved,
    useOurs,
    useTheirs,
    useBase,
    completeMerge,
  } = useConflictResolver();

  const allResolved = paths.length > 0 && resolved.size === paths.length;

  if (!context) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-panel flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
        style={{
          animation: "modal-scale 200ms cubic-bezier(0.25, 0.1, 0.25, 1.0) forwards",
        }}
      >
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
            <GitMerge size={16} className="text-accent" strokeWidth={1.5} />
            Resolve conflicts
            <code className="font-mono text-accent">{context.sourceBranch}</code>
            <ArrowRight size={12} className="text-fg-muted" strokeWidth={1.5} />
            <code className="font-mono text-accent">{context.targetBranch}</code>
          </h2>
          <button onClick={close} className="rounded p-1 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <ConflictFileList
            paths={paths}
            selected={selected}
            resolved={resolved}
            onSelect={setSelected}
          />

          <main className="flex flex-1 flex-col overflow-hidden">
            {error && (
              <div className="border-b border-warning/20 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                {error}
              </div>
            )}
            <ConflictPane
              selected={selected}
              parts={parts}
              content={content}
              busy={busy}
              error={null}
              totalResolved={resolved.size}
              totalPaths={paths.length}
              onContentChange={setContent}
              onUseOurs={useOurs}
              onUseBase={useBase}
              onUseTheirs={useTheirs}
              onSkip={() =>
                setSelected(paths[paths.indexOf(selected ?? "") + 1] ?? null)
              }
              onMarkResolved={markResolved}
              onCompleteMerge={completeMerge}
              phase={phase}
            />
          </main>
        </div>

        {paths.length > 0 && (
          <footer className="flex shrink-0 items-center justify-between border-t border-white/[0.06] px-4 py-2">
            <span className="text-[11px] text-fg-muted">
              {allResolved
                ? "All files resolved. Complete the merge to commit."
                : `Resolve ${paths.length} more file${paths.length === 1 ? "" : "s"} before continuing.`}
            </span>
            <div className="flex items-center gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button
                onClick={completeMerge}
                disabled={!allResolved || phase === "running"}
                primary
              >
                {phase === "running" ? (
                  <Loader2 size={11} className="animate-spin" strokeWidth={1.5} />
                ) : (
                  <GitMerge size={11} strokeWidth={1.5} />
                )}
                Complete merge
              </Button>
            </div>
          </footer>
        )}

        {result && result.conflicts.length > 0 && (
          <div className="m-3 mt-0 flex items-start gap-2 rounded-md border border-danger/20 bg-danger/10 p-3 text-[11px] text-danger">
            <AlertCircle size={14} className="mt-0.5 shrink-0" strokeWidth={1.5} />
            <span>
              <code className="font-mono">wt merge</code> reported
              {` ${result.conflicts.length}`} additional conflicts. Open a
              terminal and run <code className="font-mono">git status</code> for the full list.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
