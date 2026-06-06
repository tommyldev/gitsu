/**
 * useTerminalActions — imperative terminal/worktree action helpers
 * used by the command palette. Each reads current store state via
 * `getState()` (no subscription), so the returned handlers are safe
 * to call from anywhere. Extracted from App.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRepoStore } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { useTerminalStore } from "@/stores/terminal";
import { sortWorktrees } from "@/lib/worktree";
import { firstPaneId } from "@/lib/terminal-layout";

export function useTerminalActions() {
  // Which worktree is "active" for the next/prev cycle in the
  // command palette (and any other list-cycling shortcut).
  const cycleNextWorktree = () => {
    const list = sortWorktrees(useRepoStore.getState().worktrees?.items ?? []);
    if (list.length === 0) return;
    const cur =
      useTerminalStore.getState().selectedWorktree ?? useGraphStore.getState().activePath ?? null;
    const idx = cur ? list.findIndex((w) => w.path === cur) : -1;
    const next = list[(idx + 1 + list.length) % list.length];
    if (next?.path) {
      void useGraphStore.getState().setActive(next.path);
      useTerminalStore.getState().setSelectedWorktree(next.path);
    }
  };
  const cyclePrevWorktree = () => {
    const list = sortWorktrees(useRepoStore.getState().worktrees?.items ?? []);
    if (list.length === 0) return;
    const cur =
      useTerminalStore.getState().selectedWorktree ?? useGraphStore.getState().activePath ?? null;
    const idx = cur ? list.findIndex((w) => w.path === cur) : -1;
    const prev = list[(idx - 1 + list.length) % list.length];
    if (prev?.path) {
      void useGraphStore.getState().setActive(prev.path);
      useTerminalStore.getState().setSelectedWorktree(prev.path);
    }
  };

  // ── Terminal action helpers (used by the command palette)
  const newTerminalInSelected = () => {
    const wt = useTerminalStore.getState().selectedWorktree ?? useRepoStore.getState().repo?.path;
    if (!wt) return;
    const term = useTerminalStore.getState();
    const layout = term.layouts.get(wt);
    if (!layout) {
      void term.ensurePane(wt);
      return;
    }
    const focused = term.focusedPane.get(wt) ?? firstPaneId(layout);
    if (focused) void term.splitPane(wt, focused, "v");
  };
  const closeCurrentTerminal = () => {
    const wt = useTerminalStore.getState().selectedWorktree ?? useRepoStore.getState().repo?.path;
    if (!wt) return;
    const term = useTerminalStore.getState();
    const layout = term.layouts.get(wt);
    if (!layout) return;
    const focused = term.focusedPane.get(wt) ?? firstPaneId(layout);
    if (focused) void term.closePane(wt, focused);
  };
  const splitTerminal = (dir: "h" | "v") => {
    const wt = useTerminalStore.getState().selectedWorktree ?? useRepoStore.getState().repo?.path;
    if (!wt) return;
    const term = useTerminalStore.getState();
    const layout = term.layouts.get(wt);
    if (!layout) {
      void term.ensurePane(wt);
      return;
    }
    const focused = term.focusedPane.get(wt) ?? firstPaneId(layout);
    if (focused) void term.splitPane(wt, focused, dir);
  };
  const equalizeCurrent = () => {
    const wt = useTerminalStore.getState().selectedWorktree ?? useRepoStore.getState().repo?.path;
    if (!wt) return;
    useTerminalStore.getState().equalizeSplits(wt);
  };
  const reopenClosed = () => {
    void useTerminalStore.getState().reopenLastClosed();
  };
  const reopenLastRepo = () => {
    const recs = useRepoStore.getState().recents;
    const target = recs.find((r) => r.path !== useRepoStore.getState().repo?.path);
    if (target) void useRepoStore.getState().openByPath(target.path);
  };
  const toggleFullscreen = async () => {
    const w = getCurrentWindow();
    const isFs = await w.isFullscreen();
    await w.setFullscreen(!isFs);
  };

  return {
    cycleNextWorktree,
    cyclePrevWorktree,
    newTerminalInSelected,
    closeCurrentTerminal,
    splitTerminal,
    equalizeCurrent,
    reopenClosed,
    reopenLastRepo,
    toggleFullscreen,
  };
}
