/**
 * MergeDialog (M7) — the worktree-first merge workflow.
 *
 * Three states the user sees:
 *  1. **Preview** — what's about to happen (fast-forward? conflicts?).
 *  2. **Running** — `wt merge` in flight, progress shown.
 *  3. **Done / Error** — result, with optional "remove the worktree"
 *     cleanup prompt on success.
 *
 * For v1, conflicts are reported but editing is deferred to M8
 * (the 3-pane merge editor). The user can fall back to the CLI via
 * the "Open in terminal" button (or a "use external mergetool" stub).
 */

import { useEffect, useState } from "react";
import { invoke } from "@/lib/tauri";
import {
  AlertCircle,
  ArrowRight,
  Check,
  GitMerge,
  Loader2,
  X,
  Trash2,
  Terminal as TerminalIcon,
} from "lucide-react";
import { useMergeStore } from "@/stores/merge";
import { useRepoStore } from "@/stores/repo";
import { useTerminalStore } from "@/stores/terminal";
import { useGraphStore } from "@/stores/graph";
import { WtRpcError, type IpcError, type RemoveResult } from "@/lib/types";
import clsx from "clsx";

export function MergeDialog() {
  const phase = useMergeStore((s) => s.phase);
  const context = useMergeStore((s) => s.context);
  const close = useMergeStore((s) => s.close);
  const runMerge = useMergeStore((s) => s.runMerge);
  const runPreview = useMergeStore((s) => s.runPreview);

  // Re-run the preview when the source or target changes.
  useEffect(() => {
    if (phase === "previewing" && context) {
      void runPreview();
    }
  }, [phase, context, runPreview]);

  if (phase === "idle" || !context) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-panel flex w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
        style={{
          animation: "modal-scale 200ms cubic-bezier(0.25, 0.1, 0.25, 1.0) forwards",
        }}
      >
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
            <GitMerge size={16} className="text-accent" strokeWidth={1.5} />
            Merge{" "}
            <code className="font-mono text-accent">{context.sourceBranch}</code>{" "}
            <ArrowRight size={12} className="text-fg-muted" strokeWidth={1.5} />{" "}
            <code className="font-mono text-accent">{context.targetBranch}</code>
          </h2>
          <button onClick={close} className="rounded p-1 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <div className="px-5 py-2 text-[11px] text-fg-muted">
          <code className="font-mono text-fg-muted">{context.worktree}</code>
        </div>

        <Body />

        <Footer onMerge={() => runMerge(false)} />
      </div>
    </div>
  );
}

function Body() {
  const phase = useMergeStore((s) => s.phase);
  const preview = useMergeStore((s) => s.preview);
  const result = useMergeStore((s) => s.result);
  const error = useMergeStore((s) => s.error);

  if (phase === "previewing") {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-10 text-fg-muted">
        <Loader2 size={14} className="animate-spin" strokeWidth={1.5} />
        <span className="text-[13px]">Computing merge preview…</span>
      </div>
    );
  }

  if (phase === "error" && error) {
    return (
      <div className="m-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger/10 p-3 text-[13px] text-danger">
        <AlertCircle size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
        <span>{error}</span>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-fg-muted">
        <Loader2 size={20} className="animate-spin text-accent" strokeWidth={1.5} />
        <p className="text-[13px]">
          Running <code className="font-mono">wt merge</code>…
        </p>
        <p className="text-[11px]">
          Worktrunk will rebase, squash, and commit on{" "}
          <code className="font-mono">{useMergeStore.getState().context?.targetBranch}</code>.
        </p>
      </div>
    );
  }

  if (phase === "done" && result) {
    if (result.conflicts.length > 0) {
      return <ConflictResult conflicts={result.conflicts} />;
    }
    return <SuccessResult />;
  }

  if (!preview) {
    return (
      <div className="px-4 py-6 text-[13px] text-fg-muted">No preview available.</div>
    );
  }

  return <PreviewView preview={preview} />;
}

function PreviewView({
  preview,
}: {
  preview: NonNullable<ReturnType<typeof useMergeStore.getState>["preview"] >;
}) {
  const hasConflicts = preview.conflict_files.length > 0;
  return (
    <div className="max-h-[60vh] overflow-auto px-5 py-3">
      {/* Summary badges */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
        {preview.can_fast_forward ? (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-success">
            Fast-forward
          </span>
        ) : preview.ahead === 0 && preview.behind === 0 ? (
          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-fg-muted">
            Up to date
          </span>
        ) : (
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
            Merge commit
          </span>
        )}
        <span className="text-fg-muted">
          {preview.ahead} ahead · {preview.behind} behind
        </span>
      </div>

      {hasConflicts && (
        <div className="mb-3 rounded-md border border-danger/20 bg-danger/10 p-3">
          <p className="text-[13px] font-medium text-danger">
            {preview.conflict_files.length} conflict
            {preview.conflict_files.length === 1 ? "" : "s"} block the merge.
          </p>
          <p className="mt-1 text-[11px] text-fg-muted">
            Resolve the conflicts in a terminal or external mergetool
            (gitsu's 3-pane conflict editor lands in M8). Once resolved, run{" "}
            <code className="font-mono">wt merge</code> again.
          </p>
        </div>
      )}

      {!hasConflicts && preview.clean_files.length === 0 && preview.ahead === 0 && preview.behind === 0 && (
        <p className="text-[13px] text-fg-muted">
          The two branches are at the same commit. Nothing to do.
        </p>
      )}

      {preview.clean_files.length > 0 && (
        <section className="mb-3">
          <h3 className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted">
            Files that would change ({preview.clean_files.length})
          </h3>
          <ul className="max-h-32 overflow-auto rounded-md border border-white/[0.06] bg-bg p-2 font-mono text-[11px]">
            {preview.clean_files.map((p) => (
              <li key={p} className="px-1.5 py-0.5 text-fg-muted">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasConflicts && (
        <section>
          <h3 className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted">
            Conflicting files
          </h3>
          <ul className="max-h-32 overflow-auto rounded-md border border-danger/20 bg-danger/5 p-2 font-mono text-[11px]">
            {preview.conflict_files.map((p) => (
              <li key={p} className="px-1.5 py-0.5 text-danger">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ConflictResult({ conflicts }: { conflicts: string[] }) {
  const ensurePane = useTerminalStore((s) => s.ensurePane);
  const context = useMergeStore((s) => s.context);
  const enterResolving = useMergeStore((s) => s.enterResolving);

  return (
    <div className="m-4 flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger/10 p-3 text-[13px] text-danger">
        <AlertCircle size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
        <div>
          <p>
            <strong>Merge halted.</strong> {conflicts.length} file
            {conflicts.length === 1 ? "" : "s"} conflict.
          </p>
          <p className="mt-1 text-[11px]">
            Use gitsu's conflict editor to resolve them, or open a terminal
            for the manual route.
          </p>
        </div>
      </div>
      <ul className="max-h-32 overflow-auto rounded-md border border-white/[0.06] bg-bg p-2 font-mono text-[11px]">
        {conflicts.map((p) => (
          <li key={p} className="px-1.5 py-0.5 text-fg-muted">
            {p}
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => context && void ensurePane(context.worktree)}
          className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-bg px-3 py-1.5 text-[11px] text-fg-muted hover:border-accent/50 hover:text-fg transition-colors duration-150"
        >
          <TerminalIcon size={12} strokeWidth={1.5} /> Open terminal
        </button>
        <button
          onClick={enterResolving}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] text-white hover:bg-accent-hover transition-colors duration-150"
        >
          Open conflict editor
        </button>
      </div>
    </div>
  );
}

function SuccessResult() {
  const result = useMergeStore((s) => s.result);
  const context = useMergeStore((s) => s.context);
  const close = useMergeStore((s) => s.close);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  const removeWorktree = async () => {
    if (!context || !result) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await invoke<RemoveResult>("wt_remove", {
        repo: context.worktree,
        branch: context.sourceBranch,
        deleteBranch: true,
        force: false,
      });
      // Refresh upstream data so the UI reflects the change.
      void useRepoStore.getState().refresh();
      void useGraphStore.getState().fetch(context.worktree);
      setRemoved(true);
    } catch (e) {
      setRemoveError(parseError(e));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="m-4 flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-md border border-success/20 bg-success/10 p-3 text-[13px] text-success">
        <Check size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
        <div>
          <p>
            <strong>Merge complete.</strong>
          </p>
          {result?.commit && (
            <p className="mt-0.5 text-[11px] text-fg-muted">
              New commit <code className="font-mono">{result.commit.slice(0, 7)}</code> on{" "}
              <code className="font-mono">{result.target}</code>.
            </p>
          )}
          {result?.message && (
            <p className="mt-1 text-[11px] text-fg-muted">{result.message}</p>
          )}
        </div>
      </div>

      {removed ? (
        <p className="text-[11px] text-fg-muted">
          Worktree removed. Refresh to see the updated list.
        </p>
      ) : (
        <div className="rounded-md border border-white/[0.06] bg-bg p-3">
          <p className="text-[13px]">
            Clean up the source worktree?
          </p>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            Removes <code className="font-mono">{context?.sourceBranch}</code> worktree and
            the branch.
          </p>
          {removeError && (
            <p className="mt-2 text-[11px] text-danger">{removeError}</p>
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={close}
              className="rounded-md border border-white/[0.08] bg-bg-panel px-3 py-1.5 text-[11px] hover:border-white/[0.12] transition-colors duration-150"
            >
              Keep worktree
            </button>
            <button
              onClick={removeWorktree}
              disabled={removing}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] text-white hover:bg-accent-hover disabled:opacity-50 transition-colors duration-150"
            >
              {removing ? <Loader2 size={11} className="animate-spin" strokeWidth={1.5} /> : <Trash2 size={11} strokeWidth={1.5} />}
              Remove worktree + branch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Footer({ onMerge }: { onMerge: () => void }) {
  const phase = useMergeStore((s) => s.phase);
  const preview = useMergeStore((s) => s.preview);
  const result = useMergeStore((s) => s.result);
  const close = useMergeStore((s) => s.close);
  const ensurePane = useTerminalStore((s) => s.ensurePane);
  const context = useMergeStore((s) => s.context);

  const canMerge =
    phase === "ready" &&
    preview !== null &&
    preview.conflict_files.length === 0 &&
    !(preview.ahead === 0 && preview.behind === 0);

  return (
    <footer className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-5 py-3">
      <div>
        {context && phase === "ready" && (
          <button
            onClick={() => void ensurePane(context.worktree)}
            className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-bg px-2 py-1 text-[11px] text-fg-muted hover:border-accent/50 hover:text-fg transition-colors duration-150"
          >
            <TerminalIcon size={11} strokeWidth={1.5} /> Open terminal
          </button>
        )}
        {result && result.conflicts.length > 0 && (
          <button
          onClick={() => context && void ensurePane(context.worktree)}
            className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-bg px-2 py-1 text-[11px] text-fg-muted hover:border-accent/50 hover:text-fg transition-colors duration-150"
          >
            <TerminalIcon size={11} strokeWidth={1.5} /> Open terminal
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={close}
          className={clsx(
            "rounded-md px-3 py-1.5 text-[11px] transition-colors duration-150",
            phase === "done"
              ? "bg-white/[0.05] text-fg hover:bg-white/[0.08]"
              : "border border-white/[0.08] bg-bg-panel text-fg-muted hover:text-fg",
          )}
        >
          {phase === "done" ? "Close" : "Cancel"}
        </button>
        {phase === "ready" && (
          <button
            onClick={onMerge}
            disabled={!canMerge}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] text-white hover:bg-accent-hover disabled:opacity-50 transition-colors duration-150"
          >
            <GitMerge size={11} strokeWidth={1.5} /> Merge
          </button>
        )}
      </div>
    </footer>
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
