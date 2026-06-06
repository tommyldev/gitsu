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
import { Command } from "lucide-react";
import { useCommands, Action } from "./actions";
import type { CommandsDeps } from "./actions";

interface Props extends CommandsDeps {
  /** What to do after an action runs. Default: close the palette. */
  onClose: () => void;
}

export function CommandPalette(props: Props) {
  const actions = useCommands(props);

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
