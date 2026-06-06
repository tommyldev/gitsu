/**
 * Git actions hook — pull/push/stash/pop/branch handlers + busy/banner state.
 * Consumed by GitActionsBar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRepoStore } from "@/stores/repo";
import { useGraphStore } from "@/stores/graph";
import { gitStashPush, gitStashPop } from "@/lib/tauri";
import { type BranchCreateResult, type RemoteOpResult } from "@/lib/types";
import { parseError } from "@/lib/errors";

/** One of the five buttons. Used as a key for the per-op busy state. */
export type Op = "pull" | "push" | "branch" | "stash" | "pop";

/** Severity of the last banner — drives colors + auto-dismiss timing. */
export type BannerKind = "success" | "error" | "info";

export interface Banner {
  kind: BannerKind;
  message: string;
}

const SUCCESS_MS = 4000;
const ERROR_MS = 8000;

function labelFor(op: Op): string {
  switch (op) {
    case "pull": return "Pull";
    case "push": return "Push";
    case "branch": return "Branch";
    case "stash": return "Stash";
    case "pop": return "Pop";
  }
}

/** Pick a single line of stderr to surface in the success toast. Pull
 *  and push emit their interesting line on stderr (e.g. "Fast-forward
 *  to abc1234", "Everything up-to-date", "To github.com:foo/bar.git").
 *  We grab the first non-empty line so the user gets a useful signal. */
function pickInterestingLine(text: string): string | null {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return line ?? null;
}

export interface UseGitActionsResult {
  handlers: {
    runRemote: (op: Exclude<Op, "branch">, run: (worktree: string) => Promise<RemoteOpResult>) => Promise<void>;
    onStash: () => Promise<void>;
    onPop: () => Promise<void>;
    onBranchCreated: (result: BranchCreateResult) => Promise<void>;
  };
  busy: Op | null;
  banner: Banner | null;
  dismissBanner: () => void;
}

export interface UseGitActionsOptions {
  onCloseBranch: () => void;
}

export function useGitActions({ onCloseBranch }: UseGitActionsOptions): UseGitActionsResult {
  const repo = useRepoStore((s) => s.repo);
  const activePath = useGraphStore((s) => s.activePath);
  const graphFetch = useGraphStore((s) => s.fetch);
  const repoRefresh = useRepoStore((s) => s.refresh);

  const [busy, setBusy] = useState<Op | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const dismissTimer = useRef<number | null>(null);

  const flash = useCallback((kind: BannerKind, message: string) => {
    setBanner({ kind, message });
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
    }
    const ms = kind === "error" ? ERROR_MS : SUCCESS_MS;
    dismissTimer.current = window.setTimeout(() => setBanner(null), ms);
  }, []);

  // Clear any pending banner when the active worktree changes.
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
    await Promise.all([
      repoRefresh(),
      activePath ? graphFetch(activePath) : Promise.resolve(),
    ]);
  }, [activePath, graphFetch, repo, repoRefresh]);

  const runRemote = useCallback(
    async (op: Exclude<Op, "branch">, run: (worktree: string) => Promise<RemoteOpResult>) => {
      if (!activePath) return;
      setBusy(op);
      setBanner(null);
      try {
        const result = await run(activePath);
        await refreshAll();
        if (result.exit_code === 0) {
          if (result.fetch_only) {
            flash("info", "No upstream for this branch — fetched remotes only. Use Push to publish.");
            return;
          }
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
      const result = await gitStashPush(activePath, null);
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
      const result = await gitStashPop(activePath);
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
      onCloseBranch();
      await refreshAll();
      const suffix = result.already_checked_out ? " (already checked out)" : "";
      flash("success", `Created branch ${result.name} at ${result.sha.slice(0, 7)}${suffix}`);
    },
    [flash, onCloseBranch, refreshAll],
  );

  return {
    handlers: {
      runRemote,
      onStash,
      onPop,
      onBranchCreated,
    },
    busy,
    banner,
    dismissBanner: () => setBanner(null),
  };
}
