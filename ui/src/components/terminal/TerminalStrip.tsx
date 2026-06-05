/**
 * TerminalStrip — collapsible bottom panel with one or more PTY
 * sessions per worktree, arranged in a tree of split panes.
 *
 * The store (`stores/terminal.ts`) holds the layout tree and session
 * map. The body of the strip is a recursive renderer:
 *
 *   SplitView (dir='h'): flex-col, panes stack, horizontal divider
 *   SplitView (dir='v'): flex-row, panes side by side, vertical divider
 *   PaneView: small header (split/close buttons, focus state) +
 *             TerminalSessionView (the xterm.js instance)
 *
 * Closing a pane collapses the parent split; closing the last pane
 * for a worktree removes the worktree's layout entirely. Splitters
 * are draggable (clamped 15%..85% so panes never get squashed).
 *
 * When the graph is hidden (`fillsAvailable`), the strip fills the
 * rest of the dashboard row instead of being a fixed-height strip.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { ChevronDown, ChevronUp, X, Terminal as TerminalIcon, Rows2, Columns2, Plus } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useTerminalStore, type Layout, type SplitDir } from "@/stores/terminal";
import { displayBranch, isDetached } from "@/lib/worktree";

// ── Outer container ────────────────────────────────────────────

export function TerminalStrip({ fillsAvailable = false }: { fillsAvailable?: boolean }) {
  const repo = useRepoStore((s) => s.repo);
  const worktrees = useRepoStore((s) => s.worktrees?.items ?? []);
  const [selectedWorktree, setSelectedWorktree] = useSelectedWorktree();
  const [collapsed, setCollapsed] = useState(false);

  const layout = useTerminalStore((s) =>
    selectedWorktree ? s.layouts.get(selectedWorktree) : undefined,
  );
  const focusedPaneId = useTerminalStore((s) =>
    selectedWorktree ? s.focusedPane.get(selectedWorktree) : undefined,
  );
  const ensurePane = useTerminalStore((s) => s.ensurePane);
  const splitPane = useTerminalStore((s) => s.splitPane);
  const closePane = useTerminalStore((s) => s.closePane);
  const setRatio = useTerminalStore((s) => s.setRatio);
  const setFocus = useTerminalStore((s) => s.setFocus);

  // Count panes for the badge — number of leaves in the tree across
  // all worktrees, or just the session count.
  const liveCount = useTerminalStore((s) => s.sessions.size);

  if (!repo) return null;
  const selectedPath = selectedWorktree ?? repo.path;
  const hasWorktrees = worktrees.length > 0;

  return (
    <div
      className={clsx(
        "flex flex-col bg-bg-panel",
        fillsAvailable
          ? "min-w-0 flex-1 border-l border-white/[0.06]"
          : "shrink-0 border-t border-white/[0.06]",
      )}
    >
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2">
        <TerminalIcon size={12} className="text-fg-muted" strokeWidth={1.5} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Terminal
        </span>
        <span className="ml-1 text-[10px] text-fg-muted">({liveCount})</span>
        <div className="ml-2 flex flex-1 items-center gap-1 overflow-x-auto">
          {worktrees.map((wt) =>
            wt.path ? (
              <WorktreeTab
                key={wt.path}
                label={displayBranch(wt)}
                detached={isDetached(wt)}
                active={wt.path === selectedPath}
                onSelect={() => setSelectedWorktree(wt.path)}
              />
            ) : null,
          )}
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="rounded p-1 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150"
          title={collapsed ? "Show terminal" : "Hide terminal"}
        >
          {collapsed ? <ChevronUp size={12} strokeWidth={1.5} /> : <ChevronDown size={12} strokeWidth={1.5} />}
        </button>
      </header>

      {!collapsed && (
        <div className={fillsAvailable ? "min-h-0 flex-1 bg-bg" : "h-72 bg-bg"}>
          {hasWorktrees ? (
            layout ? (
              <LayoutView
                worktree={selectedPath}
                layout={layout}
                focusedPaneId={focusedPaneId ?? null}
                onSplit={splitPane}
                onClose={closePane}
                onRatio={setRatio}
                onFocus={setFocus}
              />
            ) : (
              <EmptyCta worktree={selectedPath} onSpawn={ensurePane} />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-fg-muted">
              No worktrees yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tabs (worktree switcher in the strip header) ───────────────

function WorktreeTab({
  label,
  detached,
  active,
  onSelect,
}: {
  label: string;
  detached: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-colors duration-150",
        active ? "bg-white/[0.05] text-fg" : "text-fg-muted hover:bg-white/[0.03]",
      )}
      title={label}
    >
      <span
        className={clsx(
          "h-1.5 w-1.5 rounded-full",
          detached ? "bg-fg-muted" : "bg-accent",
        )}
      />
      <span className="max-w-[180px] truncate font-mono">{label}</span>
    </button>
  );
}

// ── Empty state (no panes yet for this worktree) ───────────────

function EmptyCta({ worktree, onSpawn }: { worktree: string; onSpawn: (wt: string) => Promise<number> }) {
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spawn = async () => {
    setSpawning(true);
    setError(null);
    try {
      await onSpawn(worktree);
    } catch (e) {
      setError(String(e));
    } finally {
      setSpawning(false);
    }
  };
  const label = worktree.split("/").pop() ?? worktree;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-muted">
      <TerminalIcon size={24} className="opacity-50" strokeWidth={1.5} />
      <p className="text-[13px]">No terminals in <code className="font-mono text-fg">{label}</code>.</p>
      <button
        onClick={spawn}
        disabled={spawning}
        className="flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 py-1 text-[12px] text-accent hover:border-accent/50 hover:bg-accent/15 disabled:opacity-50 transition-colors duration-150"
      >
        <Plus size={12} strokeWidth={1.5} />
        {spawning ? "Spawning…" : "Spawn terminal"}
      </button>
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}

// ── Recursive layout renderer ──────────────────────────────────

function LayoutView({
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

// ── Split container (renders two children + draggable divider) ─

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

// ── Splitter (draggable thin divider) ──────────────────────────

function Splitter({
  dir,
  onResize,
}: {
  dir: SplitDir;
  onResize: (ratio: number) => void;
}) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    // Capture the parent's rect on mousedown so the drag is stable
    // even if the parent resizes mid-drag.
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

// ── Pane (single terminal + small header with controls) ────────

function PaneView({
  worktree,
  paneId,
  sessionId,
  isFocused,
  onSplit,
  onClose,
  onFocus,
}: {
  worktree: string;
  paneId: string;
  sessionId: number | null;
  isFocused: boolean;
  onSplit: (worktree: string, paneId: string, dir: SplitDir) => Promise<number>;
  onClose: (worktree: string, paneId: string) => Promise<void>;
  onFocus: (worktree: string, paneId: string) => void;
}) {
  const status = useTerminalStore((s) => (sessionId != null ? s.sessions.get(sessionId)?.status : "spawning"));
  const dot = statusDot(status);

  return (
    <div
      onMouseDown={() => onFocus(worktree, paneId)}
      className={clsx(
        "group flex h-full w-full min-h-0 min-w-0 flex-col border bg-bg transition-colors duration-150",
        isFocused ? "border-accent/40" : "border-white/[0.04]",
      )}
    >
      <div
        className={clsx(
          "flex h-6 shrink-0 items-center gap-1.5 border-b px-1.5 transition-colors duration-150",
          isFocused ? "border-accent/30 bg-accent/[0.06]" : "border-white/[0.06] bg-bg-panel/60",
        )}
      >
        <span className={clsx("h-1.5 w-1.5 rounded-full", dot.color)} title={dot.title} />
        <span className="text-[10px] tabular-nums text-fg-muted">{shortSessionLabel(sessionId)}</span>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <IconButton title="Split horizontal" onClick={(e) => { e.stopPropagation(); void onSplit(worktree, paneId, "h"); }}>
            <Rows2 size={10} strokeWidth={1.5} />
          </IconButton>
          <IconButton title="Split vertical" onClick={(e) => { e.stopPropagation(); void onSplit(worktree, paneId, "v"); }}>
            <Columns2 size={10} strokeWidth={1.5} />
          </IconButton>
          <IconButton title="Close pane" onClick={(e) => { e.stopPropagation(); void onClose(worktree, paneId); }}>
            <X size={10} strokeWidth={1.5} />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        {sessionId != null ? (
          <TerminalSessionView sessionId={sessionId} />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-fg-muted">
            Spawning shell…
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      className="rounded p-1 text-fg-muted hover:bg-white/[0.06] hover:text-fg transition-colors duration-150"
    >
      {children}
    </button>
  );
}

function statusDot(status: "spawning" | "running" | "exited" | "error" | undefined): { color: string; title: string } {
  switch (status) {
    case "running":
      return { color: "bg-success", title: "running" };
    case "spawning":
      return { color: "bg-warning animate-pulse", title: "spawning" };
    case "exited":
      return { color: "bg-fg-subtle", title: "exited" };
    case "error":
      return { color: "bg-danger", title: "error" };
    default:
      return { color: "bg-fg-muted", title: "no session" };
  }
}

function shortSessionLabel(id: number | null): string {
  if (id == null) return "—";
  return `#${id}`;
}

// ── xterm.js session view ──────────────────────────────────────

function TerminalSessionView({ sessionId }: { sessionId: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const send = useTerminalStore((s) => s.send);
  const resize = useTerminalStore((s) => s.resize);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: {
        background: "#1A1B1D",
        foreground: "#8A8F98",
        cursor: "#8A8F98",
        selectionBackground: "#3A3D44",
      },
      cols: 80,
      rows: 24,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const dataDisp = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      void send(sessionId, bytes);
    });

    // Subscribe to pty:data for this session id. The store already
    // owns a pty:exit listener (and the server-side cleanup on close),
    // so we only need data here.
    let unlisten: (() => void) | undefined;
    void listen<{ id: number; data: number[] }>(`pty:data:${sessionId}`, (event) => {
      const bytes = new Uint8Array(event.payload.data);
      try {
        term.write(bytes as unknown as string);
      } catch {
        term.write(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
      }
    }).then((fn) => {
      unlisten = fn;
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        resize(sessionId, term.cols, term.rows);
      } catch {
        // ignore
      }
    });
    ro.observe(containerRef.current);
    const t = window.setTimeout(() => {
      try {
        fit.fit();
        resize(sessionId, term.cols, term.rows);
      } catch {
        // ignore
      }
    }, 50);

    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      dataDisp.dispose();
      unlisten?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, send, resize]);

  // Overlay for terminal states (exited / error) — live status comes
  // from the store; we re-read it here so the overlay updates when
  // the session terminates while the pane is still mounted.
  const status = useTerminalStore((s) => s.sessions.get(sessionId)?.status);
  const error = useTerminalStore((s) => s.sessions.get(sessionId)?.error);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {status === "spawning" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-fg-muted">
          Spawning shell…
        </div>
      )}
      {status === "exited" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-fg-subtle">
          Shell exited. Close this pane to clean up.
        </div>
      )}
      {status === "error" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-danger">
          {error || "Failed to spawn shell."}
        </div>
      )}
    </div>
  );
}

// ── Local "selected worktree" state (independent of the graph) ─

/** The currently "selected" worktree for the terminal strip, used
 * to decide which layout to render. Defaults to the main worktree's
 * path when a repo is opened. Independent of the graph's selected
 * commit, so the user can view one worktree's commits while keeping
 * a shell open in another. */
function useSelectedWorktree(): [string | null, (path: string | null) => void] {
  const repo = useRepoStore((s) => s.repo);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (repo && selected === null) {
      setSelected(repo.path);
    }
    if (!repo) setSelected(null);
  }, [repo, selected]);
  return [selected, setSelected];
}

// (no-op — silence the unused-import detector for some build setups)
void useMemo;
