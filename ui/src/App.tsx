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
 * in-palette cheatsheet for the full list). The keydown listener
 * itself lives in `@/hooks/useGlobalHotkeys`; the terminal/worktree
 * action helpers used by the command palette live in
 * `@/hooks/useTerminalActions`.
 */

import { useEffect, useState } from "react";
import { useRepoStore, startPolling, stopPolling } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { useHooksStore } from "@/stores/hooks";
import { useMergeStore } from "@/stores/merge";
import { usePrefsStore } from "@/stores/prefs";
import { useDirectoryStore } from "@/stores/directory";
import { CreateWorktreeDialog } from "@/components/worktree/CreateWorktreeDialog";
import { RemoveWorktreeDialog } from "@/components/worktree/RemoveWorktreeDialog";
import { HookSetupPrompt } from "@/components/hooks/HookSetupPrompt";
import { HooksManager } from "@/components/hooks/HooksManager";
import { MergeDialog } from "@/components/merge/MergeDialog";
import { ConflictEditor } from "@/components/merge/ConflictEditor";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { ProjectSwitcher } from "@/components/palette/ProjectSwitcher";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { Header } from "@/components/layout/Header";
import { Home } from "@/components/layout/Home";
import { Dashboard } from "@/components/layout/Dashboard";
import { useGlobalHotkeys } from "@/hooks/useGlobalHotkeys";
import { useTerminalActions } from "@/hooks/useTerminalActions";
import { AlertTriangle, X } from "lucide-react";
import type { Worktree } from "@/lib/types";

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
  const hooksFetch = useHooksStore((s) => s.fetch);
  const hooksClear = useHooksStore((s) => s.clear);
  const directoryClear = useDirectoryStore((s) => s.clear);
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
      // NOTE: the terminal store is intentionally NOT cleared
      // here. PTY shells are kept alive in the backend (the
      // `portable-pty` registry is process-lifetime), and the
      // store preserves per-worktree layouts, focus, and the
      // xterm scrollback round-tripped via `serializedState`.
      // Clearing on close meant every "close project → reopen
      // project" round-trip killed all shells and the user
      // landed on a fresh blank terminal with no history.
      // We only reap a shell when its worktree is removed
      // (`wt remove` → `pty::teardown_for_worktree`).
      directoryClear();
      return;
    }
    graphFetch(repo.path);
    hooksFetch(repo.path);
  }, [repo, graphFetch, graphClear, hooksFetch, hooksClear, directoryClear]);

  useGlobalHotkeys({
    setCreateOpen,
    setRemoveTarget,
    setHooksManagerOpen,
    setSettingsOpen,
    setPaletteOpen,
    setCommandPaletteOpen,
  });

  const {
    cycleNextWorktree,
    cyclePrevWorktree,
    newTerminalInSelected,
    closeCurrentTerminal,
    splitTerminal,
    equalizeCurrent,
    reopenClosed,
    reopenLastRepo,
    toggleFullscreen,
  } = useTerminalActions();

  return (
    <div className="flex h-full flex-col app-shell">
      {/* Static near-black steel backdrop behind the glass panels. */}
      <div className="backdrop" aria-hidden="true" />

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
          <Dashboard
            hideWorktreeList={hideWorktreeList}
            hideGraphPanel={hideGraphPanel}
            hideCommitPanel={hideCommitPanel}
            leftWidth={leftWidth}
            rightWidth={rightWidth}
            onLeftResize={setLeftWidth}
            onRightResize={setRightWidth}
            onRemoveWorktree={(wt) => setRemoveTarget(wt)}
          />
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
