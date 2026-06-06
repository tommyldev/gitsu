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
  Folder as FolderIcon,
  Search as SearchIcon,
  X as XIcon,
} from "lucide-react";
import { useDirectoryStore } from "@/stores/directory";
import { useRepoStore } from "@/stores/repo";
import { useTerminalStore } from "@/stores/terminal";
import { DirectoryTree, EmptyHint } from "./DirectoryTree";
import { SearchResults } from "./SearchResults";
import { useFocusedCwd } from "./useFocusedCwd";
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
