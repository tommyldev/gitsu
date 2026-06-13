/**
 * CommitPanel — the right-pane detail view for a selected commit
 * or the working tree.
 *
 * Modes:
 *   - "commit": shows a commit's metadata + file list + diff
 *   - "workdir": shows the working tree's file list + diff, with
 *     per-file stage/unstage toggles and Stage all / Unstage all
 *     (the commit itself happens in the left-pane CommitComposer)
 *
 * When the user clicks a file, the panel swaps to a dedicated
 * "file focus" view that takes over the entire right pane. A back
 * button returns to the file list.
 *
 * The toggle lives in the panel header.
 */

import { useEffect, useMemo, useState } from "react";
import { GitCommit, Loader2 } from "lucide-react";
import clsx from "clsx";
import { useGraphStore } from "@/stores/graph";
import { useRepoStore } from "@/stores/repo";
import { workdirDiff, commitDiff } from "@/lib/tauri";
import { parseError } from "@/lib/errors";
import type { FileDiff } from "@/lib/types";
import { DiffViewer } from "./DiffViewer";
import { CommitHeader } from "./CommitHeader";
import { useFileViewerStore } from "@/stores/fileViewer";
import { useStagingSync } from "@/hooks/useStagingSync";
import { WorkdirStagingBar, StageFileButton } from "./WorkdirStagingControls";
type Mode = "commit" | "workdir";

export function CommitPanel() {
  const { graph, selectedSha } = useGraphStore();
  const { repo } = useRepoStore();
  const [mode, setMode] = useState<Mode>("commit");
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the staging store fresh so the per-file stage toggles in
  // workdir mode reflect reality even when the left composer is
  // hidden (⌘B). Deduped — the composer/graph share the same fetch.
  useStagingSync();

  const node = useMemo(
    () => graph?.nodes.find((n) => n.sha === selectedSha),
    [graph, selectedSha],
  );

  const branches = useMemo(
    () => (graph?.branches ?? []).filter((b) => b.sha === selectedSha),
    [graph, selectedSha],
  );
  const tags = useMemo(
    () => (graph?.tags ?? []).filter((t) => t.sha === selectedSha),
    [graph, selectedSha],
  );

  useEffect(() => {
    if (!repo) return;
    setError(null);
    setLoading(true);
    setFiles([]);
    useFileViewerStore.getState().close();
    let cancelled = false;
    (async () => {
      try {
        const result =
          mode === "workdir"
            ? await workdirDiff(repo.path)
            : node
              ? await commitDiff(repo.path, node.sha)
              : [];
        if (!cancelled) {
          setFiles(result);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(parseError(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, node?.sha, repo?.path]);

  if (!node && mode === "commit") {
    return (
      <aside className="flex h-full w-full flex-col items-center justify-center gap-2 border-l border-white/[0.06] bg-bg-panel p-6 text-center text-fg-muted">
        <GitCommit size={28} className="opacity-50" strokeWidth={1.5} />
        <p className="text-[13px]">Select a commit to see its details.</p>
        <p className="text-[11px] text-fg-muted">Click a row in the graph, or press <kbd className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px]">↑</kbd>/<kbd className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px]">↓</kbd>.</p>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-white/[0.06] bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.15)]">
      {/* Mode toggle */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-2 py-1.5">
        <button
          onClick={() => setMode("commit")}
          className={clsxTab(mode === "commit")}
        >
          Commit
        </button>
        <button
          onClick={() => setMode("workdir")}
          className={clsxTab(mode === "workdir")}
        >
          Working tree
        </button>
      </div>

      {error && (
        <div className="border-b border-danger/20 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {mode === "commit" && node ? (
          <CommitHeader
            sha={node.sha}
            shortSha={node.short_sha}
            summary={node.summary}
            body={node.body}
            authorName={node.author_name}
            authorEmail={node.author_email}
            authorTime={node.author_time}
            committerTime={node.committer_time}
            tree={node.tree}
            branches={branches}
            tags={tags}
          />
        ) : null}

        {mode === "workdir" && <WorkdirStagingBar />}

        {loading ? (
          <div className="flex items-center justify-center p-6 text-fg-muted">
            <Loader2 size={14} className="mr-2 animate-spin" strokeWidth={1.5} />
            <span className="text-[13px]">Loading…</span>
          </div>
        ) : (
          <DiffViewer
            worktree={repo?.path ?? ""}
            files={files}
            loading={false}
            trailing={
              mode === "workdir"
                ? (f) => {
                    const path = f.new_path ?? f.old_path;
                    return path ? <StageFileButton path={path} /> : null;
                  }
                : undefined
            }
            onFileClick={(f) =>
              useFileViewerStore
                .getState()
                .open(
                  f,
                  repo?.path ?? "",
                  mode === "commit" ? node?.sha ?? null : null,
                )
            }
          />
        )}
      </div>
    </aside>
  );
}

function clsxTab(active: boolean): string {
  return clsx(
    "rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-200 ease-standard",
    active
      ? "bg-white/[0.05] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
      : "text-fg-muted hover:bg-white/[0.03] hover:text-fg",
  );
}

