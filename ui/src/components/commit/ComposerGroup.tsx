/**
 * Group — a labeled list with an optional "all" action, used by
 * `CommitComposer` to render the Unstaged / Staged sections.
 *
 * Returns `null` when `count === 0` so empty groups don't reserve
 * vertical space in the composer's scrollable list.
 */

import type { ReactNode } from "react";

export function Group({
  label,
  count,
  action,
  children,
}: {
  label: string;
  count: number;
  action: { label: string; run: () => Promise<void> } | null;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-2 pb-1 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          {label} · {count}
        </span>
        {action && (
          <button
            className="text-[10px] text-fg-muted hover:text-fg transition-colors duration-150"
            onClick={() => void action.run()}
          >
            {action.label}
          </button>
        )}
      </div>
      <ul className="flex h-48 flex-col overflow-y-auto">{children}</ul>
    </div>
  );
}
