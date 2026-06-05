/**
 * TerminalStrip — a collapsible bottom panel with one xterm.js tab
 * per worktree. The PTY for each worktree is spawned the first time
 * its tab is opened; output streams via `pty:data:<id>` Tauri events.
 *
 * The store is in `stores/terminal.ts`. The components here just
 * render xterm.js and bridge it to the store.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { ChevronDown, ChevronUp, X, RefreshCw, Terminal as TerminalIcon } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useTerminalStore } from "@/stores/terminal";
import { useSelectedWorktree } from "./selectors";

export function TerminalStrip({ fillsAvailable = false }: { fillsAvailable?: boolean }) {
  const repo = useRepoStore((s) => s.repo);
  const sessions = useTerminalStore((s) => s.sessions);
  const open = useTerminalStore((s) => s.open);
  const close = useTerminalStore((s) => s.close);
  const [selectedWorktree, setSelectedWorktree] = useSelectedWorktree();
  const [open_, setOpen] = useState(true);

  if (!repo) return null;
  const worktreeList = Array.from(sessions.values());

  // `fillsAvailable` is true when the graph/commit panel is hidden,
  // so the terminal takes its place in the same flex row (and most
  // of the view). Otherwise the terminal is a fixed-height bottom
  // strip.
  return (
    <div
      className={clsx(
        "relative flex flex-col bg-bg-panel shadow-[0_-2px_12px_rgba(0,0,0,0.15)]",
        fillsAvailable
          ? "min-w-0 flex-1 border-l border-white/[0.06]"
          : "shrink-0 border-t border-white/[0.06]",
      )}
    >
      {/* Subtle top edge light */}
      {!fillsAvailable && <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />}
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2">
        <TerminalIcon size={12} className="text-fg-muted" strokeWidth={1.5} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Terminal
        </span>
        <span className="ml-1 text-[10px] text-fg-muted">
          ({worktreeList.length})
        </span>
        <div className="ml-2 flex flex-1 items-center gap-1 overflow-x-auto">
          {worktreeList.map((s) => (
            <Tab
              key={s.worktree}
              worktree={s.worktree}
              status={s.status}
              active={selectedWorktree === s.worktree}
              onSelect={() => setSelectedWorktree(s.worktree)}
              onClose={() => close(s.worktree)}
            />
          ))}
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded p-1 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150"
          title={open_ ? "Hide terminal" : "Show terminal"}
        >
          {open_ ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronUp size={12} strokeWidth={1.5} />}
        </button>
      </header>
      {open_ && (
        <div className={fillsAvailable ? "min-h-0 flex-1 bg-bg" : "h-72 bg-bg"}>
          {worktreeList.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[13px] text-fg-muted">
              No terminals open.
            </div>
          ) : (
            worktreeList.map((s) => (
              <div
                key={s.worktree}
                className={clsx("h-full w-full", selectedWorktree !== s.worktree && "hidden")}
              >
                <TerminalTab id={s.id} status={s.status} />
              </div>
            ))
          )}
          {worktreeList.length > 0 && (
            <NewTerminalButton
              selectedWorktree={selectedWorktree ?? repo.path}
              onSpawn={async (path) => {
                await open(path, 80, 24);
                setSelectedWorktree(path);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Tab({
  worktree,
  status,
  active,
  onSelect,
  onClose,
}: {
  worktree: string;
  status: "spawning" | "running" | "exited" | "error";
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const label = useMemo(() => worktree.split("/").pop() ?? worktree, [worktree]);
  const dot =
    status === "running"
      ? "bg-success"
      : status === "spawning"
        ? "bg-warning animate-pulse"
        : status === "exited"
          ? "bg-fg-subtle"
          : "bg-danger";
  return (
    <div
      onClick={onSelect}
      className={clsx(
        "group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-colors duration-150",
        active ? "bg-white/[0.05] text-fg" : "text-fg-muted hover:bg-white/[0.03]",
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} />
      <span className="max-w-[180px] truncate font-mono">{label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-white/[0.04] group-hover:opacity-100 transition-opacity duration-150"
      >
        <X size={10} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function NewTerminalButton({
  selectedWorktree,
  onSpawn,
}: {
  selectedWorktree: string;
  onSpawn: (worktree: string) => Promise<void>;
}) {
  return (
    <button
      onClick={() => onSpawn(selectedWorktree)}
      className="absolute bottom-12 right-4 flex items-center gap-1 rounded-md border border-white/[0.08] bg-bg-panel px-2 py-1 text-[11px] text-fg-muted opacity-0 transition-opacity duration-150 hover:text-fg group-hover:opacity-100"
      title={`Spawn shell in ${selectedWorktree}`}
    >
      <RefreshCw size={11} strokeWidth={1.5} /> New terminal
    </button>
  );
}

function TerminalTab({
  id,
  status,
}: {
  id: number;
  status: "spawning" | "running" | "exited" | "error";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const send = useTerminalStore((s) => s.send);
  const resize = useTerminalStore((s) => s.resize);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: {
        background: "#1A1B1D",
        foreground: "#8A8F98",
        cursor: "#8A8F98",
        selectionBackground: "#3A3D44",
      },
      cols: 80,
      rows: 24,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Forward keystrokes to the PTY
    const dataDisp = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      void send(id, bytes);
    });

    // Listen for pty:data events for this session id
    let unlisten: (() => void) | undefined;
    void listen<{ id: number; data: number[] }>(`pty:data:${id}`, (event) => {
      const bytes = new Uint8Array(event.payload.data);
      try {
        term.write(bytes as unknown as string);
      } catch {
        term.write(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
      }
    }).then((fn) => {
      unlisten = fn;
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        resize(id, term.cols, term.rows);
      } catch {
        // ignore
      }
    });
    ro.observe(containerRef.current);
    setTimeout(() => {
      try {
        fit.fit();
        resize(id, term.cols, term.rows);
      } catch {
        // ignore
      }
    }, 50);

    return () => {
      ro.disconnect();
      dataDisp.dispose();
      unlisten?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [id, send, resize]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {status === "spawning" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-fg-muted">
          Spawning shell…
        </div>
      )}
      {status === "exited" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-fg-subtle">
          Shell exited. Close this tab to clean up.
        </div>
      )}
      {status === "error" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-danger">
          Failed to spawn shell.
        </div>
      )}
    </div>
  );
}

// (selectedWorktree state is local; the selector hook is enough.)
// Keep this placeholder import-path reference so the LSP doesn't
// complain about an unused import of the selector.
void useSelectedWorktree;
