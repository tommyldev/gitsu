/**
 * useGlobalHotkeys — the app-wide keydown listener (cmux-aligned
 * shortcuts; see App's doc comment + the palette cheatsheet for the
 * full list). Subscribes to the stores it needs internally; the only
 * inputs are App's modal open/close setters, since those are local
 * component state. Extracted from App verbatim.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useRepoStore } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { useTerminalStore } from "@/stores/terminal";
import { usePrefsStore } from "@/stores/prefs";
import { sortWorktrees } from "@/lib/worktree";
import { firstPaneId } from "@/lib/terminal-layout";
import type { Worktree } from "@/lib/types";

interface ModalSetters {
  setCreateOpen: Dispatch<SetStateAction<boolean>>;
  setRemoveTarget: Dispatch<SetStateAction<Worktree | null>>;
  setHooksManagerOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
}

export function useGlobalHotkeys({
  setCreateOpen,
  setRemoveTarget,
  setHooksManagerOpen,
  setSettingsOpen,
  setPaletteOpen,
  setCommandPaletteOpen,
}: ModalSetters) {
  const repo = useRepoStore((s) => s.repo);
  const pickAndOpen = useRepoStore((s) => s.pickAndOpen);
  const openByPath = useRepoStore((s) => s.openByPath);
  const refresh = useRepoStore((s) => s.refresh);
  const graphSetActive = useGraphStore((s) => s.setActive);
  const graphFetch = useGraphStore((s) => s.fetch);
  const setSelectedTerminalWorktree = useTerminalStore((s) => s.setSelectedWorktree);
  const toggleHideWorktreeList = usePrefsStore((s) => s.toggleHideWorktreeList);
  const toggleHideCommitPanel = usePrefsStore((s) => s.toggleHideCommitPanel);
  const bumpTerminalFontSize = usePrefsStore((s) => s.bumpTerminalFontSize);
  const resetTerminalFontSize = usePrefsStore((s) => s.resetTerminalFontSize);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Don't steal the user's shortcuts while they're typing.
      const target = e.target as HTMLElement | null;
      // xterm.js focuses a hidden <textarea class="xterm-helper-textarea">
      // to capture keystrokes. It's a TEXTAREA element, so a naive
      // tag check would treat it as editable and block every global
      // hotkey (⌘1..9, ⌘[, ⌘], …) the moment the user clicks into
      // a terminal. The helper textarea lives inside the `.xterm`
      // container; either check excludes it.
      const inXterm =
        !!target?.classList.contains("xterm-helper-textarea") ||
        !!target?.closest(".xterm");
      const inEditable =
        target &&
        !inXterm &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (inEditable) {
        // Exception: still let Esc bubble to the App's modal handler.
        if (e.key === "Escape") {
          setCreateOpen(false);
          setRemoveTarget(null);
          setHooksManagerOpen(false);
          setSettingsOpen(false);
          setPaletteOpen(false);
          setCommandPaletteOpen(false);
        }
        return;
      }

      // ── Repo / projects
      if (mod && e.key === "o" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void pickAndOpen();
        return;
      }
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        // Reopen the most recent repo (any one other than the
        // currently open one, ordered by recents desc).
        const recs = useRepoStore.getState().recents;
        const target = recs.find((r) => r.path !== useRepoStore.getState().repo?.path);
        if (target) void openByPath(target.path);
        return;
      }
      if (mod && e.key === "n" && !e.shiftKey && !e.altKey && repo) {
        e.preventDefault();
        setCreateOpen(true);
        return;
      }

      // ── Palettes
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((p) => !p);
        return;
      }
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCommandPaletteOpen((p) => !p);
        return;
      }

      // ── Worktree selection (⌘1..9) — also moves the terminal strip.
      if (
        mod &&
        !e.shiftKey &&
        !e.altKey &&
        /^[1-9]$/.test(e.code.replace("Digit", ""))
      ) {
        const idx = Number(e.code.replace("Digit", "")) - 1;
        const list = useRepoStore.getState().worktrees?.items ?? [];
        const target2 = sortWorktrees(list)[idx];
        if (target2?.path) {
          e.preventDefault();
          void graphSetActive(target2.path);
          setSelectedTerminalWorktree(target2.path);
        }
        return;
      }

      // ── Worktree cycle (⌘⇧[ / ⌘⇧]) — "previous/next surface" in cmux.
      if (mod && e.shiftKey && !e.altKey && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        const list = sortWorktrees(useRepoStore.getState().worktrees?.items ?? []);
        if (list.length === 0) return;
        const cur = useTerminalStore.getState().selectedWorktree ?? useGraphStore.getState().activePath ?? null;
        const idx = cur ? list.findIndex((w) => w.path === cur) : -1;
        const next =
          e.key === "]"
            ? list[(idx + 1 + list.length) % list.length]
            : list[(idx - 1 + list.length) % list.length];
        if (next?.path) {
          void graphSetActive(next.path);
          setSelectedTerminalWorktree(next.path);
        }
        return;
      }

      // ── Settings & hooks
      if (mod && e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault();
        setHooksManagerOpen(true);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }

      // ── Sidebar toggles
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleHideWorktreeList();
        return;
      }
      if (mod && e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleHideCommitPanel();
        return;
      }

      // ── Refresh
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r" && repo) {
        e.preventDefault();
        void refresh();
        void graphFetch(repo.path);
        return;
      }

      // ── Terminal panes (only meaningful when a repo is open).
      if (repo) {
        const wt = useTerminalStore.getState().selectedWorktree ?? repo.path;
        const term = useTerminalStore.getState();
        const layout = term.layouts.get(wt);
        const focused = term.focusedPane.get(wt) ?? (layout ? firstPaneId(layout) : undefined);

        if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") {
          e.preventDefault();
          if (!layout) {
            void term.ensurePane(wt);
          } else if (focused) {
            void term.splitPane(wt, focused, "v");
          } else {
            void term.ensurePane(wt);
          }
          return;
        }
        if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
          e.preventDefault();
          if (focused) void term.closePane(wt, focused);
          return;
        }
        if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
          e.preventDefault();
          if (!layout) void term.ensurePane(wt);
          else if (focused) void term.splitPane(wt, focused, "v");
          return;
        }
        if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
          e.preventDefault();
          if (!layout) void term.ensurePane(wt);
          else if (focused) void term.splitPane(wt, focused, "h");
          return;
        }
        if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") {
          e.preventDefault();
          void term.reopenLastClosed();
          return;
        }
        if (mod && e.altKey && !e.shiftKey && e.key.toLowerCase() === "t") {
          e.preventDefault();
          if (focused) void term.closeOthers(wt, focused);
          return;
        }
        if (mod && !e.shiftKey && !e.altKey && e.key === "[") {
          e.preventDefault();
          term.focusPrevPane(wt);
          return;
        }
        if (mod && !e.shiftKey && !e.altKey && e.key === "]") {
          e.preventDefault();
          term.focusNextPane(wt);
          return;
        }
        if (mod && e.altKey && !e.shiftKey && e.code === "ArrowLeft") {
          e.preventDefault();
          term.focusPrevPane(wt);
          return;
        }
        if (mod && e.altKey && !e.shiftKey && e.code === "ArrowRight") {
          e.preventDefault();
          term.focusNextPane(wt);
          return;
        }
        if (mod && e.altKey && !e.shiftKey && e.code === "ArrowUp") {
          e.preventDefault();
          term.focusFirstPane(wt);
          return;
        }
        if (mod && e.altKey && !e.shiftKey && e.code === "ArrowDown") {
          e.preventDefault();
          term.focusLastPane(wt);
          return;
        }
        if (mod && e.shiftKey && !e.altKey && e.key === "Enter") {
          e.preventDefault();
          term.toggleZoom(wt);
          return;
        }
        if (mod && !e.shiftKey && e.altKey && e.key === "=") {
          e.preventDefault();
          term.equalizeSplits(wt);
          return;
        }
        // Terminal font size. `⌘+` arrives as `e.key === "="` with
        // shift held on US layouts; we accept it on either shift
        // state so non-US layouts (where `+` is the unshifted key)
        // work too. `⌘0` resets to the default 12px. We don't gate
        // on repo-open-ness for the font-size shortcuts — the
        // `inEditable` guard above already covers the typing case,
        // and the prefs store accepts writes regardless.
        if (mod && e.altKey === false && e.key === "=") {
          e.preventDefault();
          bumpTerminalFontSize(1);
          return;
        }
        if (mod && e.altKey === false && e.key === "-") {
          e.preventDefault();
          bumpTerminalFontSize(-1);
          return;
        }
        if (mod && e.altKey === false && e.key === "0") {
          e.preventDefault();
          resetTerminalFontSize();
          return;
        }
      }

      // ── Window-level (always allowed, repo or not)
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        void getCurrentWindow().close();
        return;
      }
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        // Spawn a new gitsu window. The label must be unique per
        // window; we use a timestamp suffix to avoid collisions
        // when the user mashes the shortcut.
        const label = `gitsu-${Date.now()}`;
        try {
          new WebviewWindow(label, { url: "index.html", title: "gitsu" });
        } catch (err) {
          console.warn("new window failed", err);
        }
        return;
      }
      if (mod && e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        void getCurrentWindow().close();
        return;
      }
      if (mod && e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        void (async () => {
          const w = getCurrentWindow();
          const isFs = await w.isFullscreen();
          await w.setFullscreen(!isFs);
        })();
        return;
      }

      // ── Esc → close all modals
      if (e.key === "Escape") {
        setCreateOpen(false);
        setRemoveTarget(null);
        setHooksManagerOpen(false);
        setSettingsOpen(false);
        setPaletteOpen(false);
        setCommandPaletteOpen(false);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    repo,
    pickAndOpen,
    openByPath,
    graphSetActive,
    setSelectedTerminalWorktree,
    graphFetch,
    refresh,
    toggleHideWorktreeList,
    toggleHideCommitPanel,
    bumpTerminalFontSize,
    resetTerminalFontSize,
    setCreateOpen,
    setRemoveTarget,
    setHooksManagerOpen,
    setSettingsOpen,
    setPaletteOpen,
    setCommandPaletteOpen,
  ]);
}
