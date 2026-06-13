/**
 * Right-click context menu for files in the commit composer.
 *
 * Actions (applied to the selected file(s)):
 *   - Stage / Unstage
 *   - Stash
 *   - Ignore (add to .gitignore)
 *   - Discard changes
 *   - Edit file (open in default editor)
 */

import { useEffect, useRef } from "react";
import {
  ArrowUpToLine,
  ArrowDownToLine,
  Archive,
  EyeOff,
  Trash2,
  FilePen,
  X,
} from "lucide-react";
import { gitStage, gitUnstage, gitDiscardPaths, gitStashPushPaths, gitIgnore } from "@/lib/tauri";
import { useStagingStore } from "@/stores/staging";
import { useRepoStore } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { parseError } from "@/lib/errors";

export interface FileMenuTarget {
  paths: string[];
  /** Which side the files are on: "staged" or "unstaged" */
  side: "staged" | "unstaged";
  x: number;
  y: number;
}

export function FileContextMenu({
  target,
  onClose,
}: {
  target: FileMenuTarget;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const worktree = useStagingStore((s) => s.worktree);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const act = async (fn: () => Promise<void>, refresh?: boolean) => {
    try {
      await fn();
      if (refresh && worktree) {
        await Promise.all([
          useStagingStore.getState().fetch(worktree),
          useRepoStore.getState().refresh(),
          useGraphStore.getState().fetch(worktree),
        ]);
      }
    } catch (e) {
      alert(parseError(e));
    } finally {
      onClose();
    }
  };

  /** Refresh staging only (stage/unstage don't change repo state). */
  const stage = () => act(async () => {
    if (!worktree) return;
    for (const p of target.paths) await gitStage(worktree, p);
    await useStagingStore.getState().fetch(worktree);
  });

  const unstage = () => act(async () => {
    if (!worktree) return;
    for (const p of target.paths) await gitUnstage(worktree, p);
    await useStagingStore.getState().fetch(worktree);
  });

  /** Stash, ignore, discard all change repo + graph state — refresh everything. */
  const stash = () => act(async () => {
    if (!worktree) return;
    await gitStashPushPaths(worktree, target.paths, null);
  }, true);

  const ignore = () => act(async () => {
    if (!worktree) return;
    for (const p of target.paths) await gitIgnore(worktree, p);
  }, true);

  const discard = () => act(async () => {
    if (!worktree) return;
    if (!confirm(`Discard changes to ${target.paths.length} file${target.paths.length > 1 ? "s" : ""}?`)) return;
    await gitDiscardPaths(worktree, target.paths);
  }, true);

  const edit = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      for (const p of target.paths) {
        // Resolve full path relative to worktree
        const fullPath = worktree ? `${worktree.replace(/\/$/, "")}/${p}` : p;
        await open(fullPath);
      }
    } catch (e) {
      alert(parseError(e));
    }
    onClose();
  };

  const single = target.paths.length === 1;
  const label = single ? target.paths[0] : `${target.paths.length} files`;

  // Anchor the menu next to the mouse click, flipping if it overflows.
  const offset = 6;
  const menuStyle: React.CSSProperties = (() => {
    const style: React.CSSProperties = {
      position: "fixed",
      zIndex: 50,
      minWidth: 200,
    };
    if (typeof window === "undefined") {
      style.top = target.y;
      style.left = target.x;
      return style;
    }
    const w = 220;
    const h = 280;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = target.x + offset;
    let top = target.y + offset;
    if (left + w > vw) left = target.x - w - offset;
    if (top + h > vh) top = target.y - h - offset;
    if (left < 0) left = offset;
    if (top < 0) top = offset;
    style.top = top;
    style.left = left;
    return style;
  })();

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-lg border border-white/[0.08] bg-bg-panel py-1 shadow-2xl"
      style={menuStyle}
    >
      <header className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <span className="truncate font-mono text-[11px] text-fg-muted" title={label}>
          {label}
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150"
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      </header>

      <ul>
        {target.side === "unstaged" ? (
          <MenuItem icon={<ArrowUpToLine size={13} strokeWidth={1.5} />} onClick={stage}>
            Stage {single ? "" : `(${target.paths.length})`}
          </MenuItem>
        ) : (
          <MenuItem icon={<ArrowDownToLine size={13} strokeWidth={1.5} />} onClick={unstage}>
            Unstage {single ? "" : `(${target.paths.length})`}
          </MenuItem>
        )}

        <li className="mt-1 border-t border-white/[0.06]" />

        <MenuItem icon={<Archive size={13} strokeWidth={1.5} />} onClick={stash}>
          Stash {single ? "" : `(${target.paths.length})`}
        </MenuItem>

        <MenuItem icon={<EyeOff size={13} strokeWidth={1.5} />} onClick={ignore}>
          Ignore {single ? "" : `(${target.paths.length})`}
        </MenuItem>

        <MenuItem
          icon={<Trash2 size={13} strokeWidth={1.5} className="text-danger" />}
          onClick={discard}
        >
          <span className="text-danger">Discard {single ? "" : `(${target.paths.length})`}</span>
        </MenuItem>

        <li className="mt-1 border-t border-white/[0.06]" />

        <MenuItem icon={<FilePen size={13} strokeWidth={1.5} />} onClick={edit}>
          Edit {single ? "file" : `(${target.paths.length})`}
        </MenuItem>
      </ul>
    </div>
  );
}

function MenuItem({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-fg hover:bg-white/[0.04] transition-colors duration-150"
      >
        <span className="shrink-0 text-fg-muted">{icon}</span>
        {children}
      </button>
    </li>
  );
}