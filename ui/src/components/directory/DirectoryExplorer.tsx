/**
 * DirectoryExplorer — right-sidebar component shown in terminal
 * view. Lists the directory tree rooted at the focused terminal's
 * CWD. Files are click-to-open (opens a read-only file viewer
 * pane in the terminal strip via `terminal.openFile`).
 *
 * Wiring with the terminal store:
 *  - The focused pane's session has a `cwd` that updates as the
 *    user `cd`s around in the terminal (parsed from OSC 7 in the
 *    Rust reader thread). We mirror that into the directory store
 *    via `setRoot`.
 *  - The worktree path is the fallback root when no CWD is
 *    available yet (the first moment after a terminal spawns, the
 *    shell hasn't emitted its first prompt yet).
 *
 * Two view modes:
 *  1. **Browse** (default): collapsible tree of directories + files.
 *     Click a directory to expand/collapse; click a file to open it.
 *  2. **Search**: when the user types in the search bar (≥1 char),
 *     the tree hides and a flat list of file-name matches shows.
 *     This is the "filter" mode. Empty results show a small "no
 *     matches" message.
 *
 * Search is intentionally simple (filename substring, case-insensitive).
 * Content search across file bodies is a follow-up.
 *
 * Keyboard:
 *  - `/` focuses the search input (when not already focused).
 *  - `Esc` clears the search and returns focus to the tree.
 *  - `Enter` on a file row opens it; `Enter` on a directory row
 *    toggles expansion.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  Search as SearchIcon,
  X as XIcon,
} from "lucide-react";
import clsx from "clsx";
import { useDirectoryStore } from "@/stores/directory";
import { useRepoStore } from "@/stores/repo";
import { useTerminalStore, type Layout } from "@/stores/terminal";
import type { DirEntry } from "@/lib/types";

export function DirectoryExplorer() {
  const repo = useRepoStore((s) => s.repo);
  const worktrees = useRepoStore((s) => s.worktrees?.items) ?? [];
  const selectedWorktree = useTerminalStore((s) => s.selectedWorktree);

  const cwd = useFocusedCwd();
  const openFile = useTerminalStore((s) => s.openFile);

  // Mirror CWD into the directory store. Whenever the focused
  // terminal's CWD changes, the directory explorer re-roots itself.
  const setRoot = useDirectoryStore((s) => s.setRoot);
  const storeRoot = useDirectoryStore((s) => s.root);
  useEffect(() => {
    if (cwd !== storeRoot) setRoot(cwd);
  }, [cwd, storeRoot, setRoot]);

  // Auto-load the root directory listing on mount / root change.
  const loadDir = useDirectoryStore((s) => s.loadDir);
  useEffect(() => {
    if (storeRoot) void loadDir(storeRoot, true);
  }, [storeRoot, loadDir]);

  // Auto-expand the root so the user immediately sees the top-level
  // contents.
  const expanded = useDirectoryStore((s) => s.expanded);
  const setExpanded = useDirectoryStore((s) => s.setExpanded);
  useEffect(() => {
    if (storeRoot && !expanded.has(storeRoot)) {
      setExpanded([storeRoot]);
      void loadDir(storeRoot);
    }
  }, [storeRoot, expanded, setExpanded, loadDir]);

  // Search state.
  const searchQuery = useDirectoryStore((s) => s.searchQuery);
  const setSearchQuery = useDirectoryStore((s) => s.setSearchQuery);
  const runSearch = useDirectoryStore((s) => s.runSearch);
  const clearSearch = useDirectoryStore((s) => s.clearSearch);
  const searchResults = useDirectoryStore((s) => s.searchResults);
  const searching = useDirectoryStore((s) => s.searching);
  const error = useDirectoryStore((s) => s.error);
  const toggleExpanded = useDirectoryStore((s) => s.toggleExpanded);

  // Debounce search input. We wait 200ms after the last keystroke
  // before kicking off the IPC call. The query itself is reflected
  // immediately (so the input doesn't feel laggy), but the
  // results update on the debounce.
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim()) {
      // Clearing is instant — no need to debounce.
      void runSearch();
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      void runSearch();
    }, 200);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, runSearch]);

  // Keyboard: `/` focuses search (matches the VS Code convention).
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack `/` while the user is already typing in the
      // search bar (or any other input).
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click-to-open: route the entry to the terminal store's
  // `openFile`, which inserts a new `filepane` in the focused
  // pane's split tree. The new pane gets focus.
  const onFileClick = useCallback(
    (entry: DirEntry) => {
      if (!selectedWorktree) return;
      openFile(selectedWorktree, entry.path, storeRoot ?? entry.path);
    },
    [selectedWorktree, openFile, storeRoot],
  );

  // The worktree name (for the header). Falls back to the repo
  // name when no worktree is selected.
  const headerSubtitle = useMemo(() => {
    if (!selectedWorktree) return repo?.name ?? "";
    const wt = worktrees.find((w) => w.path === selectedWorktree);
    if (!wt || !wt.path) return selectedWorktree.split("/").pop() ?? "";
    return wt.branch ?? wt.path.split("/").pop() ?? "";
  }, [selectedWorktree, worktrees, repo]);

  if (!repo) return null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-white/[0.06] px-2">
        <FolderIcon size={12} strokeWidth={1.5} className="text-fg-muted shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Files
        </span>
        <span className="truncate text-[10px] text-fg-subtle font-mono" title={cwd ?? ""}>
          {headerSubtitle}
        </span>
      </div>

      {/* Search bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2">
        <SearchIcon size={11} strokeWidth={1.5} className="text-fg-muted shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Escape") {
              e.preventDefault();
              clearSearch();
              searchInputRef.current?.blur();
            }
          }}
          placeholder="Search files…  (press /)"
          className="min-w-0 flex-1 bg-transparent text-[11px] text-fg outline-none placeholder:text-fg-subtle"
        />
        {searchQuery && (
          <button
            onClick={clearSearch}
            title="Clear search (Esc)"
            className="rounded p-0.5 text-fg-muted hover:bg-white/[0.06] hover:text-fg transition-colors duration-150"
          >
            <XIcon size={10} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Body: tree or search results */}
      <div className="min-h-0 flex-1 overflow-auto bg-bg">
        {!cwd ? (
          <EmptyHint>No terminal focused.</EmptyHint>
        ) : searching ? (
          <EmptyHint>Searching…</EmptyHint>
        ) : searchQuery.trim() ? (
          <SearchResults
            root={cwd}
            results={searchResults}
            onOpenFile={onFileClick}
          />
        ) : (
          <DirectoryTree
            root={cwd}
            onOpenFile={onFileClick}
            onToggle={toggleExpanded}
          />
        )}
      </div>

      {/* Footer status line */}
      <div className="flex h-6 shrink-0 items-center gap-2 border-t border-white/[0.06] px-2 text-[10px] text-fg-subtle">
        {error ? (
          <span className="text-danger truncate" title={error}>
            {error}
          </span>
        ) : searchQuery.trim() ? (
          <span>{searchResults ? `${searchResults.length} match${searchResults.length === 1 ? "" : "es"}` : ""}</span>
        ) : cwd ? (
          <span title={cwd}>{cwd}</span>
        ) : null}
      </div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-fg-muted">
      {children}
    </div>
  );
}

function DirectoryTree({
  root,
  onOpenFile,
  onToggle,
}: {
  root: string;
  onOpenFile: (entry: DirEntry) => void;
  onToggle: (dir: string) => Promise<void>;
}) {
  const cache = useDirectoryStore((s) => s.cache);
  const expanded = useDirectoryStore((s) => s.expanded);
  const loading = useDirectoryStore((s) => s.loading);

  const renderNode = (dir: string, depth: number): React.ReactNode => {
    const entries = cache.get(dir) ?? [];
    const isExpanded = expanded.has(dir);
    const isLoading = loading.has(dir);
    return (
      <div key={dir}>
        <DirectoryRow
          depth={depth}
          entry={{
            name: dir.split("/").pop() || dir,
            path: dir,
            is_dir: true,
            size: null,
          }}
          isExpanded={isExpanded}
          isLoading={isLoading}
          onClick={() => void onToggle(dir)}
        />
        {isExpanded && entries.length > 0 && (
          <div>
            {entries.map((entry) =>
              entry.is_dir ? (
                renderNode(entry.path, depth + 1)
              ) : (
                <DirectoryRow
                  key={entry.path}
                  depth={depth + 1}
                  entry={entry}
                  isExpanded={false}
                  isLoading={false}
                  onClick={() => onOpenFile(entry)}
                />
              ),
            )}
          </div>
        )}
        {isExpanded && entries.length === 0 && !isLoading && (
          <div
            className="pl-6 py-1 text-[10px] text-fg-subtle"
            style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
          >
            (empty)
          </div>
        )}
      </div>
    );
  };

  return <div>{renderNode(root, 0)}</div>;
}

function DirectoryRow({
  entry,
  depth,
  isExpanded,
  isLoading,
  onClick,
}: {
  entry: DirEntry;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  onClick: () => void;
}) {
  const indent = depth * 12;
  const isDir = entry.is_dir;
  return (
    <button
      onClick={onClick}
      title={entry.path}
      className={clsx(
        "flex w-full min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-left text-[11px] transition-colors duration-150",
        "hover:bg-white/[0.04] focus:bg-white/[0.04] focus:outline-none",
      )}
      style={{ paddingLeft: `${indent + 6}px` }}
    >
      {isDir ? (
        isExpanded ? (
          <ChevronDown size={10} strokeWidth={1.5} className="text-fg-muted shrink-0" />
        ) : (
          <ChevronRight size={10} strokeWidth={1.5} className="text-fg-muted shrink-0" />
        )
      ) : (
        <span className="w-2.5 shrink-0" />
      )}
      {isDir ? (
        isExpanded ? (
          <FolderOpenIcon size={11} strokeWidth={1.5} className="text-accent shrink-0" />
        ) : (
          <FolderIcon size={11} strokeWidth={1.5} className="text-accent shrink-0" />
        )
      ) : (
        <FileIcon size={11} strokeWidth={1.5} className="text-fg-muted shrink-0" />
      )}
      <span className="truncate font-mono text-fg">{entry.name}</span>
      {isDir && isLoading && (
        <span className="ml-auto text-[9px] text-fg-subtle">…</span>
      )}
      {!isDir && entry.size != null && (
        <span className="ml-auto shrink-0 text-[10px] text-fg-subtle tabular-nums">
          {formatSize(entry.size)}
        </span>
      )}
    </button>
  );
}

function SearchResults({
  root,
  results,
  onOpenFile,
}: {
  root: string;
  results: string[] | null;
  onOpenFile: (entry: DirEntry) => void;
}) {
  if (results === null) {
    return <EmptyHint>Searching…</EmptyHint>;
  }
  if (results.length === 0) {
    return <EmptyHint>No matches</EmptyHint>;
  }
  // Show each match as `path/relative/to/root`. Highlight the
  // matching filename in the row.
  const rootPrefix = root.endsWith("/") ? root : root + "/";
  return (
    <div>
      {results.map((abs) => {
        const rel = abs.startsWith(rootPrefix) ? abs.slice(rootPrefix.length) : abs;
        const name = rel.split("/").pop() ?? rel;
        return (
          <button
            key={abs}
            onClick={() =>
              onOpenFile({ name, path: abs, is_dir: false, size: null })
            }
            title={abs}
            className="flex w-full min-w-0 items-center gap-1.5 px-2 py-0.5 text-left text-[11px] transition-colors duration-150 hover:bg-white/[0.04] focus:bg-white/[0.04] focus:outline-none"
          >
            <FileIcon size={11} strokeWidth={1.5} className="text-fg-muted shrink-0" />
            <span className="truncate font-mono text-fg" title={rel}>
              {rel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────

/** Look up the CWD of the focused terminal pane. Returns the
 * worktree path as a fallback (the initial CWD of any shell we
 * spawn). Returns `null` only when nothing is focused yet. */
function useFocusedCwd(): string | null {
  const selectedWorktree = useTerminalStore((s) => s.selectedWorktree);
  const focusedPaneId = useTerminalStore((s) =>
    selectedWorktree ? s.focusedPane.get(selectedWorktree) : undefined,
  );
  const sessions = useTerminalStore((s) => s.sessions);
  const layouts = useTerminalStore((s) =>
    selectedWorktree ? s.layouts.get(selectedWorktree) : undefined,
  );

  if (!selectedWorktree) return null;

  // Walk the layout to find the focused leaf and its sessionId.
  // If the focused leaf is a filepane, fall back to the worktree
  // (we still want the explorer to render even when the user has
  // clicked into a file viewer).
  const focusedLayout = findLayoutById(layouts, focusedPaneId ?? null);
  let sessionId: number | null = null;
  if (focusedLayout && focusedLayout.kind === "pane") {
    sessionId = focusedLayout.sessionId;
  }

  if (sessionId != null) {
    const sess = sessions.get(sessionId);
    if (sess) return sess.cwd;
  }

  // Fallback: worktree path.
  return selectedWorktree;
}

function findLayoutById(
  layout: Layout | undefined,
  paneId: string | null,
): { kind: "pane"; sessionId: number | null } | { kind: "filepane"; filePath: string; cwd: string } | null {
  if (!paneId || !layout) return null;
  if (layout.kind === "split") {
    return findLayoutById(layout.a, paneId) ?? findLayoutById(layout.b, paneId);
  }
  return layout.id === paneId ? layout : null;
}

/** Human-readable file size (e.g. 1.2K, 3.4M). */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}
