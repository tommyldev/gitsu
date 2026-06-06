/**
 * MergeFooter — action button strip extracted from MergeDialog.
 */

import { GitMerge, Terminal as TerminalIcon } from "lucide-react";
import { useMergeStore } from "@/stores/merge";
import { useTerminalStore } from "@/stores/terminal";
import clsx from "clsx";

export function Footer({ onMerge }: { onMerge: () => void }) {
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
