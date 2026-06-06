/**
 * GitActionsBar — toolbar at the top of the commit graph view.
 *
 * Five buttons (left to right, matching the user's request):
 *   - Pull     — `git pull` (uses system git for credentials)
 *   - Push     — `git push`
 *   - Branch   — opens a small "new branch" dialog (libgit2, no
 *                checkout — distinct from "New worktree" which
 *                makes a new directory)
 *   - Stash    — `git stash push -u` (libgit2)
 *   - Pop      — `git stash pop` (libgit2)
 *
 * Each call surfaces its result in a transient banner that
 * auto-dismisses on success and persists on error.
 *
 * Disabled when no active worktree is selected (the bar is part of
 * the graph view, so it inherits the graph's "need a worktree"
 * guard).
 */

import { useState } from "react";
import clsx from "clsx";
import { ArrowDownToLine, ArrowUpToLine, GitBranch, ArchiveRestore, Archive, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useGraphStore } from "@/stores/graph";
import { shortenPath } from "@/lib/format";
import { gitPull, gitPush } from "@/lib/tauri";
import { useGitActions } from "./useGitActions";
import { CreateBranchDialog } from "@/components/graph/CreateBranchDialog";

function BarButton({
  icon,
  label,
  title,
  loading,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={clsx(
        "group inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-all duration-150 ease-standard",
        // Always visible: solid bg + readable text + a real border.
        // The hover state nudges brightness/lift on top of that, so
        // the button is never invisible by default. Matches the
        // visible-at-rest standard set by the global `.btn-ghost`.
        "border-white/[0.24] bg-white/[0.12] text-fg hover:border-white/[0.36] hover:bg-white/[0.2] hover:text-fg hover:shadow-[0_2px_8px_rgba(0,0,0,0.25)]",
        "active:translate-y-px",
        "disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:border-white/[0.24] disabled:hover:bg-white/[0.12] disabled:hover:text-fg disabled:hover:shadow-none",
        loading && "border-accent/30 bg-accent/10 text-accent",
      )}
    >
      {loading ? (
        <Loader2 size={12} className="animate-spin" strokeWidth={1.5} />
      ) : (
        icon
      )}
      <span>{label}</span>
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-white/[0.06]" />;
}

export function GitActionsBar() {
  const activePath = useGraphStore((s) => s.activePath);
  const [branchOpen, setBranchOpen] = useState(false);
  const { handlers, busy, banner, dismissBanner } = useGitActions({
    onCloseBranch: () => setBranchOpen(false),
  });

  const disabled = !activePath;

  return (
    <>
      <div className="flex shrink-0 flex-col border-b border-white/[0.06] bg-bg-panel/40">
        <div className="flex items-center gap-1 px-2 py-1.5">
          <BarButton
            icon={<ArrowDownToLine size={13} strokeWidth={1.5} />}
            label="Pull"
            title="git pull — fetch + merge from upstream"
            loading={busy === "pull"}
            disabled={disabled}
            onClick={() => void handlers.runRemote("pull", gitPull)}
          />
          <BarButton
            icon={<ArrowUpToLine size={13} strokeWidth={1.5} />}
            label="Push"
            title="git push — publish to upstream"
            loading={busy === "push"}
            disabled={disabled}
            onClick={() => void handlers.runRemote("push", gitPush)}
          />
          <Divider />
          <BarButton
            icon={<GitBranch size={13} strokeWidth={1.5} />}
            label="Branch"
            title="Create a new branch at HEAD (no new worktree)"
            loading={busy === "branch"}
            disabled={disabled}
            onClick={() => setBranchOpen(true)}
          />
          <Divider />
          <BarButton
            icon={<Archive size={13} strokeWidth={1.5} />}
            label="Stash"
            title="git stash push -u — stash working tree changes"
            loading={busy === "stash"}
            disabled={disabled}
            onClick={() => void handlers.onStash()}
          />
          <BarButton
            icon={<ArchiveRestore size={13} strokeWidth={1.5} />}
            label="Pop"
            title="git stash pop — restore the top stash"
            loading={busy === "pop"}
            disabled={disabled}
            onClick={() => void handlers.onPop()}
          />

          {/* Right side: subtle hint about the active worktree. */}
          {activePath && (
            <span
              className="ml-auto truncate font-mono text-[10px] text-fg-muted/70"
              title={activePath}
            >
              {shortenPath(activePath)}
            </span>
          )}
        </div>

        {/* Transient result banner. Sits *inside* the bar's column
            so it doesn't take vertical space when idle. The collapse
            uses `max-h-0`/`max-h-12` to avoid layout shift between
            states. */}
        <div
          className={clsx(
            "overflow-hidden transition-[max-height] duration-200 ease-standard",
            banner ? "max-h-12" : "max-h-0",
          )}
        >
          {banner && (
            <div
              className={clsx(
                "flex items-start gap-2 border-t px-3 py-1.5 text-[11px]",
                banner.kind === "error" && "border-danger/15 bg-danger/8 text-danger",
                banner.kind === "success" && "border-success/15 bg-success/8 text-success",
                banner.kind === "info" && "border-white/10 bg-white/[0.03] text-fg-muted",
              )}
            >
              {banner.kind === "error" ? (
                <AlertCircle size={12} className="mt-px shrink-0" strokeWidth={1.5} />
              ) : banner.kind === "success" ? (
                <CheckCircle2 size={12} className="mt-px shrink-0" strokeWidth={1.5} />
              ) : (
                <span className="mt-px inline-block h-2 w-2 shrink-0 rounded-full bg-fg-muted" />
              )}
              <span className="flex-1 font-mono leading-snug">{banner.message}</span>
              <button
                onClick={dismissBanner}
                className="-my-1 -mr-1 rounded p-1 text-current opacity-60 hover:bg-white/[0.06] hover:opacity-100 transition-opacity duration-150"
                title="Dismiss"
              >
                ×
              </button>
            </div>
          )}
        </div>
      </div>

      {branchOpen && activePath && (
        <CreateBranchDialog
          worktree={activePath}
          onClose={() => setBranchOpen(false)}
          onCreated={handlers.onBranchCreated}
        />
      )}
    </>
  );
}
