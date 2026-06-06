/**
 * Right-click context menu for a commit in the CommitGraph.
 *
 * Actions:
 *   - Copy SHA / short SHA
 *   - Create worktree at this commit (calls `wt switch --create <branch> <commit>`)
 *   - Checkout (switch to) any local branch that points to this commit
 *     (calls `wt switch <branch>`)
 *   - List remote-tracking branches that also point to this commit
 */

import { useEffect, useRef } from "react";
import { Copy, GitBranch, Hash, X, ArrowRightToLine } from "lucide-react";
import { wtSwitchCreate, wtSwitch } from "@/lib/tauri";
import { useRepoStore } from "@/stores/repo";
import { type BranchRef } from "@/lib/types";
import { parseError } from "@/lib/errors";

export interface CommitMenuTarget {
  sha: string;
  shortSha: string;
  summary: string;
  branches: BranchRef[];
  /** Mouse coordinates at the time of the right-click, so the menu
   *  can anchor next to the node. */
  x: number;
  y: number;
}

export function CommitContextMenu({ target, onClose }: { target: CommitMenuTarget; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { repo, refresh } = useRepoStore();

  // Close on outside click or Escape
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

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.warn("clipboard write failed", e);
    }
    onClose();
  };

  const createWorktree = async () => {
    if (!repo) return;
    // Use a friendly default branch name from the target's summary.
    const slug = (target.summary || "commit")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "branch";
    const branch = `${slug}-${target.shortSha}`;
    try {
      await wtSwitchCreate(repo.path, branch, target.sha);
      await refresh();
    } catch (e) {
      alert(parseError(e));
    } finally {
      onClose();
    }
  };

  // Checkout (switch to) an existing local branch. We only show this
  // for LOCAL branches — switching to a remote-tracking ref would
  // require a separate worktree, which is the "Create worktree" action.
  const checkoutBranch = async (branchName: string) => {
    if (!repo) return;
    try {
      await wtSwitch(repo.path, branchName);
      await refresh();
    } catch (e) {
      alert(parseError(e));
    } finally {
      onClose();
    }
  };

  const localBranches = target.branches.filter((b) => b.is_local);
  const remoteBranches = target.branches.filter((b) => !b.is_local);

  // Anchor the menu next to the mouse click, but flip it if it would
  // overflow the viewport (so it never gets clipped at the edges).
  const offset = 6;
  const menuStyle: React.CSSProperties = (() => {
    const style: React.CSSProperties = {
      position: "fixed",
      zIndex: 50,
      minWidth: 220,
    };
    if (typeof window === "undefined") {
      style.top = target.y;
      style.left = target.x;
      return style;
    }
    const w = 240; // approximate menu width; updated on mount
    const h = 320; // approximate menu height
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
        <span className="font-mono text-[11px] text-fg-muted">{target.shortSha}</span>
        <button onClick={onClose} className="rounded p-0.5 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150">
          <X size={12} strokeWidth={1.5} />
        </button>
      </header>
      <p className="line-clamp-2 px-3 py-1.5 text-[11px] text-fg-muted" title={target.summary}>
        {target.summary}
      </p>
      <ul className="border-t border-white/[0.06]">
        <MenuItem icon={<Copy size={13} strokeWidth={1.5} />} onClick={() => copy(target.sha)}>
          Copy full SHA
        </MenuItem>
        <MenuItem icon={<Hash size={13} strokeWidth={1.5} />} onClick={() => copy(target.shortSha)}>
          Copy short SHA
        </MenuItem>
        <MenuItem icon={<GitBranch size={13} strokeWidth={1.5} />} onClick={createWorktree}>
          Create worktree at this commit…
        </MenuItem>

        {/* Checkout section. Always rendered (even when empty) so the
            affordance is discoverable. When local branches point to
            this commit, they appear as quick actions; otherwise a
            placeholder message tells the user nothing's available
            at this commit. */}
        <li className="mt-1 border-t border-white/[0.06] px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-fg-muted">
          Checkout
        </li>
        {localBranches.length > 0 ? (
          localBranches.slice(0, 8).map((b) => (
            <li key={b.name}>
              <button
                onClick={() => checkoutBranch(b.name)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-fg hover:bg-white/[0.04] transition-colors duration-150"
                title={`Switch worktree to ${b.name}`}
              >
                <ArrowRightToLine size={13} strokeWidth={1.5} className="shrink-0 text-accent" />
                <span className="truncate font-mono text-[12px]">{b.name}</span>
              </button>
            </li>
          ))
        ) : (
          <li className="px-3 py-1.5 text-[12px] italic text-fg-muted">
            No local branches point to this commit
          </li>
        )}

        {remoteBranches.length > 0 && (
          <>
            <li className="mt-1 border-t border-white/[0.06] px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-fg-muted">
              Also at this commit
            </li>
            {remoteBranches.slice(0, 5).map((b) => (
              <li key={b.name} className="flex items-center gap-2 px-3 py-1 font-mono text-[11px] text-fg-muted">
                <GitBranch size={11} strokeWidth={1.5} className="shrink-0 opacity-60" />
                <span className="truncate">{b.name}</span>
              </li>
            ))}
          </>
        )}
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
        <span className="text-fg-muted">{icon}</span>
        {children}
      </button>
    </li>
  );
}
