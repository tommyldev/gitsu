/**
 * MergeDialog (M7) — the worktree-first merge workflow.
 *
 * Three states the user sees:
 *  1. **Preview** — what's about to happen (fast-forward? conflicts?).
 *  2. **Running** — `wt merge` in flight, progress shown.
 * 3. **Done / Error** — result. `wt merge` removes the worktree by
 *     default; gitsu shows a confirmation banner, not a cleanup card.
 *
 * For v1, conflicts are reported but editing is deferred to M8
 * (the 3-pane merge editor). The user can fall back to the CLI via
 * the "Open in terminal" button (or a "use external mergetool" stub).
 */

import { useEffect } from "react";
import { ArrowRight, GitMerge, X } from "lucide-react";
import { useMergeStore } from "@/stores/merge";
import { Body } from "./MergeViews";
import { Footer } from "./MergeFooter";

export function MergeDialog() {
  const phase = useMergeStore((s) => s.phase);
  const context = useMergeStore((s) => s.context);
  const close = useMergeStore((s) => s.close);
  const runMerge = useMergeStore((s) => s.runMerge);
  const runPreview = useMergeStore((s) => s.runPreview);

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
            Finish{" "}
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

        <Footer
          onFinish={() => runMerge({})}
          onFinishKeepWorktree={() => runMerge({ noRemove: true })}
        />
      </div>
    </div>
  );
}

