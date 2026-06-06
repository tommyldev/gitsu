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

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowDownToLine, ArrowUpToLine, GitBranch, ArchiveRestore, Archive, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { invoke } from "@/lib/tauri";
import {
  WtRpcError,
  type BranchCreateResult,
  type IpcError,
  type RemoteOpResult,
  type StashPopResult,
  type StashPushResult,
} from "@/lib/types";
import { CreateBranchDialog } from "@/components/graph/CreateBranchDialog";

/** One of the five buttons. Used as a key for the per-op busy state. */
type Op = "pull" | "push" | "branch" | "stash" | "pop";

/** Severity of the last banner — drives colors + auto-dismiss timing. */
type BannerKind = "success" | "error" | "info";

interface Banner {
  kind: BannerKind;
  message: string;
}

const SUCCESS_MS = 4000;
const ERROR_MS = 8000;

export function GitActionsBar() {
  const repo = useRepoStore((s) => s.repo);
  const activePath = useGraphStore((s) => s.activePath);
  const graphFetch = useGraphStore((s) => s.fetch);
  const repoRefresh = useRepoStore((s) => s.refresh);
  const [busy, setBusy] = useState<Op | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const dismissTimer = useRef<number | null>(null);

  const disabled = !repo || !activePath;

  const flash = useCallback((kind: BannerKind, message: string) => {
    setBanner({ kind, message });
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
    }
    const ms = kind === "error" ? ERROR_MS : SUCCESS_MS;
    dismissTimer.current = window.setTimeout(() => setBanner(null), ms);
  }, []);

  // Clear any pending banner when the active worktree changes —
  // a stale "Pushed feature/foo" from a previous worktree is just
  // visual noise in the new one.
  useEffect(() => {
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    setBanner(null);
  }, [activePath]);

  useEffect(() => {
    return () => {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
      }
    };
  }, []);

  const refreshAll = useCallback(async () => {
    if (!repo) return;
    // Kick the worktree poll + graph fetch in parallel. The poll
    // updates ahead/behind counts and dirty flags; the graph fetch
    // updates the commit list and head SHA.
    await Promise.all([repoRefresh(), activePath ? graphFetch(activePath) : Promise.resolve()]);
  }, [activePath, graphFetch, repo, repoRefresh]);

  const runRemote = useCallback(
    async (op: Exclude<Op, "branch">, cmd: string, args: Record<string, unknown>) => {
      if (!activePath) return;
      setBusy(op);
      setBanner(null);
      try {
        const result = await invoke<RemoteOpResult>(cmd, { worktree: activePath, ...args });
        await refreshAll();
        if (result.exit_code === 0) {
          if (result.fetch_only) {
            // Backend fell back to fetch because the branch has no
            // upstream. Don't surface a scary git error — explain
            // the fallback and point the user to Push.
            flash(
              "info",
              "No upstream for this branch — fetched remotes only. Use Push to publish.",
            );
            return;
          }
          // The terse "Everything up-to-date" / "To origin" lines
          // are the most useful — the frontend shows them so the
          // user has a clear "this actually did something" signal.
          const detail = pickInterestingLine(result.stderr || result.stdout);
          flash("success", detail ?? `${labelFor(op)} ok`);
        } else {
          flash("error", result.stderr || `${labelFor(op)} failed (exit ${result.exit_code})`);
        }
      } catch (e) {
        flash("error", parseError(e));
      } finally {
        setBusy(null);
      }
    },
    [activePath, flash, refreshAll],
  );

  const onStash = useCallback(async () => {
    if (!activePath) return;
    setBusy("stash");
    setBanner(null);
    try {
      const result = await invoke<StashPushResult>("git_stash_push", {
        worktree: activePath,
        message: null,
      });
      await refreshAll();
      if (result.no_changes) {
        flash("info", "Nothing to stash — working tree is clean.");
      } else {
        flash("success", `Stashed changes (${result.oid.slice(0, 7)}).`);
      }
    } catch (e) {
      flash("error", parseError(e));
    } finally {
      setBusy(null);
    }
  }, [activePath, flash, refreshAll]);

  const onPop = useCallback(async () => {
    if (!activePath) return;
    setBusy("pop");
    setBanner(null);
    try {
      const result = await invoke<StashPopResult>("git_stash_pop", { worktree: activePath });
      await refreshAll();
      if (result.had_conflicts) {
        flash("error", "Stash pop produced conflicts — resolve them in the commit panel.");
      } else {
        flash("success", `Restored stash (${result.oid.slice(0, 7)}).`);
      }
    } catch (e) {
      flash("error", parseError(e));
    } finally {
      setBusy(null);
    }
  }, [activePath, flash, refreshAll]);

  const onBranchCreated = useCallback(
    async (result: BranchCreateResult) => {
      setBranchOpen(false);
      await refreshAll();
      const suffix = result.already_checked_out ? " (already checked out)" : "";
      flash("success", `Created branch ${result.name} at ${result.sha.slice(0, 7)}${suffix}`);
    },
    [flash, refreshAll],
  );

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
            onClick={() => void runRemote("pull", "git_pull", {})}
          />
          <BarButton
            icon={<ArrowUpToLine size={13} strokeWidth={1.5} />}
            label="Push"
            title="git push — publish to upstream"
            loading={busy === "push"}
            disabled={disabled}
            onClick={() => void runRemote("push", "git_push", {})}
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
            onClick={() => void onStash()}
          />
          <BarButton
            icon={<ArchiveRestore size={13} strokeWidth={1.5} />}
            label="Pop"
            title="git stash pop — restore the top stash"
            loading={busy === "pop"}
            disabled={disabled}
            onClick={() => void onPop()}
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
                onClick={() => setBanner(null)}
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
          onCreated={onBranchCreated}
        />
      )}
    </>
  );
}

// ── Small button primitive (toolbar-specific) ────────────────────

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
        "border-white/[0.08] bg-white/[0.02] text-fg-muted hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-fg",
        "active:translate-y-px",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-white/[0.08] disabled:hover:bg-white/[0.02] disabled:hover:text-fg-muted",
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

// ── Helpers ──────────────────────────────────────────────────────

function labelFor(op: Op): string {
  switch (op) {
    case "pull":
      return "Pull";
    case "push":
      return "Push";
    case "branch":
      return "Branch";
    case "stash":
      return "Stash";
    case "pop":
      return "Pop";
  }
}

/** Pick a single line of stderr to surface in the success toast. Pull
 *  and push emit their interesting line on stderr (e.g. "Fast-forward
 *  to abc1234", "Everything up-to-date", "To github.com:foo/bar.git").
 *  We grab the first non-empty line so the user gets a useful
 *  signal. */
function pickInterestingLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? null;
}

function shortenPath(p: string): string {
  if (p.length <= 48) return p;
  return `…${p.slice(p.length - 47)}`;
}

function parseError(e: unknown): string {
  if (e instanceof WtRpcError) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    return (e as IpcError).message ?? String(e);
  }
  if (typeof e === "string") return e;
  return String(e);
}
