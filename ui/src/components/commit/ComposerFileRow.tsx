/**
 * One file row in the commit composer: change-kind letter, path,
 * and a hover action that moves the path in/out of the index.
 *
 * Supports multi-select via shift-click and right-click context menu.
 */

import { Plus, Minus } from "lucide-react";
import clsx from "clsx";
import type { ChangeKind, StatusEntry } from "@/lib/types";

const KIND_LETTER: Record<ChangeKind, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  typechange: "T",
  untracked: "U",
  conflicted: "C",
};

const KIND_COLOR: Record<ChangeKind, string> = {
  added: "text-success",
  untracked: "text-success/80",
  modified: "text-warning",
  renamed: "text-accent",
  typechange: "text-accent",
  deleted: "text-danger",
  conflicted: "text-danger",
};

export function ComposerFileRow({
  entry,
  side,
  onToggle,
  disabled,
  selected,
  onRightClick,
  onShiftClick,
}: {
  entry: StatusEntry;
  /** Which half of the panel the row lives in — decides which kind
   *  to display and whether the action stages or unstages. */
  side: "staged" | "unstaged";
  onToggle: () => void;
  disabled: boolean;
  selected?: boolean;
  onRightClick?: (e: React.MouseEvent) => void;
  onShiftClick?: () => void;
}) {
  const kind = (side === "staged" ? entry.staged : entry.unstaged) as ChangeKind;
  const slash = entry.path.lastIndexOf("/");
  const dir = slash >= 0 ? entry.path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? entry.path.slice(slash + 1) : entry.path;
  const stageAction = side === "unstaged";

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      onShiftClick?.();
    } else {
      onToggle();
    }
  };

  return (
    <li
      className={clsx(
        "group flex min-w-0 items-center gap-2 rounded-md px-2 py-1 transition-colors duration-150",
        selected
          ? "bg-accent/15 hover:bg-accent/20"
          : "hover:bg-white/[0.04]",
      )}
      title={entry.path}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick?.(e);
      }}
    >
      <span
        className={clsx(
          "w-3 shrink-0 text-center font-mono text-[11px] font-semibold",
          KIND_COLOR[kind],
        )}
      >
        {KIND_LETTER[kind]}
      </span>
      <button
        className="flex min-w-0 flex-1 items-baseline text-left text-[12px]"
        onClick={handleClick}
        disabled={disabled}
        title={stageAction ? `Stage ${entry.path}` : `Unstage ${entry.path}`}
      >
        {dir && <span className="truncate font-mono text-[11px] text-fg-subtle">{dir}</span>}
        <span className="shrink-0 font-mono text-[12px] text-fg">{name}</span>
      </button>
      <button
        className={clsx(
          "shrink-0 rounded p-0.5 text-fg-muted opacity-0 transition-all duration-150",
          "group-hover:opacity-100 hover:bg-white/[0.08] hover:text-fg",
          disabled && "pointer-events-none",
        )}
        onClick={onToggle}
        disabled={disabled}
        aria-label={stageAction ? `Stage ${entry.path}` : `Unstage ${entry.path}`}
      >
        {stageAction ? <Plus size={13} strokeWidth={1.5} /> : <Minus size={13} strokeWidth={1.5} />}
      </button>
    </li>
  );
}
