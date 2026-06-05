/**
 * Right-click context menu for a commit in the CommitGraph.
 *
 * M2 v1 actions:
 *   - Copy SHA / short SHA
 *   - Create worktree at this commit (calls `wt switch --create <branch> <commit>`)
 *
 * M2.5:
 *   - "View on GitHub" (needs remote URL)
 *   - "Reset current branch to here" (uses git reset)
 *   - "Cherry-pick into current worktree"
 */

import { useEffect, useRef } from "react";
import { Copy, GitBranch, Hash, X } from "lucide-react";
import { invoke } from "@/lib/tauri";
import { useRepoStore } from "@/stores/repo";
import { WtRpcError, type IpcError, type SwitchResult } from "@/lib/types";
import type { BranchRef } from "@/lib/types";

export interface CommitMenuTarget {
  sha: string;
  shortSha: string;
  summary: string;
  branches: BranchRef[];
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
      await invoke<SwitchResult>("wt_switch_create", {
        repo: repo.path,
        branch,
        base: target.sha,
      });
      await refresh();
    } catch (e) {
      alert(parseError(e));
    } finally {
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[220px] overflow-hidden rounded-lg border border-white/[0.08] bg-bg-panel py-1 shadow-2xl"
      style={{
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      }}
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
        {target.branches.length > 0 && (
          <>
            <li className="mt-1 border-t border-white/[0.06] px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-fg-muted">
              Pointed at by
            </li>
            {target.branches.slice(0, 5).map((b) => (
              <li key={b.name} className="px-3 py-1 font-mono text-[11px] text-fg-muted">
                {b.name} {b.is_local ? "" : "(remote)"}
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

function parseError(e: unknown): string {
  if (e instanceof WtRpcError) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    return (e as IpcError).message ?? String(e);
  }
  if (typeof e === "string") return e;
  return String(e);
}
