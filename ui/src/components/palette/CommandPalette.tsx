/**
 * Command palette (cmux ⌘⇧P). A minimal stub for v1 — an input +
 * filtered list of actions, no fuzzy matching, no results navigation
 * hotkeys (⌃N/⌃P). We can layer those on once the action surface
 * grows.
 *
 * The list of actions is built at open time from the current repo
 * state (the recents/worktrees are still in the repo store). Actions
 * that don't make sense right now (e.g. "New worktree" when no repo
 * is open) are filtered out.
 *
 * Enter executes the highlighted action; clicking the row also
 * executes. Esc closes the palette.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRepoStore } from "@/stores/repo";
import { useTerminalStore } from "@/stores/terminal";
import { useGraphStore } from "@/stores/graph";
import { usePrefsStore } from "@/stores/prefs";
import { useMergeStore } from "@/stores/merge";
import { Command, FolderOpen, GitBranch, Plus, RefreshCw, PanelRightClose, PanelRightOpen, Settings as SettingsIcon, Maximize, X, Terminal as TerminalIcon, Square, Columns, ArrowLeftRight, Maximize2, RotateCcw } from "lucide-react";
import { displayBranch, sortWorktrees } from "@/lib/worktree";

interface Action {
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

interface Props {
  /** What to do after an action runs. Default: close the palette. */
  onClose: () => void;
  /** Action handlers passed in from App so the palette can open dialogs. */
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

export function CommandPalette(props: Props) {
  const repo = useRepoStore((s) => s.repo);
  const refresh = useRepoStore((s) => s.refresh);
  const worktrees = useRepoStore((s) => s.worktrees?.items ?? []);
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

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus the input on open and reset state.
  useEffect(() => {
    inputRef.current?.focus();
    setQuery("");
    setHighlight(0);
  }, []);

  const actions = useMemo<Action[]>(() => {
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
    // We intentionally don't re-build on every prop change — the
    // palette is short-lived (open → run → close). The store reads
    // inside `useMemo` are the live ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, worktrees, hasLayout, focusedPane, hasReopenablePane, hideGraphPanel, props]);

  // Filter by query.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const hay = [a.label, a.hint ?? "", a.keywords ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [actions, query]);

  // Clamp highlight to filtered list.
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered, highlight]);

  // Scroll highlighted row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const run = (a: Action) => {
    if (!a.enabled) return;
    a.run();
    props.onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const a = filtered[highlight];
      if (a) run(a);
      return;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[18vh] modal-backdrop"
      onClick={props.onClose}
    >
      <div
        className="modal-panel w-full max-w-xl overflow-hidden rounded-lg border border-white/[0.08] bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
        style={{ animation: "modal-scale 200ms cubic-bezier(0.25, 0.1, 0.25, 1.0) forwards" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
          <Command size={14} className="text-fg-muted" strokeWidth={1.5} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            className="flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-muted focus:outline-none"
          />
          <kbd className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] text-fg-muted">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-80 overflow-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-fg-muted">
              No matching actions.
            </div>
          ) : (
            filtered.map((a, i) => (
              <button
                key={a.id}
                data-idx={i}
                onClick={() => run(a)}
                onMouseEnter={() => setHighlight(i)}
                disabled={!a.enabled}
                className={
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-100 " +
                  (i === highlight
                    ? "bg-white/[0.06] text-fg"
                    : "text-fg-muted hover:bg-white/[0.03] hover:text-fg") +
                  (a.enabled ? "" : " opacity-40 cursor-not-allowed")
                }
              >
                <span className="shrink-0 text-fg-muted">{a.icon}</span>
                <span className="flex-1 truncate">{a.label}</span>
                {a.hint && (
                  <span className="hidden text-[11px] text-fg-subtle sm:inline">{a.hint}</span>
                )}
                {a.shortcut && (
                  <kbd className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] font-mono text-fg-muted">
                    {a.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-fg-subtle">
          ↑/↓ navigate · enter to run · esc to close
        </div>
      </div>
    </div>
  );
}
