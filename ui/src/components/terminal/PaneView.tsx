/**
 * PaneView — single terminal pane chrome (header + split/close affordances)
 * wrapping either a live xterm.js session or a "spawning…" placeholder.
 */
import clsx from "clsx";
import { X, Rows2, Columns2 } from "lucide-react";
import { type SplitDir } from "@/lib/terminal-layout";
import { useTerminalStore } from "@/stores/terminal";
import { TerminalSessionView } from "./TerminalSessionView";

export function PaneView({
  worktree,
  paneId,
  sessionId,
  isFocused,
  onSplit,
  onClose,
  onFocus,
}: {
  worktree: string;
  paneId: string;
  sessionId: number | null;
  isFocused: boolean;
  onSplit: (worktree: string, paneId: string, dir: SplitDir) => Promise<number>;
  onClose: (worktree: string, paneId: string) => Promise<void>;
  onFocus: (worktree: string, paneId: string) => void;
}) {
  const status = useTerminalStore((s) => (sessionId != null ? s.sessions.get(sessionId)?.status : "spawning"));
  const dot = statusDot(status);

  return (
    <div
      onMouseDown={() => onFocus(worktree, paneId)}
      className={clsx(
        "group flex h-full w-full min-h-0 min-w-0 flex-col border bg-bg transition-colors duration-150",
        isFocused ? "border-accent/40" : "border-white/[0.04]",
      )}
    >
      <div
        className={clsx(
          "flex h-6 shrink-0 items-center gap-1.5 border-b px-1.5 transition-colors duration-150",
          isFocused ? "border-accent/30 bg-accent/[0.06]" : "border-white/[0.06] bg-bg-panel/60",
        )}
      >
        <span className={clsx("h-1.5 w-1.5 rounded-full", dot.color)} title={dot.title} />
        <span className="text-[10px] tabular-nums text-fg-muted">{shortSessionLabel(sessionId)}</span>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <IconButton title="Split horizontal" onClick={(e) => { e.stopPropagation(); void onSplit(worktree, paneId, "h"); }}>
            <Rows2 size={10} strokeWidth={1.5} />
          </IconButton>
          <IconButton title="Split vertical" onClick={(e) => { e.stopPropagation(); void onSplit(worktree, paneId, "v"); }}>
            <Columns2 size={10} strokeWidth={1.5} />
          </IconButton>
          <IconButton title="Close pane" onClick={(e) => { e.stopPropagation(); void onClose(worktree, paneId); }}>
            <X size={10} strokeWidth={1.5} />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        {sessionId != null ? (
          <TerminalSessionView sessionId={sessionId} />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-fg-muted">
            Spawning shell…
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      className="rounded p-1 text-fg-muted hover:bg-white/[0.06] hover:text-fg transition-colors duration-150"
    >
      {children}
    </button>
  );
}

function statusDot(status: "spawning" | "running" | "exited" | "error" | undefined): { color: string; title: string } {
  switch (status) {
    case "running":
      return { color: "bg-success", title: "running" };
    case "spawning":
      return { color: "bg-warning animate-pulse", title: "spawning" };
    case "exited":
      return { color: "bg-fg-subtle", title: "exited" };
    case "error":
      return { color: "bg-danger", title: "error" };
    default:
      return { color: "bg-fg-muted", title: "no session" };
  }
}

function shortSessionLabel(id: number | null): string {
  if (id == null) return "—";
  return `#${id}`;
}
