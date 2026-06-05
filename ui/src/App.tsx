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
 * Hotkeys:
 *   - ⌘N / Ctrl+N: new worktree
 *   - ⌘O / Ctrl+O: open repo
 *   - ⌘K / Ctrl+K: project switcher palette (rapid project switch
 *     + "← All projects" entry to return to the projects view)
 *   - ⌘1..⌘9 / Ctrl+1..Ctrl+9: switch to Nth worktree in the list
 *   - ⌘⇧, : hooks & worktree config (⌘, is reserved for system prefs)
 *   - Esc: close any open dialog / menu
 */

import { useEffect, useState } from "react";
import { useRepoStore, startPolling, stopPolling } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { useHooksStore } from "@/stores/hooks";
import { useTerminalStore } from "@/stores/terminal";
import { useMergeStore } from "@/stores/merge";
import { usePrefsStore } from "@/stores/prefs";
import { WorktreeList } from "@/components/worktree/WorktreeList";
import { CreateWorktreeDialog } from "@/components/worktree/CreateWorktreeDialog";
import { RemoveWorktreeDialog } from "@/components/worktree/RemoveWorktreeDialog";
import { CommitGraph } from "@/components/graph/CommitGraph";
import { CommitPanel } from "@/components/commit/CommitPanel";
import { TerminalStrip } from "@/components/terminal/TerminalStrip";
import { HookSetupPrompt } from "@/components/hooks/HookSetupPrompt";
import { HooksManager } from "@/components/hooks/HooksManager";
import { MergeDialog } from "@/components/merge/MergeDialog";
import { ConflictEditor } from "@/components/merge/ConflictEditor";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { Button, Pill } from "@/components/ui/primitives";
import {
  GitBranch,
  FolderOpen,
  GitFork,
  AlertTriangle,
  Plus,
  X,
  Settings as SettingsIcon,
  PanelRightClose,
  PanelRightOpen,
  LayoutGrid,
} from "lucide-react";
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
  const mergeOpen = useMergeStore((s) => s.open);
  const mergeClose = useMergeStore((s) => s.close);
  const mergePhase = useMergeStore((s) => s.phase);
  const hideGraphPanel = usePrefsStore((s) => s.hideGraphPanel);
  const toggleHideGraphPanel = usePrefsStore((s) => s.toggleHideGraphPanel);

  const [createOpen, setCreateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Worktree | null>(null);
  const [hooksManagerOpen, setHooksManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
      void terminalClear();
      return;
    }
    graphFetch(repo.path);
    hooksFetch(repo.path);
  }, [repo, graphFetch, graphClear, hooksFetch, hooksClear, terminalClear]);

  // Global hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Don't steal the user's shortcuts while they're typing.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (mod && e.key === "n" && repo) {
        e.preventDefault();
        setCreateOpen(true);
      }
      if (mod && e.key === "o") {
        e.preventDefault();
        pickAndOpen();
      }
      // ⌘/Ctrl + K → toggle the project switcher palette. Toggling
      // (not just opening) means the user can dismiss it with the
      // same gesture, and it's symmetric with the system's own
      // ⌘K behavior in most apps.
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((p) => !p);
        return;
      }
      // ⌘/Ctrl + 1..9 → switch to Nth worktree in the list (uses
      // the same sort as WorktreeList so the row labels match).
      // We require e.code (layout-independent) and reject any
      // non-Cmd/Ctrl modifier so we don't fight ⌘⇧1 etc.
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
        }
      }
      if (mod && e.shiftKey && e.key === ",") {
        e.preventDefault();
        setHooksManagerOpen(true);
      }
      if (mod && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if (e.key === "Escape") {
        setCreateOpen(false);
        setRemoveTarget(null);
        setHooksManagerOpen(false);
        setSettingsOpen(false);
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [repo, pickAndOpen, graphSetActive]);

  return (
    <div className="flex h-full flex-col">
      <Header
        repo={repo}
        version={version}
        lastFetched={lastFetched}
        viewHidden={hideGraphPanel}
        onToggleView={toggleHideGraphPanel}
        onOpen={pickAndOpen}
        onPalette={() => setPaletteOpen(true)}
        onCreate={() => setCreateOpen(true)}
        onRefresh={() => {
          refresh();
          if (repo) graphFetch(repo.path);
        }}
        onHooks={() => setHooksManagerOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      {error && (
        <div className="flex items-start justify-between gap-2 border-b border-white/[0.06] bg-danger/10 px-4 py-2 text-[13px] text-danger shadow-[0_2px_8px_rgba(239,83,80,0.08)]">
          <span className="flex items-center gap-2">
            <AlertTriangle size={14} strokeWidth={1.5} />
            {error}
          </span>
          <button onClick={clearError} className="rounded p-0.5 hover:bg-white/[0.04] transition-colors duration-150">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {repo && <HookSetupPrompt />}

      <main className="flex flex-1 flex-col overflow-hidden">
        {repo ? (
          <>
            <div className="flex flex-1 overflow-hidden">
              {/* Left pane: worktree list — always visible, doubles
                  as a fixed-width sidebar in both layouts. */}
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
                    // Detached or path-less worktrees can't be graphed.
                    if (wt.path) void graphSetActive(wt.path);
                  }}
                  onMerge={(wt) => {
                    if (wt.is_main) return;
                    // Detached worktrees can't be merged via
                    // `wt switch --create <branch>`. The button is
                    // already hidden for them in WorktreeList, but
                    // double-check defensively.
                    if (!wt.branch || !wt.path) return;
                    const target = useRepoStore.getState().worktrees?.default_branch ?? "main";
                    mergeOpen(wt.path, wt.branch, target);
                  }}
                />
              </ResizablePane>

              {hideGraphPanel ? (
                // Graph hidden: terminal takes the rest of the row
                // (most of the view) and we drop the bottom strip.
                <TerminalStrip fillsAvailable />
              ) : (
                <>
                  {/* Center pane: commit graph */}
                  <div className="flex-1 overflow-hidden bg-bg">
                    <CommitGraph />
                  </div>

                  {/* Right pane: commit details */}
                  <ResizablePane
                    width={rightWidth}
                    min={RIGHT_PANE_MIN}
                    max={RIGHT_PANE_MAX}
                    onResize={setRightWidth}
                    side="left"
                  >
                    <CommitPanel />
                  </ResizablePane>
                </>
              )}
            </div>
          </>
        ) : (
          <Home
            onOpen={pickAndOpen}
            onPickRecent={openByPath}
            recents={recents}
            onForget={forget}
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
  onToggleView,
  onOpen,
  onCreate,
  onRefresh,
  onHooks,
  onSettings,
}: {
  repo: ReturnType<typeof useRepoStore.getState>["repo"];
  version: ReturnType<typeof useRepoStore.getState>["version"];
  lastFetched: number | null;
  viewHidden: boolean;
  onToggleView: () => void;
  onOpen: () => void;
  onCreate: () => void;
  onRefresh: () => void;
  onHooks: () => void;
  onSettings: () => void;
}) {
  return (
    <header className="relative flex items-center justify-between gap-4 bg-bg px-4 py-2.5 z-10">
      {/* Subtle gradient bottom border */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <GitFork size={18} className="text-accent" strokeWidth={1.5} />
          <span className="text-[15px] font-semibold tracking-tight text-fg">gitsu</span>
        </div>
        {repo ? (
          <>
            <span className="text-fg-muted/40">/</span>
            <span className="truncate font-mono text-[13px] text-fg" title={repo.path}>
              {repo.name}
            </span>
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
            <Button
              onClick={onToggleView}
              title={
                viewHidden
                  ? "Show graph & file panel"
                  : "Hide graph & file panel (worktree list only)"
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
            <Button onClick={onRefresh} title="Refresh (R)">
              Refresh
            </Button>
            <Button variant="primary" onClick={onCreate} title="New worktree (⌘N / Ctrl+N)">
              <Plus size={14} strokeWidth={1.5} /> New worktree
            </Button>
          </>
        )}
        {!repo && (
          <Button variant="primary" onClick={onOpen}>
            <FolderOpen size={14} strokeWidth={1.5} /> Open repo
          </Button>
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
}: {
  onOpen: () => void;
  onPickRecent: (path: string) => void;
  recents: ReturnType<typeof useRepoStore.getState>["recents"];
  onForget: (path: string) => void;
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
