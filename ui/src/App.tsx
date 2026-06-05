/**
 * Top-level App component.
 *
 * Routes between:
 *   - Home: recents list + "Open repo" button
 *   - Dashboard: 3-pane worktree-first view
 *     (worktrees | graph | commit panel)
 *     with a bottom strip for per-worktree terminals
 *
 * Hotkeys:
 *   - ⌘N / Ctrl+N: new worktree
 *   - ⌘O / Ctrl+O: open repo
 *   - ⌘⇧, : hooks & worktree config (⌘, is reserved for system prefs)
 *   - Esc: close any open dialog / menu
 */

import { useEffect, useState } from "react";
import { useRepoStore, startPolling, stopPolling } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { useHooksStore } from "@/stores/hooks";
import { useTerminalStore } from "@/stores/terminal";
import { useMergeStore } from "@/stores/merge";
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
} from "lucide-react";
import type { Worktree } from "@/lib/types";

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
  const hooksFetch = useHooksStore((s) => s.fetch);
  const hooksClear = useHooksStore((s) => s.clear);
  const terminalClear = useTerminalStore((s) => s.clear);
  const mergeOpen = useMergeStore((s) => s.open);
  const mergeClose = useMergeStore((s) => s.close);
  const mergePhase = useMergeStore((s) => s.phase);

  const [createOpen, setCreateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Worktree | null>(null);
  const [hooksManagerOpen, setHooksManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      if (mod && e.key === "n" && repo) {
        e.preventDefault();
        setCreateOpen(true);
      }
      if (mod && e.key === "o") {
        e.preventDefault();
        pickAndOpen();
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [repo, pickAndOpen]);

  return (
    <div className="flex h-full flex-col">
      <Header
        repo={repo}
        version={version}
        lastFetched={lastFetched}
        onOpen={pickAndOpen}
        onCreate={() => setCreateOpen(true)}
        onRefresh={() => {
          refresh();
          if (repo) graphFetch(repo.path);
        }}
        onHooks={() => setHooksManagerOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      {error && (
        <div className="flex items-start justify-between gap-2 border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          <span className="flex items-center gap-2">
            <AlertTriangle size={14} />
            {error}
          </span>
          <button onClick={clearError} className="rounded p-0.5 hover:bg-danger/20">
            <X size={14} />
          </button>
        </div>
      )}

      {repo && <HookSetupPrompt />}

      <main className="flex flex-1 flex-col overflow-hidden">
        {repo ? (
          <>
            <div className="flex flex-1 overflow-hidden">
              {/* Left pane: worktree list */}
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
                    if (wt.path) graphFetch(wt.path);
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

              {/* Center pane: commit graph */}
              <div className="flex-1 overflow-hidden">
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
            </div>

            {/* Bottom strip: per-worktree terminals */}
            <TerminalStrip />
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
      className="relative h-full overflow-auto border-bg-subtle bg-bg-panel"
      style={{
        width,
        flexShrink: 0,
        borderRightWidth: side === "right" ? 1 : 0,
        borderLeftWidth: side === "left" ? 1 : 0,
        borderRight: side === "right" ? undefined : "none",
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
          className="h-full w-px bg-bg-subtle transition-colors group-hover:bg-accent"
          style={{ marginLeft: "auto", marginRight: "auto" }}
        />
      </div>
    </div>
  );
}

function Header({
  repo,
  version,
  lastFetched,
  onOpen,
  onCreate,
  onRefresh,
  onHooks,
  onSettings,
}: {
  repo: ReturnType<typeof useRepoStore.getState>["repo"];
  version: ReturnType<typeof useRepoStore.getState>["version"];
  lastFetched: number | null;
  onOpen: () => void;
  onCreate: () => void;
  onRefresh: () => void;
  onHooks: () => void;
  onSettings: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-bg-subtle bg-bg-panel px-4 py-2">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <GitFork size={18} className="text-accent" />
          <span className="text-lg font-semibold">gitsu</span>
        </div>
        {repo ? (
          <>
            <span className="text-fg-subtle">/</span>
            <span className="truncate font-mono text-sm" title={repo.path}>
              {repo.name}
            </span>
            {version && (
              <Pill tone={version.wt ? "accent" : "danger"} title={version.path ?? ""}>
                wt {version.wt || "?"}
              </Pill>
            )}
          </>
        ) : (
          <span className="text-fg-muted">worktree-first git client</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {lastFetched && (
          <span className="text-xs text-fg-subtle" title={new Date(lastFetched).toLocaleString()}>
            updated {secondsAgo(lastFetched)}
          </span>
        )}
        {repo && (
          <>
            <Button onClick={onSettings} title="Settings (⌘,)">
              <SettingsIcon size={14} /> Settings
            </Button>
            <Button onClick={onHooks} title="Hooks & worktree config (⌘⇧,)">
              <GitBranch size={14} /> Hooks
            </Button>
            <Button onClick={onRefresh} title="Refresh (R)">
              Refresh
            </Button>
            <Button variant="primary" onClick={onCreate} title="New worktree (⌘N / Ctrl+N)">
              <Plus size={14} /> New worktree
            </Button>
          </>
        )}
        {!repo && (
          <Button variant="primary" onClick={onOpen}>
            <FolderOpen size={14} /> Open repo
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
        <h1 className="mb-2 text-3xl font-semibold">
          Worktrees, <span className="text-accent">first</span>.
        </h1>
        <p className="mx-auto max-w-md text-fg-muted">
          A Git desktop client where every branch gets its own folder, its own terminal, its own state — all in one
          window, powered by{" "}
          <a className="text-accent hover:underline" href="https://worktrunk.dev" target="_blank" rel="noreferrer">
            worktrunk
          </a>
          .
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="primary" onClick={onOpen}>
            <FolderOpen size={14} /> Open a repository
          </Button>
        </div>
      </section>

      {recents.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">Recent</h2>
          <ul className="flex flex-col gap-1.5">
            {recents.map((r) => (
              <li
                key={r.path}
                className="group flex items-center gap-3 rounded-md border border-transparent bg-bg-panel p-3 hover:border-bg-subtle"
              >
                <GitBranch size={16} className="text-accent" />
                <button
                  className="flex-1 truncate text-left text-sm font-medium hover:text-accent"
                  onClick={() => onPickRecent(r.path)}
                  title={r.path}
                >
                  {r.name}
                  <span className="ml-2 truncate font-mono text-xs font-normal text-fg-subtle">{r.path}</span>
                </button>
                <button
                  className="rounded p-1 text-fg-subtle opacity-0 hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
                  onClick={() => onForget(r.path)}
                  title="Forget"
                >
                  <X size={14} />
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
