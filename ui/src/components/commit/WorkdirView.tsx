/**
 * WorkdirView — the staging/working-tree view inside `CommitComposer`.
 *
 * Owns no state of its own; receives everything it needs as props so
 * the parent (CommitComposer) keeps the multi-select, focus, and
 * staging-store wiring in one place. This split keeps CommitComposer
 * under the file-size cap without forking the state ownership.
 */

import type React from "react";
import { GitCommit, Loader2, AlertCircle } from "lucide-react";
import type { StatusEntry } from "@/lib/types";
import { ComposerFileRow } from "./ComposerFileRow";
import { Group } from "./ComposerGroup";
import { FileContextMenu, type FileMenuTarget } from "./FileContextMenu";

export function WorkdirView({
  entries,
  staged,
  unstaged,
  message,
  error,
  committing,
  canCommit,
  selectedPaths,
  textareaRef,
  onMessageChange,
  onCommit,
  onStageAll,
  onUnstageAll,
  onRowClick,
  onShiftClick,
  onRightClick,
  contextMenu,
  onCloseContextMenu,
}: {
  entries: StatusEntry[];
  staged: StatusEntry[];
  unstaged: StatusEntry[];
  message: string;
  error: string | null;
  committing: boolean;
  canCommit: boolean;
  selectedPaths: Set<string>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onMessageChange: (m: string) => void;
  onCommit: () => void;
  onStageAll: () => Promise<void>;
  onUnstageAll: () => Promise<void>;
  onRowClick: (path: string, side: "staged" | "unstaged") => void;
  onShiftClick: (path: string) => void;
  onRightClick: (
    path: string,
    side: "staged" | "unstaged",
    e: React.MouseEvent,
  ) => void;
  contextMenu: FileMenuTarget | null;
  onCloseContextMenu: () => void;
}) {
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
          action={unstaged.length > 0 ? { label: "Stage all", run: onStageAll } : null}
        >
          {unstaged.map((e) => (
            <ComposerFileRow
              key={`u-${e.path}`}
              entry={e}
              side="unstaged"
              disabled={committing}
              selected={selectedPaths.has(e.path)}
              onToggle={() => onRowClick(e.path, "unstaged")}
              onShiftClick={() => onShiftClick(e.path)}
              onRightClick={(ev) => onRightClick(e.path, "unstaged", ev)}
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
                onClick={() => void onUnstageAll()}
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
                  selected={selectedPaths.has(e.path)}
                  onToggle={() => onRowClick(e.path, "staged")}
                  onShiftClick={() => onShiftClick(e.path)}
                  onRightClick={(ev) => onRightClick(e.path, "staged", ev)}
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
          onChange={(e) => onMessageChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCommit) {
              e.preventDefault();
              onCommit();
            }
          }}
        />
        <button
          className="btn-primary justify-center"
          disabled={!canCommit}
          onClick={onCommit}
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

      {contextMenu && (
        <FileContextMenu target={contextMenu} onClose={onCloseContextMenu} />
      )}
    </section>
  );
}
