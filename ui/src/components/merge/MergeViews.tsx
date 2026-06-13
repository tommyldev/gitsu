/**
 * MergeViews — per-phase view bodies extracted from MergeDialog.
 */

import { useState } from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  Terminal as TerminalIcon,
} from "lucide-react";
import { useMergeStore } from "@/stores/merge";
import { useTerminalStore } from "@/stores/terminal";
import { type MergePreview } from "@/lib/types";

// ─── Body ─────────────────────────────────────────────────────────────────

export function Body() {
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
    const context = useMergeStore((s) => s.context);
    const ensurePane = useTerminalStore((s) => s.ensurePane);
    return (
      <div className="m-4 flex flex-col gap-3">
        <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger/10 p-3 text-[13px] text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
          <span>{error}</span>
        </div>
        {context && (
          <button
            onClick={() => void ensurePane(context.worktree)}
            className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-bg px-3 py-1.5 text-[11px] text-fg-muted hover:border-accent/50 hover:text-fg transition-colors duration-150"
          >
            <TerminalIcon size={12} strokeWidth={1.5} /> Open terminal
          </button>
        )}
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

// ─── PreviewView ───────────────────────────────────────────────────────────

function PreviewView({ preview }: { preview: MergePreview }) {
  const hasConflicts = preview.conflict_files.length > 0;
  const isSimpleFF = preview.can_fast_forward && preview.conflict_files.length === 0;
  const [showFiles, setShowFiles] = useState(false);
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

      {/* Impact sentence */}
      <p className="mb-3 text-[13px] text-fg">
        {preview.ahead > 0 ? (
          <>
            {preview.ahead} commit{preview.ahead === 1 ? "" : "s"} will be{" "}
            {preview.can_fast_forward ? "fast-forwarded" : "merged"} into{" "}
            <code className="font-mono text-accent">{preview.target_branch}</code>. The worktree will be removed.
          </>
        ) : preview.ahead === 0 && preview.behind === 0 ? (
          "Both branches are at the same commit. Nothing to do."
        ) : (
          <>
            Branch is {preview.behind} behind{" "}
            <code className="font-mono text-accent">{preview.target_branch}</code>. Consider pulling first.
          </>
        )}
      </p>

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

      {/* Clean files — hidden by default for simple fast-forwards, always
          shown for non-FF / conflict cases. */}
      {preview.clean_files.length > 0 && !isSimpleFF && (
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

      {isSimpleFF && preview.clean_files.length > 0 && showFiles && (
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

      {isSimpleFF && preview.clean_files.length > 0 && !showFiles && (
        <button
          onClick={() => setShowFiles(true)}
          className="mb-3 text-[11px] text-accent hover:text-accent-hover transition-colors duration-150"
        >
          Show {preview.clean_files.length} changed file
          {preview.clean_files.length === 1 ? "" : "s"}
        </button>
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

// ─── ConflictResult ─────────────────────────────────────────────────────────

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

// ─── SuccessResult ─────────────────────────────────────────────────────────

function SuccessResult() {
  const result = useMergeStore((s) => s.result);
  return (
    <div className="m-4 flex flex-col gap-2">
      <div className="flex items-start gap-2 rounded-md border border-success/20 bg-success/10 p-3 text-[13px] text-success">
        <Check size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
        <div>
          <p><strong>Merge complete.</strong></p>
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
      <p className="text-[11px] text-fg-muted">
        Worktree removed. The dashboard will refresh automatically.
      </p>
    </div>
  );
}
