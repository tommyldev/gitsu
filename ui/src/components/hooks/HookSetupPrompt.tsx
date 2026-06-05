/**
 * HookSetupPrompt — a banner that appears at the top of the dashboard
 * when a repo has no `.config/wt.toml` (i.e. worktrunk's `post-start`
 * hook isn't installed). One click installs the recommended config
 * that brings `.env`, `node_modules/`, `target/`, etc. into new
 * worktrees via `wt step copy-ignored`.
 *
 * The user can dismiss the banner; we don't re-show it for the same
 * repo until the dismissal is reset (which happens on repo close).
 */

import { useRepoStore } from "@/stores/repo";
import { useHooksStore } from "@/stores/hooks";
import { Package, X } from "lucide-react";

export function HookSetupPrompt() {
  const repo = useRepoStore((s) => s.repo);
  const snapshot = useHooksStore((s) => s.snapshot);
  const dismissed = useHooksStore((s) => s.dismissed);
  const install = useHooksStore((s) => s.install);
  const dismiss = useHooksStore((s) => s.dismissBanner);
  const loading = useHooksStore((s) => s.loading);

  if (!repo) return null;
  if (dismissed) return null;
  if (snapshot === null) return null;
  if (snapshot.has_post_start_copy_ignored) return null;

  return (
    <div className="flex items-start gap-3 border-b border-white/[0.06] bg-bg-panel px-4 py-3 text-[13px] shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
      <Package size={18} className="mt-0.5 shrink-0 text-accent" strokeWidth={1.5} />
      <div className="flex-1">
        <p className="font-medium text-fg">
          Bring over <code className="font-mono">.env</code> &amp; build caches into new worktrees?
        </p>
        <p className="mt-0.5 text-[11px] text-fg-muted">
          Install gitsu's recommended <code className="font-mono">post-start</code> hook so
          <code className="font-mono">wt step copy-ignored</code> runs on every new worktree.
          Without it, <code className="font-mono">.env</code> and dependency caches live
          only in the main worktree.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => install(repo.path, true)}
            disabled={loading}
            className="rounded-md bg-accent px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors duration-150"
          >
            {loading ? "Installing…" : "Install recommended setup"}
          </button>
          <button
            onClick={dismiss}
            className="rounded-md px-2 py-1 text-[11px] text-fg-muted hover:bg-white/[0.04] transition-colors duration-150"
          >
            Not now
          </button>
        </div>
      </div>
      <button
        onClick={dismiss}
        className="rounded p-1 text-fg-muted hover:bg-white/[0.04] hover:text-fg transition-colors duration-150"
        title="Dismiss"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
