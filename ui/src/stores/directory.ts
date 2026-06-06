/**
 * Directory explorer state — caching, expanded-state, and search
 * query/results. The component (`components/directory/DirectoryExplorer.tsx`)
 * reads/writes this store; the root path comes from the terminal
 * store's focused PTY session CWD (set via OSC 7 in the Rust
 * reader thread).
 *
 * Caching: directory listings are cached in a `Map<dir, entries>`
 * so re-expanding a directory we just looked at is instant. The
 * cache is *not* invalidated on FS writes — the directory explorer
 * shows the working tree and any FS changes (a `git checkout`,
 * a `wt switch --create`) will be picked up the next time the
 * user re-fetches via refresh. v1.1 wires the existing notify
 * watcher into a cache invalidation; v1 keeps things simple.
 */

import { create } from "zustand";
import { invoke } from "@/lib/tauri";
import type { DirEntry } from "@/lib/types";

interface DirectoryState {
  /** Currently browsing root — mirrors the focused terminal's CWD.
   * `null` when no terminal is focused. Set externally by the
   * DirectoryExplorer component whenever the focused CWD changes. */
  root: string | null;

  /** Cached directory listings: absolute dir path → entries. */
  cache: Map<string, DirEntry[]>;

  /** Currently expanded directories (absolute paths). */
  expanded: Set<string>;

  /** Loading state per directory: dir path → true while a fetch is
   * in flight. Used to render a subtle spinner. */
  loading: Set<string>;

  /** Current search query (substring match on filename). */
  searchQuery: string;

  /** Search results (absolute paths, sorted). `null` when no
   * search is active. */
  searchResults: string[] | null;

  /** True while a `search_files` request is in flight. */
  searching: boolean;

  /** Last error message from `list_directory` or `search_files`. */
  error: string | null;

  setRoot: (root: string | null) => void;

  /** Fetch and cache the listing for `dir`. No-op if already
   * cached and `force` is false. */
  loadDir: (dir: string, force?: boolean) => Promise<void>;

  /** Toggle whether `dir` is in the expanded set. When expanding
   * a directory we also kick off a fetch (and render its entries
   * once they arrive). */
  toggleExpanded: (dir: string) => Promise<void>;

  /** Replace the expanded set. Used when the root changes — we
   * don't want stale expanded dirs to leak across roots. */
  setExpanded: (dirs: Iterable<string>) => void;

  setSearchQuery: (q: string) => void;

  /** Run a file-name search. Debouncing lives in the component
   * (calling code), not the store. */
  runSearch: () => Promise<void>;

  clearSearch: () => void;

  /** Drop everything — called on repo close. */
  clear: () => void;
}

export const useDirectoryStore = create<DirectoryState>((set, get) => ({
  root: null,
  cache: new Map(),
  expanded: new Set(),
  loading: new Set(),
  searchQuery: "",
  searchResults: null,
  searching: false,
  error: null,

  setRoot: (root) => {
    // When the root changes, drop everything that referenced the
    // old root. We do this proactively so we don't render stale
    // expanded dirs / cached listings.
    if (get().root === root) return;
    set({
      root,
      cache: new Map(),
      expanded: new Set(),
      loading: new Set(),
      searchQuery: "",
      searchResults: null,
      searching: false,
      error: null,
    });
  },

  loadDir: async (dir, force = false) => {
    if (!force && get().cache.has(dir)) return;
    // Mark loading.
    set((s) => {
      const loading = new Set(s.loading);
      loading.add(dir);
      return { loading, error: null };
    });
    try {
      const entries = await invoke<DirEntry[]>("list_directory", { path: dir });
      set((s) => {
        const cache = new Map(s.cache);
        cache.set(dir, entries);
        const loading = new Set(s.loading);
        loading.delete(dir);
        return { cache, loading };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set((s) => {
        const loading = new Set(s.loading);
        loading.delete(dir);
        return { loading, error: msg };
      });
    }
  },

  toggleExpanded: async (dir) => {
    const wasExpanded = get().expanded.has(dir);
    set((s) => {
      const expanded = new Set(s.expanded);
      if (wasExpanded) expanded.delete(dir);
      else expanded.add(dir);
      return { expanded };
    });
    if (!wasExpanded) {
      // Pre-fetch so the entries are ready when the user opens it.
      // If the dir is already cached, loadDir is a no-op.
      void get().loadDir(dir);
    }
  },

  setExpanded: (dirs) => {
    set({ expanded: new Set(dirs) });
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
  },

  runSearch: async () => {
    const { root, searchQuery } = get();
    if (!root) {
      set({ searchResults: null, searching: false });
      return;
    }
    const q = searchQuery.trim();
    if (!q) {
      set({ searchResults: null, searching: false });
      return;
    }
    set({ searching: true, error: null });
    try {
      // The Rust command returns paths relative to root, using
      // forward slashes. We prefix with the root for display.
      const rels = await invoke<string[]>("search_files", {
        root,
        pattern: q,
      });
      const results = rels.map((r) => `${root}/${r}`);
      set({ searchResults: results, searching: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ searching: false, error: msg });
    }
  },

  clearSearch: () => {
    set({ searchQuery: "", searchResults: null, searching: false });
  },

  clear: () => {
    set({
      root: null,
      cache: new Map(),
      expanded: new Set(),
      loading: new Set(),
      searchQuery: "",
      searchResults: null,
      searching: false,
      error: null,
    });
  },
}));
