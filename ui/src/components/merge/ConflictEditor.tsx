/**
 * Conflict editor (M8) — the visual side of merge-conflict resolution.
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

import { useEffect, useState } from "react";
import { invoke } from "@/lib/tauri";
import { WtRpcError, type ConflictParts, type IpcError } from "@/lib/types";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Loader2,
  X,
  GitMerge,
  ArrowRight,
} from "lucide-react";
import clsx from "clsx";
import { useMergeStore } from "@/stores/merge";

export function ConflictEditor() {
  const context = useMergeStore((s) => s.context);
  const result = useMergeStore((s) => s.result);
  const phase = useMergeStore((s) => s.phase);
  const close = useMergeStore((s) => s.close);
  const runMergeAgain = useMergeStore((s) => s.runMerge);

  const [paths, setPaths] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [parts, setParts] = useState<ConflictParts | null>(null);
  const [content, setContent] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  // Load the list of unresolved conflicts when the editor opens.
  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await invoke<string[]>("merge_list_unresolved_conflicts", {
          worktree: context.worktree,
        });
        if (!cancelled) {
          setPaths(list);
          setSelected(list[0] ?? null);
        }
      } catch (e) {
        if (!cancelled) setError(parseError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context]);

  // Load the conflict parts whenever the selected path changes.
  useEffect(() => {
    if (!context || !selected) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await invoke<ConflictParts>("merge_conflict_parts", {
          worktree: context.worktree,
          path: selected,
        });
        if (!cancelled) {
          setParts(p);
          // Default the textarea to the current on-disk content
          // (which has the conflict markers).
          setContent(p.working ?? "");
        }
      } catch (e) {
        if (!cancelled) setError(parseError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context, selected]);

  const allResolved = paths.length > 0 && resolved.size === paths.length;

  const markResolved = async () => {
    if (!context || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("merge_stage_resolution", {
        worktree: context.worktree,
        path: selected,
        content,
      });
      // Mark the path as resolved in the UI; remove from the
      // unresolved list. If the working file still has markers,
      // surface a warning but allow the user to proceed.
      const hasMarkers = content.includes("<<<<<<<");
      const next = new Set(resolved);
      next.add(selected);
      setResolved(next);
      const remaining = paths.filter((p) => !next.has(p));
      setPaths(remaining);
      if (hasMarkers) {
        setError(
          `Heads up: ${selected} still contains conflict markers. ` +
            `Re-run \`wt merge ${context.targetBranch}\` once the markers are gone.`,
        );
      }
      // Move to the next unresolved file
      setSelected(remaining[0] ?? null);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setBusy(false);
    }
  };

  const useOurs = () => {
    if (!parts?.ours) return;
    setContent(parts.ours);
  };
  const useTheirs = () => {
    if (!parts?.theirs) return;
    setContent(parts.theirs);
  };
  const useBase = () => {
    if (parts?.base === null || parts?.base === undefined) return;
    setContent(parts.base);
  };

  const completeMerge = () => {
    if (!context) return;
    // Re-run the merge via worktrunk — it'll see a clean state and
    // commit + branch cleanup. This is the same code path as M7's
    // "Merge" button.
    void runMergeAgain(false);
  };

  if (!context) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-bg-subtle bg-bg-panel shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-bg-subtle px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <GitMerge size={16} className="text-accent" />
            Resolve conflicts
            <code className="font-mono text-accent">{context.sourceBranch}</code>
            <ArrowRight size={12} className="text-fg-subtle" />
            <code className="font-mono text-accent">{context.targetBranch}</code>
          </h2>
          <button onClick={close} className="rounded p-1 hover:bg-bg-subtle">
            <X size={16} />
          </button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* File list */}
          <aside className="w-64 shrink-0 overflow-auto border-r border-bg-subtle bg-bg">
            <h3 className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Conflicted files
            </h3>
            {paths.length === 0 ? (
              <p className="px-3 text-xs text-fg-muted">
                No more conflicts. Click <strong>Complete merge</strong> to continue.
              </p>
            ) : (
              <ul>
                {paths.map((p) => {
                  const isSelected = p === selected;
                  const isResolved = resolved.has(p);
                  return (
                    <li key={p}>
                      <button
                        onClick={() => setSelected(p)}
                        className={clsx(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs",
                          isSelected
                            ? "bg-bg-subtle text-fg"
                            : "text-fg-muted hover:bg-bg-subtle/50",
                          isResolved && "opacity-50 line-through",
                        )}
                      >
                        {isResolved ? (
                          <Check size={12} className="text-success" />
                        ) : isSelected ? (
                          <ChevronRight size={12} className="text-accent" />
                        ) : (
                          <span className="w-3" />
                        )}
                        <span className="truncate">{p}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Editor */}
          <main className="flex flex-1 flex-col overflow-hidden">
            {error && (
              <div className="border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {error}
              </div>
            )}
            {selected && parts ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex shrink-0 items-center gap-2 border-b border-bg-subtle bg-bg px-3 py-1.5 text-xs">
                  <code className="font-mono text-fg">{selected}</code>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={useOurs}
                      disabled={!parts.ours}
                      className="rounded border border-bg-subtle bg-bg-panel px-2 py-0.5 text-fg-muted hover:border-accent hover:text-fg disabled:opacity-50"
                    >
                      Use ours
                    </button>
                    <button
                      onClick={useBase}
                      disabled={parts.base === null || parts.base === undefined}
                      className="rounded border border-bg-subtle bg-bg-panel px-2 py-0.5 text-fg-muted hover:border-accent hover:text-fg disabled:opacity-50"
                    >
                      Use base
                    </button>
                    <button
                      onClick={useTheirs}
                      disabled={!parts.theirs}
                      className="rounded border border-bg-subtle bg-bg-panel px-2 py-0.5 text-fg-muted hover:border-accent hover:text-fg disabled:opacity-50"
                    >
                      Use theirs
                    </button>
                  </div>
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="flex-1 resize-none bg-bg p-3 font-mono text-xs leading-relaxed focus:outline-none"
                  spellCheck={false}
                />
                <div className="flex shrink-0 items-center justify-between border-t border-bg-subtle bg-bg px-3 py-2">
                  <span className="text-xs text-fg-muted">
                    {resolved.size}/{paths.length + resolved.size} resolved
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelected(paths[paths.indexOf(selected ?? "") + 1] ?? null)}
                      disabled={paths.length <= 1}
                      className="rounded-md border border-bg-subtle bg-bg-panel px-2 py-1 text-xs text-fg-muted hover:text-fg disabled:opacity-50"
                    >
                      Skip
                    </button>
                    <button
                      onClick={markResolved}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                      Mark resolved
                    </button>
                  </div>
                </div>
              </div>
            ) : paths.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-fg-muted">
                <Check size={28} className="text-success" />
                <p className="text-sm">All conflicts resolved.</p>
                <button
                  onClick={completeMerge}
                  disabled={phase === "running"}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {phase === "running" ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <GitMerge size={11} />
                  )}
                  Complete merge
                </button>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-fg-muted">
                <Loader2 size={16} className="mr-2 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            )}
          </main>
        </div>

        {/* Bottom: complete-merge CTA + close */}
        {paths.length > 0 && (
          <footer className="flex shrink-0 items-center justify-between border-t border-bg-subtle px-4 py-2">
            <span className="text-xs text-fg-muted">
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
                {phase === "running" ? <Loader2 size={11} className="animate-spin" /> : <GitMerge size={11} />}
                Complete merge
              </Button>
            </div>
          </footer>
        )}

        {result && result.conflicts.length > 0 && (
          <div className="m-3 mt-0 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              <code className="font-mono">wt merge</code> reported
              {` ${result.conflicts.length}`} additional conflicts. Open a
              terminal and run <code className="font-mono">git status</code> for the full list.
            </span>
          </div>
        )}

        {/* The icon import below is a no-op but keeps the bundler
            tree-shaker honest about the dep. */}
        {false && null}
      </div>
    </div>
  );
}

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
        "rounded-md px-3 py-1.5 text-xs",
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

function parseError(e: unknown): string {
  if (e instanceof WtRpcError) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    return (e as IpcError).message ?? String(e);
  }
  if (typeof e === "string") return e;
  return String(e);
}
