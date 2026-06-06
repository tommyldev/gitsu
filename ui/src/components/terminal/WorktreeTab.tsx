/**
 * WorktreeTab — single tab button in the terminal strip header's
 * worktree switcher row.
 */
import clsx from "clsx";

export function WorktreeTab({
  label,
  detached,
  active,
  onSelect,
}: {
  label: string;
  detached: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-colors duration-150",
        active ? "bg-white/[0.05] text-fg" : "text-fg-muted hover:bg-white/[0.03]",
      )}
      title={label}
    >
      <span
        className={clsx(
          "h-1.5 w-1.5 rounded-full",
          detached ? "bg-fg-muted" : "bg-accent",
        )}
      />
      <span className="max-w-[180px] truncate font-mono">{label}</span>
    </button>
  );
}
