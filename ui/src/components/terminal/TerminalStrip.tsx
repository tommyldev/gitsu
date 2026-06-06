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
 * Terminals are bound to their worktree: switching worktrees shows
 * that worktree's existing terminals (or a "spawning…" placeholder
 * while the first one starts). The shell process lives in the
 * backend registry for the lifetime of the app, so the same shell
 * (with its scrollback) reappears when you switch back. The PTY
 * is only torn down when the worktree itself is removed
 * (`wt_remove` → `pty.rs::teardown_for_worktree`).
 *
 * When the graph is hidden (`fillsAvailable`), the strip fills the
 * rest of the dashboard row instead of being a fixed-height strip.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import clsx from "clsx";
import { ChevronDown, ChevronUp, X, Terminal as TerminalIcon, Rows2, Columns2, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useTerminalStore, type Layout, type SplitDir } from "@/stores/terminal";
import { displayBranch, isDetached } from "@/lib/worktree";

// ── Outer container ────────────────────────────────────────────

export function TerminalStrip({ fillsAvailable = false }: { fillsAvailable?: boolean }) {
  const repo = useRepoStore((s) => s.repo);
  // NOTE: keep the `?? []` OUTSIDE the selector. `?? []` inside the
  // selector creates a fresh empty array on every render while the
  // repo is null, and `Object.is([], [])` is false — so Zustand sees
  // a "change" and the useSyncExternalStore loop spins.
  const worktrees = useRepoStore((s) => s.worktrees?.items) ?? [];
  const selectedWorktree = useTerminalStore((s) => s.selectedWorktree);
  const setSelectedWorktree = useTerminalStore((s) => s.setSelectedWorktree);
  const [collapsed, setCollapsed] = useState(false);

  // When a repo opens but no worktree is selected, default to the
  // repo's main path. Keep this in a small effect so we don't
  // write to the store on every render.
  useEffect(() => {
    if (repo && !selectedWorktree) {
      setSelectedWorktree(repo.path);
    }
    if (!repo && selectedWorktree) {
      setSelectedWorktree(null);
    }
  }, [repo, selectedWorktree, setSelectedWorktree]);

  const layout = useTerminalStore((s) =>
    selectedWorktree ? s.layouts.get(selectedWorktree) : undefined,
  );
  const focusedPaneId = useTerminalStore((s) =>
    selectedWorktree ? s.focusedPane.get(selectedWorktree) : undefined,
  );
  const zoomedPaneId = useTerminalStore((s) =>
    selectedWorktree ? s.zoomedPane.get(selectedWorktree) ?? null : null,
  );
  const ensurePane = useTerminalStore((s) => s.ensurePane);
  const splitPane = useTerminalStore((s) => s.splitPane);
  const closePane = useTerminalStore((s) => s.closePane);
  const setRatio = useTerminalStore((s) => s.setRatio);
  const setFocus = useTerminalStore((s) => s.setFocus);
  const toggleZoom = useTerminalStore((s) => s.toggleZoom);
  const equalizeSplits = useTerminalStore((s) => s.equalizeSplits);
  const reopenLastClosed = useTerminalStore((s) => s.reopenLastClosed);
  const reopenStackSize = useTerminalStore((s) => s.reopenStack.length);

  // All-worktree maps — read once so we can render every
  // worktree's layout simultaneously (see body below) and hide
  // the non-selected ones with CSS. This keeps TerminalSessionView
  // components mounted (and their xterms alive) across worktree
  // switches, avoiding the unmount → dispose → remount → restore
  // cycle that was the root cause of the missing-history bugs.
  const allLayouts = useTerminalStore((s) => s.layouts);

  // Count panes for the badge — number of leaves in the tree across
  // all worktrees, or just the session count.
  const liveCount = useTerminalStore((s) => s.sessions.size);

  // Auto-spawn a terminal the first time a worktree is selected. The
  // PTY (and its shell process) stays alive after the first spawn —
  // switching worktrees and switching back reuses the same shell,
  // with the store's `pendingData` buffer replaying the recent
  // scrollback (bounded by PENDING_DATA_CAP).
  const autoSpawnRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedWorktree) return;
    const wt = selectedWorktree;
    // Layout already exists → a terminal is alive for this worktree.
    if (useTerminalStore.getState().layouts.has(wt)) return;
    // React 19 strict mode runs effects twice in dev; dedupe so we
    // don't leak a second PTY in the backend registry.
    if (autoSpawnRef.current.has(wt)) return;
    autoSpawnRef.current.add(wt);
    void ensurePane(wt)
      .catch((e) => console.warn("auto-spawn pty failed", e))
      .finally(() => {
        autoSpawnRef.current.delete(wt);
      });
  }, [selectedWorktree, ensurePane]);

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
        {/* Zoom status / quick-action chip. Visible only when a
            zoomed pane is in effect. Click to exit zoom. */}
        {zoomedPaneId && (
          <button
            onClick={() => toggleZoom(selectedPath)}
            className="flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/25 transition-colors duration-150"
            title="Exit pane zoom (⌘⇧↩)"
          >
            <Minimize2 size={10} strokeWidth={1.5} />
            zoomed
          </button>
        )}
        {/* Equalize splits — only meaningful when the worktree has a layout. */}
        {layout && layout.kind === "split" && (
          <button
            onClick={() => equalizeSplits(selectedPath)}
            className="rounded p-1 text-fg-muted hover:bg-white/[0.04] hover:text-fg transition-colors duration-150"
            title="Equalize split sizes (⌃⌘=)"
          >
            <Maximize2 size={12} strokeWidth={1.5} />
          </button>
        )}
        {/* Reopen the most recently closed pane (in any worktree).
            Disabled when the stack is empty. */}
        <button
          onClick={() => void reopenLastClosed()}
          disabled={reopenStackSize === 0}
          className="rounded p-1 text-fg-muted hover:bg-white/[0.04] hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent transition-colors duration-150"
          title={
            reopenStackSize > 0
              ? "Reopen last closed terminal (⌘⇧T)"
              : "No recently closed terminals"
          }
        >
          <RotateCcw size={12} strokeWidth={1.5} />
        </button>
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
            <>
              {/* Render EVERY worktree's layout. The selected one is
                  visible; the rest are hidden with `display: none`.
                  Keeping them mounted (never unmounting) means the
                  xterm instances and their shells stay alive across
                  tab switches — no dispose/recreate/restore cycle. */}
              {worktrees.map((wt) => {
                if (!wt.path) return null;
                const wtLayout = allLayouts.get(wt.path);
                if (!wtLayout) {
                  // Only the selected worktree gets a placeholder;
                  // the auto-spawn effect will create a layout soon.
                  if (wt.path === selectedPath) {
                    return (
                      <div key={wt.path} className="flex h-full items-center justify-center text-[11px] text-fg-muted">
                        Spawning shell…
                      </div>
                    );
                  }
                  return null;
                }
                const isSelected = wt.path === selectedPath;
                // Only apply zoom for the visible worktree; hidden
                // ones just render the full tree (zoom is irrelevant
                // when you can't see it).
                const rendered =
                  isSelected && zoomedPaneId
                    ? findPaneById(wtLayout, zoomedPaneId) ?? wtLayout
                    : wtLayout;
                return (
                  <div
                    key={wt.path}
                    className="h-full w-full min-h-0 min-w-0"
                    style={{ display: isSelected ? undefined : "none" }}
                  >
                    <LayoutView
                      worktree={wt.path}
                      layout={rendered}
                      focusedPaneId={isSelected ? focusedPaneId ?? null : null}
                      onSplit={splitPane}
                      onClose={closePane}
                      onRatio={setRatio}
                      onFocus={isSelected ? setFocus : () => {}}
                    />
                  </div>
                );
              })}
            </>
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
  const setSerializedState = useTerminalStore((s) => s.setSerializedState);
  // True once anything has been written to this xterm on the
  // current mount (restored state, pending bytes, or live output).
  // We only snapshot the visual state if there's something worth
  // saving — otherwise React 19 strict mode's mount→cleanup→mount
  // cycle (which runs on every fresh mount in dev) would overwrite
  // the previously-saved scrollback with a fresh empty xterm's
  // state. That bug was masked with a single terminal (the
  // first-time empty is invisible) and blatant with multiple
  // terminals (every pane lost its history on the next switch).
  const hasContentRef = useRef(false);

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
    // SerializeAddon snapshots the xterm's visual state (scrollback
    // + cursor). We capture on unmount (so the scrollback survives
    // a worktree switch) and replay on the next mount.
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(serializeAddon);
    hasContentRef.current = false;

    // Register the keystroke handler before open. The textarea
    // xterm uses to capture input only exists once `open` is
    // called, so no keystrokes can land before that — but
    // registering the listener now means it's live the moment
    // open completes.
    const dataDisp = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      void send(sessionId, bytes);
    });

    const markContent = () => {
      hasContentRef.current = true;
    };

    // Restore the scrollback + replay pending bytes BEFORE
    // `term.open`. Two reasons:
    //
    //   1. The SerializeAddon docs explicitly recommend it:
    //      "When restoring a terminal it is best to do before
    //      Terminal.open is called to avoid wasting CPU cycles
    //      rendering incomplete frames."
    //
    //   2. More importantly in our case, at the moment this
    //      effect runs the parent SplitView/PaneView has just
    //      been committed but the container's size hasn't been
    //      measured yet — particularly in a split layout, where
    //      the flex math has more work to do. If we call
    //      `fit.fit()` first it can resize the term to 0×0, and
    //      bytes written to a 0×0 buffer are dropped. Writing at
    //      the default 80×24 *before* open means the buffer is
    //      preserved through the open + resize cycle and the
    //      ResizeObserver's later fit reflows it to the real size.
    const prior = useTerminalStore.getState().sessions.get(sessionId)?.serializedState;
    if (prior) {
      markContent();
      try {
        term.write(prior);
      } catch (e) {
        console.warn("xterm write (restored state) failed", e);
      }
    }

    // Attach to the store's PTY data stream and replay any bytes
    // that arrived while the view was unmounted. Doing this
    // before open means those bytes are part of the initial
    // render rather than arriving after.
    const { pending, unsubscribe } = useTerminalStore
      .getState()
      .attachView(sessionId, (bytes) => {
        markContent();
        try {
          term.write(bytes);
        } catch {
          term.write(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
        }
      });
    if (pending.length > 0) {
      markContent();
      try {
        term.write(pending);
      } catch {
        term.write(new TextDecoder("utf-8", { fatal: false }).decode(pending));
      }
    }

    // Now open the term — this flushes the buffer (prior + pending)
    // and renders. We intentionally do NOT call `fit.fit()` here:
    // at this point in the React lifecycle the parent split layout
    // may not have been measured yet, so `getBoundingClientRect()`
    // can return 0×0, 1×1, or any intermediate transient size.
    // Calling fit with a wrong size resizes the xterm buffer and
    // can drop the content we just wrote. The ResizeObserver
    // (which per spec always fires at least once when observation
    // starts on a non-zero-sized element) handles the real fit,
    // and the 50 ms timeout is a belt-and-suspenders fallback.
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      try {
        // Terminals on hidden worktrees have zero-size containers
        // (display: none). Skipping fit for those prevents the
        // buffer from being squashed to 0×0. The ResizeObserver
        // fires again when the container becomes visible and the
        // size is real.
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          fit.fit();
          resize(sessionId, term.cols, term.rows);
        }
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
      unsubscribe();
      // Only snapshot if the xterm actually has visible content.
      // Skipping the empty case is what keeps React 19 strict mode
      // from clobbering a previously-saved scrollback with a
      // freshly-created empty xterm's state. `setSerializedState`
      // is a no-op if the session was already torn down.
      if (hasContentRef.current) {
        try {
          const state = serializeAddon.serialize();
          setSerializedState(sessionId, state);
        } catch (e) {
          console.warn("xterm serialize failed", e);
        }
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, send, resize, setSerializedState]);

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

// ── Local helpers ──────────────────────────────────────────────

/** Find a pane in the layout tree by id. Returns `null` if the pane
 * has been removed. The store has a private `findPane`; we duplicate
 * the small walker here rather than export it just for this case. */
function findPaneById(layout: Layout, paneId: string): Layout | null {
  if (layout.kind === "pane") return layout.id === paneId ? layout : null;
  return findPaneById(layout.a, paneId) ?? findPaneById(layout.b, paneId);
}

// (no-op — silence the unused-import detector for some build setups)
void useMemo;
