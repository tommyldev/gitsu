/**
 * ConflictFileList — sidebar listing unresolved files, extracted from ConflictEditor.
 */

import { Check, ChevronRight } from "lucide-react";
import clsx from "clsx";

interface ConflictFileListProps {
  paths: string[];
  selected: string | null;
  resolved: Set<string>;
  onSelect: (path: string) => void;
}

export function ConflictFileList({
  paths,
  selected,
  resolved,
  onSelect,
}: ConflictFileListProps) {
  return (
    <aside className="w-64 shrink-0 overflow-auto border-r border-white/[0.06] bg-bg">
      <h3 className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
        Conflicted files
      </h3>
      {paths.length === 0 ? (
        <p className="px-3 text-[11px] text-fg-muted">
          No more conflicts. Click <strong>Complete merge</strong> to continue.
        </p>
      ) : (
        <ul>
          {paths.map((p) => {
            const isSelected = p === selected;
            const isResolved = resolved.has(p);
            return (
              <li key={p}>
                <button
                  onClick={() => onSelect(p)}
                  className={clsx(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] transition-colors duration-150",
                    isSelected
                      ? "bg-white/[0.04] text-fg"
                      : "text-fg-muted hover:bg-white/[0.02]",
                    isResolved && "opacity-50 line-through",
                  )}
                >
                  {isResolved ? (
                    <Check size={12} className="text-success" strokeWidth={1.5} />
                  ) : isSelected ? (
                    <ChevronRight size={12} className="text-accent" strokeWidth={1.5} />
                  ) : (
                    <span className="w-3" />
                  )}
                  <span className="truncate">{p}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
