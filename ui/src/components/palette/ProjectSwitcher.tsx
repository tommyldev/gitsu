/**
 * Project switcher (palette-style quick switcher).
 *
 * Opens via ⌘K / Ctrl+K (and a header "Projects" button when a repo is
 * open). Two affordances in one surface:
 *
 *   1. **Back to projects view** — the "← All projects" entry at the
 *      top closes the active repo so the user lands on the recents
 *      screen. Always present when a repo is open.
 *
 *   2. **Rapid project switching** — a substring-filtered list of
 *      recents. Substring (not fuzzy) keeps it predictable for a list
 *      capped at 50; matches on `name` and `path`.
 *
 * Keyboard:
 *   - ↑/↓        move highlight (wraps)
 *   - ↵          trigger the highlighted entry
 *   - Esc        close (handled by App's global Esc handler)
 *   - click row  trigger; click backdrop closes
 *
 * The component is intentionally presentational except for its own
 * query/highlight state. All navigation logic lives here; persistence
 * is the repo store's job (`openByPath`, `closeRepo`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, GitBranch, Search } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import type { RecentRepo } from "@/lib/types";

interface Props {
  onClose: () => void;
}

// One discriminated row type. Keeping the synthetic "back" row in the
// same array as the repo rows means the highlight/Enter logic only
// has to walk one list — simpler than two parallel indices.
type Row =
  | { kind: "all"; key: "all" }
  | { kind: "repo"; key: string; repo: RecentRepo; isCurrent: boolean };

export function ProjectSwitcher({ onClose }: Props) {
  const repo = useRepoStore((s) => s.repo);
  const recents = useRepoStore((s) => s.recents);
  const openByPath = useRepoStore((s) => s.openByPath);
  const closeRepo = useRepoStore((s) => s.closeRepo);

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Keep a ref to the scroll container so we can auto-scroll the
  // highlighted row into view when the user holds ↓/↑.
  const listRef = useRef<HTMLDivElement>(null);

  // Build the row list. The "← All projects" entry is always present
  // when a repo is open — that's how the user gets back to the
  // projects view from the dashboard.
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered: RecentRepo[] = q
      ? recents.filter(
          (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
        )
      : recents;
    const repoRows: Row[] = filtered.map((r) => ({
      kind: "repo" as const,
      key: r.path,
      repo: r,
      // We still render the current repo but mark it disabled so the
      // user can see "this is the one I have open" without being able
      // to re-select it (which would be a no-op).
      isCurrent: repo?.path === r.path,
    }));
    return repo ? [{ kind: "all", key: "all" }, ...repoRows] : repoRows;
  }, [recents, query, repo]);

  // Clamp highlight when the list shrinks (filter narrows, repo closes).
  useEffect(() => {
    if (highlight >= rows.length) setHighlight(Math.max(0, rows.length - 1));
  }, [rows.length, highlight]);

  // Reset highlight to the first row whenever the query changes — the
  // user's intent is "show me what matches", not "preserve my cursor
  // position across an unrelated filter".
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Autofocus the input on mount so typing "git" → Enter goes straight
  // to a project. The parent (App) prevents this effect from firing on
  // subsequent renders.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // When the highlight moves, keep the row in view. Cheap and avoids
  // the user "losing" the cursor when they hold ↓ past the viewport.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const trigger = (row: Row) => {
    if (row.kind === "all") {
      closeRepo();
    } else if (!row.isCurrent) {
      void openByPath(row.repo.path);
    }
    onClose();
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length === 0) return;
      setHighlight((h) => (h + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      setHighlight((h) => (h - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[highlight];
      if (row) trigger(row);
    } else if (e.key === "Escape") {
      // The global Esc handler in App.tsx bails when an <input> is
      // focused (to avoid stealing typing), so we close locally.
      e.preventDefault();
      onClose();
    } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
      // ⌘K / Ctrl+K toggles the palette. The global handler also
      // bails on inputs, so we re-implement the toggle here for
      // symmetry (user can dismiss with the same gesture they used
      // to open it, even while typing).
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] modal-backdrop"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        // Stop propagation but also reclaim focus on any click in the
        // panel so the user doesn't "lose" the input mid-typing.
        onMouseDown={() => inputRef.current?.focus()}
        className="modal-panel flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-bg-panel shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        style={{ animation: "modal-scale 160ms cubic-bezier(0.25, 0.1, 0.25, 1.0) forwards" }}
      >
        {/* Search header. The icon sits absolutely in the gutter so it
            doesn't take layout space; the input fills the rest. */}
        <div className="relative border-b border-white/[0.06]">
          <Search
            size={14}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={repo ? "Switch project… (↑↓ to navigate, ↵ to open)" : "Switch project…"}
            className="w-full bg-transparent py-3.5 pl-10 pr-4 text-[14px] text-fg placeholder:text-fg-subtle focus:outline-none"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1.5">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-fg-muted">
              {query.trim()
                ? `No projects match "${query.trim()}"`
                : "No recent projects — open one with ⌘O"}
            </div>
          ) : (
            rows.map((row, idx) => (
              <RowView
                key={row.key}
                row={row}
                active={idx === highlight}
                // mousedown fires before blur, so we can trigger
                // without losing focus first.
                onMouseDown={() => {
                  setHighlight(idx);
                  trigger(row);
                }}
                onHover={() => setHighlight(idx)}
                rowIndex={idx}
              />
            ))
          )}
        </div>

        {/* Footer hints. Stays visible even when the list is empty
            so the user always knows the keyboard model. */}
        <footer className="flex items-center justify-between border-t border-white/[0.06] bg-bg/40 px-3 py-1.5 text-[10.5px] text-fg-muted">
          <span className="flex items-center gap-3">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>navigate</span>
            <Kbd>↵</Kbd>
            <span>open</span>
          </span>
          <span className="flex items-center gap-2">
            <Kbd>esc</Kbd>
            <span>close</span>
          </span>
        </footer>
      </div>
    </div>
  );
}

function RowView({
  row,
  active,
  onMouseDown,
  onHover,
  rowIndex,
}: {
  row: Row;
  active: boolean;
  onMouseDown: () => void;
  onHover: () => void;
  rowIndex: number;
}) {
  const isAll = row.kind === "all";
  const isCurrent = row.kind === "repo" && row.isCurrent;
  // Disabled = the current repo (re-selecting it would be a no-op and
  // the action would just close the palette for no reason).
  const disabled = isCurrent;

  return (
    <div
      data-row-index={rowIndex}
      onMouseDown={disabled ? undefined : onMouseDown}
      onMouseMove={onHover}
      // The row tracks "active" purely visually; the underlying
      // clickability is on mousedown to avoid a focus→blur round-trip
      // when the user clicks a row.
      className={
        "flex cursor-pointer items-center gap-3 px-4 py-2 text-[13px] transition-colors duration-100 " +
        (active
          ? "bg-accent/12 text-fg"
          : "text-fg hover:bg-white/[0.03] ") +
        (disabled ? " cursor-default opacity-50 " : "")
      }
    >
      {isAll ? (
        <ArrowLeft
          size={14}
          strokeWidth={1.5}
          className={active ? "text-accent" : "text-fg-muted"}
        />
      ) : (
        <GitBranch
          size={14}
          strokeWidth={1.5}
          className={active ? "text-accent" : "text-fg-muted"}
        />
      )}
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate font-medium">
          {isAll ? "All projects" : row.repo.name}
        </span>
        {!isAll && (
          <span className="truncate font-mono text-[11.5px] text-fg-muted">
            {row.repo.path}
          </span>
        )}
      </div>
      {isAll && (
        <span className="text-[10.5px] uppercase tracking-wider text-fg-muted">
          back
        </span>
      )}
      {isCurrent && (
        <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
          current
        </span>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-white/[0.1] bg-white/[0.04] px-1 font-mono text-[10px] text-fg-muted">
      {children}
    </kbd>
  );
}
