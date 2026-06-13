/**
 * CommitComposer — the left-pane staging panel for the graph view.
 *
 * Appears (below the worktree list) whenever the active worktree has
 * uncommitted changes. Two groups — Staged / Changes — with per-file
 * stage/unstage toggles, group-level "all" actions, a commit message
 * box, and the Commit button. Committing solidifies the graph's
 * pending working-tree node into a real commit (the staging store
 * refreshes the worktree poll + graph after `git_commit`).
 *
 * Clicking the pending node in the graph focuses the message box
 * (via the store's `focusToken`).
 */

import { useEffect, useMemo, useRef } from "react";
import { GitCommit, Loader2, AlertCircle } from "lucide-react";
import { useStagingStore } from "@/stores/staging";
import { useStagingSync } from "@/hooks/useStagingSync";
import { ComposerFileRow } from "./ComposerFileRow";

export function CommitComposer() {
  const { activePath, hasUncommitted } = useStagingSync();
  const entries = useStagingStore((s) => s.entries);
  const message = useStagingStore((s) => s.message);
  const error = useStagingStore((s) => s.error);
  const committing = useStagingStore((s) => s.committing);
  const focusToken = useStagingStore((s) => s.focusToken);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The pending graph node requests focus when clicked.
  useEffect(() => {
    if (focusToken > 0) textareaRef.current?.focus();
  }, [focusToken]);

  const staged = useMemo(() => entries.filter((e) => e.staged !== null), [entries]);
  const unstaged = useMemo(() => entries.filter((e) => e.unstaged !== null), [entries]);

  if (!activePath || (!hasUncommitted && entries.length === 0)) return null;

  const { stage, unstage, stageAll, unstageAll, setMessage, commit } = useStagingStore.getState();
  const canCommit = staged.length > 0 && message.trim().length > 0 && !committing;

  return (
    <section className="flex max-h-[60%] shrink-0 flex-col border-t border-white/[0.06]">
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Changes
        </h2>
        <span className="text-[11px] text-fg-muted">{entries.length}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <Group
          label="Unstaged"
          count={unstaged.length}
          action={unstaged.length > 0 ? { label: "Stage all", run: stageAll } : null}
        >
          {unstaged.map((e) => (
            <ComposerFileRow
              key={`u-${e.path}`}
              entry={e}
              side="unstaged"
              disabled={committing}
              onToggle={() => void stage(e.path)}
            />
          ))}
        </Group>

        <div className="mx-1 rounded-md border border-white/[0.06] bg-white/[0.03] p-2">
          <div className="flex items-center justify-between pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Staged · {staged.length}
            </span>
            {staged.length > 0 && (
              <button
                className="text-[10px] text-fg-muted hover:text-fg transition-colors duration-150"
                onClick={() => void unstageAll()}
              >
                Unstage all
              </button>
            )}
          </div>
          {staged.length > 0 ? (
            <ul className="flex flex-col">
              {staged.map((e) => (
                <ComposerFileRow
                  key={`s-${e.path}`}
                  entry={e}
                  side="staged"
                  disabled={committing}
                  onToggle={() => void unstage(e.path)}
                />
              ))}
            </ul>
          ) : (
            <p className="py-1 text-[11px] italic text-fg-subtle">
              No staged files
            </p>
          )}
        </div>
      </div>

      <footer className="flex flex-col gap-2 border-t border-white/[0.06] p-3">
        {error && (
          <p className="flex items-start gap-1.5 text-[11px] text-danger">
            <AlertCircle size={12} className="mt-0.5 shrink-0" strokeWidth={1.5} />
            <span>{error}</span>
          </p>
        )}
        <textarea
          ref={textareaRef}
          className="input min-h-[52px] resize-none font-sans"
          placeholder="Commit message"
          value={message}
          disabled={committing}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCommit) {
              e.preventDefault();
              void commit();
            }
          }}
        />
        <button
          className="btn-primary justify-center"
          disabled={!canCommit}
          onClick={() => void commit()}
          title={
            staged.length === 0
              ? "Stage files to commit"
              : "Commit staged files (⌘⏎)"
          }
        >
          {committing ? (
            <Loader2 size={13} className="animate-spin" strokeWidth={1.5} />
          ) : (
            <GitCommit size={13} strokeWidth={1.5} />
          )}
          Commit {staged.length > 0 ? `${staged.length} file${staged.length === 1 ? "" : "s"}` : ""}
        </button>
      </footer>
    </section>
  );
}

function Group({
  label,
  count,
  action,
  children,
}: {
  label: string;
  count: number;
  action: { label: string; run: () => Promise<void> } | null;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-2 pb-1 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          {label} · {count}
        </span>
        {action && (
          <button
            className="text-[10px] text-fg-muted hover:text-fg transition-colors duration-150"
            onClick={() => void action.run()}
          >
            {action.label}
          </button>
        )}
      </div>
      <ul className="flex h-48 flex-col overflow-y-auto">{children}</ul>
    </div>
  );
}
