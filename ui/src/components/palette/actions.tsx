/**
 * Extracted command/action list builder for CommandPalette.
 * Built at open-time from current repo state; actions that don't make
 * sense right now are filtered out.
 */

import React from "react";
import { useRepoStore } from "@/stores/repo";
import { useTerminalStore } from "@/stores/terminal";
import { useGraphStore } from "@/stores/graph";
import { usePrefsStore } from "@/stores/prefs";
import { useMergeStore } from "@/stores/merge";
import { Command, FolderOpen, GitBranch, Plus, RefreshCw, PanelRightClose, PanelRightOpen, Settings as SettingsIcon, Maximize, X, Terminal as TerminalIcon, Square, Columns, ArrowLeftRight, Maximize2, RotateCcw } from "lucide-react";
import { displayBranch, sortWorktrees } from "@/lib/worktree";

export interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  /** Hint shown right-aligned (e.g. the keyboard shortcut). */
  shortcut?: string;
  keywords?: string;
  enabled: boolean;
  run: () => void;
}

export interface CommandsDeps {
  onOpenRepo?: () => void;
  onNewWorktree?: () => void;
  onOpenSettings?: () => void;
  onOpenHooks?: () => void;
  onToggleGraph?: () => void;
  onToggleFullscreen?: () => void;
  onReopenLastRepo?: () => void;
  onNewTerminal?: () => void;
  onCloseTerminal?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onEqualizeSplits?: () => void;
  onReopenClosedPane?: () => void;
  onNextWorktree?: () => void;
  onPrevWorktree?: () => void;
}

export function useCommands(props: CommandsDeps): Action[] {
  const repo = useRepoStore((s) => s.repo);
  const refresh = useRepoStore((s) => s.refresh);
  const worktrees = useRepoStore((s) => s.worktrees?.items) ?? [];
  const hasLayout = useTerminalStore((s) =>
    s.selectedWorktree ? !!s.layouts.get(s.selectedWorktree) : false,
  );
  const focusedPane = useTerminalStore((s) =>
    s.selectedWorktree ? s.focusedPane.get(s.selectedWorktree) : undefined,
  );
  const hasReopenablePane = useTerminalStore((s) => s.reopenStack.length > 0);
  const graphSetActive = useGraphStore((s) => s.setActive);
  const toggleHideGraphPanel = usePrefsStore((s) => s.toggleHideGraphPanel);
  const hideGraphPanel = usePrefsStore((s) => s.hideGraphPanel);
  const openMerge = useMergeStore((s) => s.open);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo<Action[]>(() => {
    const list: Action[] = [];

    // ── File / repo
    list.push({
      id: "open-repo",
      label: "Open repository…",
      hint: "Pick a folder",
      icon: <FolderOpen size={14} strokeWidth={1.5} />,
      shortcut: "⌘O",
      keywords: "open repo folder directory",
      enabled: true,
      run: () => props.onOpenRepo?.(),
    });
    if (repo) {
      list.push({
        id: "refresh",
        label: `Refresh worktrees`,
        hint: "Re-fetch `wt list` + version",
        icon: <RefreshCw size={14} strokeWidth={1.5} />,
        shortcut: "⌘R",
        keywords: "refresh reload poll status",
        enabled: true,
        run: () => void refresh(),
      });
    }
    if (useRepoStore.getState().recents.length > 1) {
      list.push({
        id: "reopen-last-repo",
        label: "Reopen previous repository",
        icon: <ArrowLeftRight size={14} strokeWidth={1.5} />,
        shortcut: "⌘⇧O",
        keywords: "reopen recent back",
        enabled: !!props.onReopenLastRepo,
        run: () => props.onReopenLastRepo?.(),
      });
    }

    // ── Worktrees
    if (repo) {
      list.push({
        id: "new-worktree",
        label: "New worktree…",
        icon: <Plus size={14} strokeWidth={1.5} />,
        shortcut: "⌘N",
        keywords: "new worktree create branch",
        enabled: true,
        run: () => props.onNewWorktree?.(),
      });
      const sorted = sortWorktrees(worktrees);
      for (let i = 0; i < Math.min(sorted.length, 9); i++) {
        const wt = sorted[i];
        if (!wt?.path) continue;
        list.push({
          id: `switch-${wt.path}`,
          label: `Switch to ${displayBranch(wt)}`,
          icon: <GitBranch size={14} strokeWidth={1.5} />,
          shortcut: `⌘${i + 1}`,
          keywords: `switch worktree ${displayBranch(wt)} select`,
          enabled: true,
          run: () => void graphSetActive(wt.path!),
        });
      }
      // Next / prev
      list.push({
        id: "next-worktree",
        label: "Next worktree",
        icon: <ArrowLeftRight size={14} strokeWidth={1.5} className="rotate-180" />,
        shortcut: "⌘⇧]",
        keywords: "next worktree surface",
        enabled: true,
        run: () => props.onNextWorktree?.(),
      });
      list.push({
        id: "prev-worktree",
        label: "Previous worktree",
        icon: <ArrowLeftRight size={14} strokeWidth={1.5} />,
        shortcut: "⌘⇧[",
        keywords: "prev worktree surface",
        enabled: true,
        run: () => props.onPrevWorktree?.(),
      });
      // Merge (first non-main)
      const mergeable = sorted.find((w) => !w.is_main && w.branch && w.path && w.worktree?.detached === false);
      if (mergeable?.branch && mergeable.path) {
        const target = useRepoStore.getState().worktrees?.default_branch ?? "main";
        list.push({
          id: `merge-${mergeable.path}`,
          label: `Merge ${displayBranch(mergeable)} into ${target}…`,
          icon: <GitBranch size={14} strokeWidth={1.5} />,
          keywords: "merge worktree",
          enabled: true,
          run: () => openMerge(mergeable.path!, mergeable.branch!, target),
        });
      }
    }

    // ── Terminal panes
    if (repo) {
      list.push({
        id: "new-terminal",
        label: "New terminal pane",
        hint: "In the current worktree",
        icon: <TerminalIcon size={14} strokeWidth={1.5} />,
        shortcut: "⌘T",
        keywords: "terminal shell new pane split spawn",
        enabled: true,
        run: () => props.onNewTerminal?.(),
      });
      if (hasLayout && focusedPane) {
        list.push({
          id: "close-terminal",
          label: "Close current terminal pane",
          icon: <X size={14} strokeWidth={1.5} />,
          shortcut: "⌘W",
          keywords: "close terminal kill pane",
          enabled: true,
          run: () => props.onCloseTerminal?.(),
        });
        list.push({
          id: "split-right",
          label: "Split terminal right",
          icon: <Columns size={14} strokeWidth={1.5} />,
          shortcut: "⌘D",
          keywords: "split terminal pane vertical",
          enabled: true,
          run: () => props.onSplitRight?.(),
        });
        list.push({
          id: "split-down",
          label: "Split terminal down",
          icon: <Square size={14} strokeWidth={1.5} />,
          shortcut: "⌘⇧D",
          keywords: "split terminal pane horizontal",
          enabled: true,
          run: () => props.onSplitDown?.(),
        });
        list.push({
          id: "equalize-splits",
          label: "Equalize terminal split sizes",
          icon: <Maximize2 size={14} strokeWidth={1.5} />,
          shortcut: "⌃⌘=",
          keywords: "equalize splits reset balance",
          enabled: true,
          run: () => props.onEqualizeSplits?.(),
        });
      }
      if (hasReopenablePane) {
        list.push({
          id: "reopen-pane",
          label: "Reopen last closed terminal",
          icon: <RotateCcw size={14} strokeWidth={1.5} />,
          shortcut: "⌘⇧T",
          keywords: "reopen restore closed terminal",
          enabled: true,
          run: () => props.onReopenClosedPane?.(),
        });
      }
    }

    // ── Layout
    list.push({
      id: "toggle-graph",
      label: hideGraphPanel ? "Show graph & commit panel" : "Hide graph & commit panel",
      icon: hideGraphPanel ? <PanelRightOpen size={14} strokeWidth={1.5} /> : <PanelRightClose size={14} strokeWidth={1.5} />,
      keywords: "toggle graph panel commit hide show layout",
      enabled: true,
      run: () => toggleHideGraphPanel(),
    });
    list.push({
      id: "toggle-fullscreen",
      label: "Toggle full screen",
      icon: <Maximize size={14} strokeWidth={1.5} />,
      shortcut: "⌃⌘F",
      keywords: "fullscreen window",
      enabled: true,
      run: () => props.onToggleFullscreen?.(),
    });
    list.push({
      id: "settings",
      label: "Settings",
      icon: <SettingsIcon size={14} strokeWidth={1.5} />,
      shortcut: "⌘,",
      keywords: "settings preferences config",
      enabled: true,
      run: () => props.onOpenSettings?.(),
    });
    if (repo) {
      list.push({
        id: "hooks",
        label: "Hooks & worktree config",
        icon: <Command size={14} strokeWidth={1.5} />,
        shortcut: "⌘⇧,",
        keywords: "hooks wt config worktreeinclude post-start",
        enabled: true,
        run: () => props.onOpenHooks?.(),
      });
    }

    return list;
  }, [
    repo,
    worktrees,
    hasLayout,
    focusedPane,
    hasReopenablePane,
    hideGraphPanel,
    props,
    refresh,
    graphSetActive,
    toggleHideGraphPanel,
    openMerge,
  ]);
}
