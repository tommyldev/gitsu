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

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Terminal as TerminalIcon, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useTerminalStore } from "@/stores/terminal";
import { displayBranch, isDetached } from "@/lib/worktree";
import { findPane } from "@/lib/terminal-layout";
import { LayoutView } from "./TerminalLayoutView";
import { WorktreeTab } from "./WorktreeTab";

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
                    ? findPane(wtLayout, zoomedPaneId)?.layout ?? wtLayout
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
