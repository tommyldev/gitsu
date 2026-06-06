/**
 * Top-level App component.
 *
 * Routes between:
 *   - Home: recents list + "Open repo" button
 *   - Dashboard: worktree-first view, two layouts
 *       1. 3-pane: worktrees | graph | commit panel, with a bottom
 *          terminal strip for per-worktree shells
 *       2. Sidebar: worktrees (fixed) | terminal (fills) — selected
 *          via the View toggle, useful on small windows or when the
 *          graph is in the way
 *
 * Sidebar toggles (cmux-style, independent of the legacy "Hide graph"
 * compact-mode flag):
 *   - ⌘B         toggle left (worktree list)
 *   - ⌘⌥B        toggle right (commit panel)
 *   - Hide graph (button / palette) → "compact mode" = both graph
 *     and commit panel hidden, terminal fills the row
 *
 * Hotkeys (cmux-aligned; see also docs/ARCHITECTURE.md and the
 * in-palette cheatsheet for the full list):
 *   - ⌘N / Ctrl+N: new worktree
 *   - ⌘O / Ctrl+O: open repo
 *   - ⌘K / Ctrl+K: project switcher palette (existing)
 *   - ⌘⇧P / Ctrl+Shift+P: command palette (new)
 *   - ⌘T: new terminal pane
 *   - ⌘W: close current terminal pane
 *   - ⌘D: split right
 *   - ⌘⇧D: split down
 *   - ⌘⇧T: reopen last closed terminal
 *   - ⌥⌘T: close other panes in worktree
 *   - ⌘[ / ⌘]: focus prev/next terminal pane
 *   - ⌥⌘←/→/↑/↓: focus neighbor pane (pre-order nav)
 *   - ⌘⇧↩: toggle pane zoom
 *   - ⌃⌘=: equalize splits
 *   - ⌘1..⌘9 / Ctrl+1..Ctrl+9: switch to Nth worktree in the list
 *   - ⌘⇧[ / ⌘⇧]: prev/next worktree (terminal strip tab)
 *   - ⌘, : settings
 *   - ⌘⇧, : hooks & worktree config
 *   - ⌘B: toggle left sidebar
 *   - ⌘⌥B: toggle right sidebar
 *   - ⌘R: refresh
 *   - ⌘⇧O: reopen previous repo
 *   - ⌘Q: quit
 *   - ⌘⇧N: new window
 *   - ⌃⌘W: close window
 *   - ⌃⌘F: toggle full screen
 *   - Esc: close any open dialog / menu
 *
 * Conflicts (documented, not resolved — see palette cheatsheet):
 *   - ⌘N: cmux=new workspace, gitsu=new worktree (kept)
 *   - ⌘[ / ⌘]: also zsh/terminal history widgets
 *   - ⌘R: cmux=rename tab; gitsu=refresh
 *   - ⌘P: cmux=workspace switcher; gitsu=command palette via ⌘⇧P
 */

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useRepoStore, startPolling, stopPolling } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { useHooksStore } from "@/stores/hooks";
import { useTerminalStore } from "@/stores/terminal";
import { useMergeStore } from "@/stores/merge";
import { usePrefsStore } from "@/stores/prefs";
import { useDirectoryStore } from "@/stores/directory";
import { WorktreeList } from "@/components/worktree/WorktreeList";
import { CreateWorktreeDialog } from "@/components/worktree/CreateWorktreeDialog";
import { RemoveWorktreeDialog } from "@/components/worktree/RemoveWorktreeDialog";
import { CommitGraph } from "@/components/graph/CommitGraph";
import { CommitPanel } from "@/components/commit/CommitPanel";
import { TerminalStrip } from "@/components/terminal/TerminalStrip";
import { DirectoryExplorer } from "@/components/directory/DirectoryExplorer";
import { HookSetupPrompt } from "@/components/hooks/HookSetupPrompt";
import { HooksManager } from "@/components/hooks/HooksManager";
import { MergeDialog } from "@/components/merge/MergeDialog";
import { ConflictEditor } from "@/components/merge/ConflictEditor";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { ProjectSwitcher } from "@/components/palette/ProjectSwitcher";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { Button, Pill } from "@/components/ui/primitives";
import {
  GitBranch,
  FolderOpen,
  AlertTriangle,
  Plus,
  X,
  Settings as SettingsIcon,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Command,
} from "lucide-react";
import { BrandMark, HankoSeal } from "@/components/ui/BrandMark";
import type { Worktree } from "@/lib/types";
import { sortWorktrees } from "@/lib/worktree";

const LEFT_PANE_MIN = 220;
const LEFT_PANE_MAX = 480;
const RIGHT_PANE_MIN = 280;
const RIGHT_PANE_MAX = 600;
const LEFT_DEFAULT = 280;
const RIGHT_DEFAULT = 360;

export default function App() {
  const {
    repo,
    recents,
    error,
    version,
    lastFetched,
    refreshRecents,
    pickAndOpen,
    openByPath,
    closeRepo,
    clearError,
    refresh,
    forget,
  } = useRepoStore();
  const graphFetch = useGraphStore((s) => s.fetch);
  const graphClear = useGraphStore((s) => s.clear);
  const graphSetActive = useGraphStore((s) => s.setActive);
  const hooksFetch = useHooksStore((s) => s.fetch);
  const hooksClear = useHooksStore((s) => s.clear);
  const terminalClear = useTerminalStore((s) => s.clear);
  const directoryClear = useDirectoryStore((s) => s.clear);
  const mergeOpen = useMergeStore((s) => s.open);
  const mergeClose = useMergeStore((s) => s.close);
  const mergePhase = useMergeStore((s) => s.phase);
  const hideGraphPanel = usePrefsStore((s) => s.hideGraphPanel);
  const toggleHideGraphPanel = usePrefsStore((s) => s.toggleHideGraphPanel);
  const hideWorktreeList = usePrefsStore((s) => s.hideWorktreeList);
  const toggleHideWorktreeList = usePrefsStore((s) => s.toggleHideWorktreeList);
  const hideCommitPanel = usePrefsStore((s) => s.hideCommitPanel);
  const toggleHideCommitPanel = usePrefsStore((s) => s.toggleHideCommitPanel);

  const [createOpen, setCreateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Worktree | null>(null);
  const [hooksManagerOpen, setHooksManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);

  // Which worktree the terminal hotkeys should target. The TerminalStrip
  // keeps this in sync via the store; we read+write it here so the
  // global hotkey handler can call split/close/zoom/etc. on the right
  // worktree.
  const setSelectedTerminalWorktree = useTerminalStore((s) => s.setSelectedWorktree);

  useEffect(() => {
    refreshRecents();
  }, [refreshRecents]);

  useEffect(() => {
    if (repo) startPolling();
    else stopPolling();
    return () => stopPolling();
  }, [repo]);

  useEffect(() => {
    if (!repo) {
      graphClear();
      hooksClear();
      void terminalClear();
      directoryClear();
      return;
    }
    graphFetch(repo.path);
    hooksFetch(repo.path);
  }, [repo, graphFetch, graphClear, hooksFetch, hooksClear, terminalClear, directoryClear]);

  // ── Global hotkeys ───────────────────────────────────────────
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
        const focused = term.focusedPane.get(wt) ?? (layout ? firstLeafId(layout) : undefined);

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
  ]);

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
      void graphSetActive(next.path);
      setSelectedTerminalWorktree(next.path);
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
      void graphSetActive(prev.path);
      setSelectedTerminalWorktree(prev.path);
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
    const focused = term.focusedPane.get(wt) ?? firstLeafId(layout);
    if (focused) void term.splitPane(wt, focused, "v");
  };
  const closeCurrentTerminal = () => {
    const wt = useTerminalStore.getState().selectedWorktree ?? useRepoStore.getState().repo?.path;
    if (!wt) return;
    const term = useTerminalStore.getState();
    const layout = term.layouts.get(wt);
    if (!layout) return;
    const focused = term.focusedPane.get(wt) ?? firstLeafId(layout);
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
    const focused = term.focusedPane.get(wt) ?? firstLeafId(layout);
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
    if (target) void openByPath(target.path);
  };
  const toggleFullscreen = async () => {
    const w = getCurrentWindow();
    const isFs = await w.isFullscreen();
    await w.setFullscreen(!isFs);
  };

  return (
    <div className="flex h-full flex-col app-shell">
      {/* Drifting silver aurora behind the app (z:0).
          Three radial-gradient blooms drift slowly with
          mix-blend-mode: screen. Respects prefers-reduced-motion. */}
      <div className="aurora" aria-hidden="true">
        <div className="bloom" />
      </div>

      {/* Zen watermark: ensō brush ring + giant 柔 kanji.
          Sits between the aurora and the panels. */}
      <div className="zen" aria-hidden="true">
        <svg
          className="enso"
          viewBox="0 0 100 100"
          fill="none"
        >
          <path
            d="M 64 9 A 44 44 0 1 1 40 11"
            stroke="white"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <path
            d="M 64 9 A 44 44 0 1 1 40 11"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.5"
            transform="translate(0.6 0.4)"
          />
        </svg>
        <div className="kanji-mark">柔</div>
      </div>

      <Header
        repo={repo}
        version={version}
        lastFetched={lastFetched}
        viewHidden={hideGraphPanel}
        leftHidden={hideWorktreeList}
        rightHidden={hideCommitPanel}
        onToggleView={toggleHideGraphPanel}
        onToggleLeft={toggleHideWorktreeList}
        onToggleRight={toggleHideCommitPanel}
        onOpen={pickAndOpen}
        onCreate={() => setCreateOpen(true)}
        onRefresh={() => {
          if (repo) void refresh();
          if (repo) void graphFetch(repo.path);
        }}
        onHooks={() => setHooksManagerOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onCommandPalette={() => setCommandPaletteOpen(true)}
        onCloseRepo={closeRepo}
      />

      {error && (
        <div className="mx-3 mt-3 banner">
          <span className="flex flex-1 items-center gap-2 text-danger">
            <AlertTriangle size={14} strokeWidth={1.5} />
            {error}
          </span>
          <button
            onClick={clearError}
            className="rounded p-0.5 text-danger/80 hover:bg-white/[0.04] transition-colors duration-150"
            title="Dismiss"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {repo && <HookSetupPrompt />}

      <main className="flex flex-1 flex-col overflow-hidden">
        {repo ? (
          <div className="flex flex-1 overflow-hidden">
            {/* Left pane: worktree list — toggleable via ⌘B. */}
            {!hideWorktreeList && (
              <ResizablePane
                width={leftWidth}
                min={LEFT_PANE_MIN}
                max={LEFT_PANE_MAX}
                onResize={setLeftWidth}
                side="right"
              >
                <WorktreeList
                  onRemove={(wt) => setRemoveTarget(wt)}
                  onSelect={(wt) => {
                    if (wt.path) {
                      void graphSetActive(wt.path);
                      setSelectedTerminalWorktree(wt.path);
                    }
                  }}
                  onMerge={(wt) => {
                    if (wt.is_main) return;
                    if (!wt.branch || !wt.path) return;
                    const target = useRepoStore.getState().worktrees?.default_branch ?? "main";
                    mergeOpen(wt.path, wt.branch, target);
                  }}
                />
              </ResizablePane>
            )}

            {hideGraphPanel ? (
              <>
                <TerminalStrip fillsAvailable />
                {/* Right pane: directory explorer. In terminal view
                    the commit panel is replaced by a file tree
                    rooted at the focused terminal's CWD. The
                    explorer is always visible — ⌘⌥B is not
                    relevant here since the two sidebars serve
                    different "modes" (graph vs terminal). */}
                <ResizablePane
                  width={rightWidth}
                  min={RIGHT_PANE_MIN}
                  max={RIGHT_PANE_MAX}
                  onResize={setRightWidth}
                  side="left"
                >
                  <DirectoryExplorer />
                </ResizablePane>
              </>
            ) : (
              <>
                <div className="flex-1 overflow-hidden bg-bg">
                  <CommitGraph />
                </div>
                {/* Right pane: commit panel — toggleable via ⌘⌥B. */}
                {!hideCommitPanel && (
                  <ResizablePane
                    width={rightWidth}
                    min={RIGHT_PANE_MIN}
                    max={RIGHT_PANE_MAX}
                    onResize={setRightWidth}
                    side="left"
                  >
                    <CommitPanel />
                  </ResizablePane>
                )}
              </>
            )}
          </div>
        ) : (
          <Home
            onOpen={pickAndOpen}
            onPickRecent={openByPath}
            recents={recents}
            onForget={forget}
            onCommandPalette={() => setCommandPaletteOpen(true)}
          />
        )}
      </main>

      {createOpen && <CreateWorktreeDialog onClose={() => setCreateOpen(false)} />}
      {removeTarget && (
        <RemoveWorktreeDialog
          worktree={removeTarget}
          onClose={() => setRemoveTarget(null)}
        />
      )}
      {hooksManagerOpen && (
        <HooksManager onClose={() => setHooksManagerOpen(false)} />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {paletteOpen && <ProjectSwitcher onClose={() => setPaletteOpen(false)} />}
      {commandPaletteOpen && (
        <CommandPalette
          onClose={() => setCommandPaletteOpen(false)}
          onOpenRepo={() => {
            void pickAndOpen();
          }}
          onNewWorktree={() => setCreateOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHooks={() => setHooksManagerOpen(true)}
          onToggleGraph={() => toggleHideGraphPanel()}
          onToggleFullscreen={() => void toggleFullscreen()}
          onReopenLastRepo={() => reopenLastRepo()}
          onNewTerminal={() => newTerminalInSelected()}
          onCloseTerminal={() => closeCurrentTerminal()}
          onSplitRight={() => splitTerminal("v")}
          onSplitDown={() => splitTerminal("h")}
          onEqualizeSplits={() => equalizeCurrent()}
          onReopenClosedPane={() => reopenClosed()}
          onNextWorktree={() => cycleNextWorktree()}
          onPrevWorktree={() => cyclePrevWorktree()}
        />
      )}
      {mergePhase !== "idle" && mergePhase !== "resolving" && <MergeDialog />}
      {mergePhase === "resolving" && <ConflictEditor />}

      {/* unused-import silencer — `mergeClose` is referenced by
          ConflictEditor/MergeDialog internals. We read the store
          directly to detect "open or not". The reference keeps the
          tree-shaker honest about the dependency. */}
      {false ? <button onClick={() => mergeClose()}>x</button> : null}
    </div>
  );
}

function ResizablePane({
  width,
  min,
  max,
  onResize,
  side,
  children,
}: {
  width: number;
  min: number;
  max: number;
  onResize: (w: number) => void;
  side: "left" | "right";
  children: React.ReactNode;
}) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = side === "right" ? startW + dx : startW - dx;
      onResize(Math.max(min, Math.min(max, next)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  return (
    <div
      className="relative h-full overflow-auto border-white/[0.06] bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.15)]"
      style={{
        width,
        flexShrink: 0,
        borderRightWidth: side === "right" ? 1 : 0,
        borderLeftWidth: side === "left" ? 1 : 0,
        borderStyle: "solid",
      }}
    >
      {children}
      {/* Drag handle. The outer div is the 12px hit area (so the
          splitter is easy to grab); the inner 1px div is the visible
          line (always shown, highlighted on hover). The outer div is
          position with [side]: -6 (half the hit width off the edge)
          so its center sits on the pane boundary. */}
      <div
        onMouseDown={onMouseDown}
        className="group absolute top-0 h-full w-3 cursor-col-resize"
        style={{
          [side]: -6,
        }}
        title="Drag to resize"
      >
        <div
          className="h-full w-px transition-all duration-200 ease-standard group-hover:bg-accent/50 group-hover:shadow-[0_0_6px_rgba(94,106,210,0.25)]"
          style={{ marginLeft: "auto", marginRight: "auto", backgroundColor: "rgba(255,255,255,0.06)" }}
        />
      </div>
    </div>
  );
}

function Header({
  repo,
  version,
  lastFetched,
  viewHidden,
  leftHidden,
  rightHidden,
  onToggleView,
  onToggleLeft,
  onToggleRight,
  onOpen,
  onCreate,
  onRefresh,
  onHooks,
  onSettings,
  onCommandPalette,
  onCloseRepo,
}: {
  repo: ReturnType<typeof useRepoStore.getState>["repo"];
  version: ReturnType<typeof useRepoStore.getState>["version"];
  lastFetched: number | null;
  viewHidden: boolean;
  leftHidden: boolean;
  rightHidden: boolean;
  onToggleView: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpen: () => void;
  onCreate: () => void;
  onRefresh: () => void;
  onHooks: () => void;
  onSettings: () => void;
  onCommandPalette: () => void;
  onCloseRepo: () => void;
}) {
  return (
    <header className="relative flex items-center justify-between gap-4 bg-bg px-4 py-2.5 z-10">
      {/* Subtle gradient bottom border */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="text-[15px] font-semibold tracking-tight text-fg">gitsu</span>
          <HankoSeal />
        </div>
        {repo ? (
          <>
            <span className="text-fg-muted/40">/</span>
            <button
              onClick={onCloseRepo}
              className="truncate rounded font-mono text-[13px] text-fg hover:text-accent transition-colors duration-150"
              title={`${repo.path}\n(click to go back to recents)`}
            >
              {repo.name}
            </button>
            {version && (
              <Pill tone={version.wt ? "accent" : "danger"} title={version.path ?? ""}>
                wt {version.wt || "?"}
              </Pill>
            )}
          </>
        ) : (
          <span className="text-fg-muted text-[13px]">worktree-first git client</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {lastFetched && (
          <span className="text-[11px] text-fg-muted tabular-nums" title={new Date(lastFetched).toLocaleString()}>
            updated {secondsAgo(lastFetched)}
          </span>
        )}
        {repo && (
          <>
            <Button onClick={onCommandPalette} title="Command palette (⌘⇧P)">
              <Command size={14} strokeWidth={1.5} /> Palette
            </Button>
            <Button
              onClick={onToggleLeft}
              title={leftHidden ? "Show worktree list (⌘B)" : "Hide worktree list (⌘B)"}
              aria-pressed={leftHidden}
            >
              {leftHidden ? <PanelLeftOpen size={14} strokeWidth={1.5} /> : <PanelLeftClose size={14} strokeWidth={1.5} />}
            </Button>
            <Button
              onClick={onToggleRight}
              title={
                viewHidden
                  ? rightHidden
                    ? "Show file explorer (⌘⌥B)"
                    : "Hide file explorer (⌘⌥B)"
                  : rightHidden
                    ? "Show commit panel (⌘⌥B)"
                    : "Hide commit panel (⌘⌥B)"
              }
              aria-pressed={rightHidden}
            >
              {rightHidden ? <PanelRightOpen size={14} strokeWidth={1.5} /> : <PanelRightClose size={14} strokeWidth={1.5} />}
            </Button>
            <Button
              onClick={onToggleView}
              title={
                viewHidden
                  ? "Show graph & commit panel"
                  : "Hide graph & commit panel (worktree list only)"
              }
              aria-pressed={viewHidden}
            >
              {viewHidden ? (
                <PanelRightOpen size={14} strokeWidth={1.5} />
              ) : (
                <PanelRightClose size={14} strokeWidth={1.5} />
              )}
              {viewHidden ? "Show graph" : "Hide graph"}
            </Button>
            <Button onClick={onSettings} title="Settings (⌘,)">
              <SettingsIcon size={14} strokeWidth={1.5} /> Settings
            </Button>
            <Button onClick={onHooks} title="Hooks & worktree config (⌘⇧,)">
              <GitBranch size={14} strokeWidth={1.5} /> Hooks
            </Button>
            <Button onClick={onRefresh} title="Refresh (⌘R)">
              Refresh
            </Button>
            <Button variant="primary" onClick={onCreate} title="New worktree (⌘N / Ctrl+N)">
              <Plus size={14} strokeWidth={1.5} /> New worktree
            </Button>
          </>
        )}
        {!repo && (
          <>
            <Button onClick={onCommandPalette} title="Command palette (⌘⇧P)">
              <Command size={14} strokeWidth={1.5} /> Palette
            </Button>
            <Button variant="primary" onClick={onOpen}>
              <FolderOpen size={14} strokeWidth={1.5} /> Open repo
            </Button>
          </>
        )}
      </div>
    </header>
  );
}

function Home({
  onOpen,
  onPickRecent,
  recents,
  onForget,
  onCommandPalette,
}: {
  onOpen: () => void;
  onPickRecent: (path: string) => void;
  recents: ReturnType<typeof useRepoStore.getState>["recents"];
  onForget: (path: string) => void;
  onCommandPalette: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-10">
      <section className="text-center">
        <h1 className="mb-3 text-[28px] font-semibold tracking-tight text-fg">
          Worktrees, <span className="text-accent">first</span>.
        </h1>
        <p className="mx-auto max-w-md text-fg-muted leading-relaxed text-[14px]">
          A Git desktop client where every branch gets its own folder, its own terminal, its own state — all in one
          window, powered by{" "}
          <a className="text-accent hover:underline underline-offset-2" href="https://worktrunk.dev" target="_blank" rel="noreferrer">
            worktrunk
          </a>
          .
        </p>
        <div className="mt-8 flex items-center justify-center gap-2">
          <Button variant="primary" onClick={onOpen}>
            <FolderOpen size={14} strokeWidth={1.5} /> Open a repository
          </Button>
          <Button onClick={onCommandPalette} title="Command palette (⌘⇧P)">
            <Command size={14} strokeWidth={1.5} /> Command palette
          </Button>
        </div>
      </section>

      {recents.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Recent</h2>
          <ul className="flex flex-col gap-2">
            {recents.map((r) => (
              <li
                key={r.path}
                className="group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-bg-panel px-4 py-3 transition-all duration-200 ease-standard hover:border-white/[0.1] hover:bg-[#2F3135] hover:shadow-[0_2px_12px_rgba(0,0,0,0.2)] hover:-translate-y-px"
              >
                <GitBranch size={16} className="text-accent shrink-0" strokeWidth={1.5} />
                <button
                  className="flex-1 truncate text-left text-[13px] font-medium text-fg hover:text-accent transition-colors duration-150"
                  onClick={() => onPickRecent(r.path)}
                  title={r.path}
                >
                  {r.name}
                  <span className="ml-2 truncate font-mono text-[12px] font-normal text-fg-muted">{r.path}</span>
                </button>
                <button
                  className="rounded p-1 text-fg-muted opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100 transition-all duration-150"
                  onClick={() => onForget(r.path)}
                  title="Forget"
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function secondsAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  return `${m}m ago`;
}

// ── Local helpers (only used by the hotkey listener above) ─────

import type { Layout } from "@/stores/terminal";
function firstLeafId(layout: Layout): string | undefined {
  if (layout.kind === "pane") return layout.id;
  if (layout.kind === "filepane") return layout.id;
  return firstLeafId(layout.a) ?? firstLeafId(layout.b);
}
