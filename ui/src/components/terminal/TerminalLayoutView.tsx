/**
 * TerminalLayoutView — recursive layout-tree renderer for the
 * terminal strip. Handles splits (with draggable dividers) and leaf
 * panes (delegated to PaneView) and file-viewer panes (delegated to
 * FileViewerPane).
 */
import clsx from "clsx";
import { FileViewerPane } from "@/components/directory/FileViewerPane";
import { type Layout, type SplitDir } from "@/lib/terminal-layout";
import { PaneView } from "./PaneView";

// ── Public layout renderer ──────────────────────────────────────

export function LayoutView({
  worktree,
  layout,
  focusedPaneId,
  onSplit,
  onClose,
  onRatio,
  onFocus,
}: {
  worktree: string;
  layout: Layout;
  focusedPaneId: string | null;
  onSplit: (worktree: string, paneId: string, dir: SplitDir) => Promise<number>;
  onClose: (worktree: string, paneId: string) => Promise<void>;
  onRatio: (worktree: string, splitId: string, ratio: number) => void;
  onFocus: (worktree: string, paneId: string) => void;
}) {
  if (layout.kind === "pane") {
    return (
      <PaneView
        worktree={worktree}
        paneId={layout.id}
        sessionId={layout.sessionId}
        isFocused={focusedPaneId === layout.id}
        onSplit={onSplit}
        onClose={onClose}
        onFocus={onFocus}
      />
    );
  }
  if (layout.kind === "filepane") {
    return (
      <FileViewerPane
        paneId={layout.id}
        worktree={worktree}
        filePath={layout.filePath}
        cwd={layout.cwd}
        isFocused={focusedPaneId === layout.id}
        onClose={onClose}
        onFocus={onFocus}
      />
    );
  }
  return (
    <SplitView
      worktree={worktree}
      split={layout}
      focusedPaneId={focusedPaneId}
      onSplit={onSplit}
      onClose={onClose}
      onRatio={onRatio}
      onFocus={onFocus}
    />
  );
}

// ── Split container ────────────────────────────────────────────

function SplitView({
  worktree,
  split,
  focusedPaneId,
  onSplit,
  onClose,
  onRatio,
  onFocus,
}: {
  worktree: string;
  split: Extract<Layout, { kind: "split" }>;
  focusedPaneId: string | null;
  onSplit: (worktree: string, paneId: string, dir: SplitDir) => Promise<number>;
  onClose: (worktree: string, paneId: string) => Promise<void>;
  onRatio: (worktree: string, splitId: string, ratio: number) => void;
  onFocus: (worktree: string, paneId: string) => void;
}) {
  const isH = split.dir === "h";
  return (
    <div className={clsx("flex h-full w-full", isH ? "flex-col" : "flex-row")}>
      <div
        className="min-h-0 min-w-0"
        style={{ flex: `${split.ratio} 1 0%` }}
      >
        <LayoutView
          worktree={worktree}
          layout={split.a}
          focusedPaneId={focusedPaneId}
          onSplit={onSplit}
          onClose={onClose}
          onRatio={onRatio}
          onFocus={onFocus}
        />
      </div>
      <Splitter
        dir={split.dir}
        onResize={(ratio) => onRatio(worktree, split.id, ratio)}
      />
      <div
        className="min-h-0 min-w-0"
        style={{ flex: `${1 - split.ratio} 1 0%` }}
      >
        <LayoutView
          worktree={worktree}
          layout={split.b}
          focusedPaneId={focusedPaneId}
          onSplit={onSplit}
          onClose={onClose}
          onRatio={onRatio}
          onFocus={onFocus}
        />
      </div>
    </div>
  );
}

// ── Draggable divider ───────────────────────────────────────────

function Splitter({
  dir,
  onResize,
}: {
  dir: SplitDir;
  onResize: (ratio: number) => void;
}) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const splitter = e.currentTarget as HTMLElement;
    const parent = splitter.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const isH = dir === "h";

    const onMove = (ev: MouseEvent) => {
      const pos = isH ? ev.clientY : ev.clientX;
      const start = isH ? rect.top : rect.left;
      const size = isH ? rect.height : rect.width;
      if (size <= 0) return;
      const ratio = (pos - start) / size;
      onResize(ratio);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = isH ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  };
  return (
    <div
      onMouseDown={onMouseDown}
      title="Drag to resize"
      className={clsx(
        "shrink-0 bg-white/[0.04] hover:bg-accent/50 transition-colors duration-150",
        dir === "h" ? "h-1 w-full cursor-row-resize" : "h-full w-1 cursor-col-resize",
      )}
    />
  );
}
