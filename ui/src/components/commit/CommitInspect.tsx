/**
 * CommitInspect — the right-pane view for inspecting a specific commit.
 *
 * Sits inside `CommitComposer` (replacing the staging UI) when the
 * user clicks a commit row in the graph other than the pending
 * working-tree row. Renders the commit's metadata + file diff and
 * exposes a "Back to working changes" affordance so the user can
 * return to staging their work.
 *
 * The back affordance is the only way to leave this view — closing
 * the panel does nothing, and the staging state is preserved exactly
 * as it was when the user left it (the staging store is independent
 * of this component).
 */

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useGraphStore } from "@/stores/graph";
import { useRepoStore } from "@/stores/repo";
import { commitDiff } from "@/lib/tauri";
import { parseError } from "@/lib/errors";
import type { FileDiff } from "@/lib/types";
import { CommitHeader } from "./CommitHeader";
import { DiffViewer } from "./DiffViewer";
import { useFileViewerStore } from "@/stores/fileViewer";

export function CommitInspect({ onBack }: { onBack: () => void }) {
  const { graph, selectedSha } = useGraphStore();
  const { repo } = useRepoStore();
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const node = graph?.nodes.find((n) => n.sha === selectedSha) ?? null;
  const branches = (graph?.branches ?? []).filter((b) => b.sha === selectedSha);
  const tags = (graph?.tags ?? []).filter((t) => t.sha === selectedSha);

  useEffect(() => {
    if (!repo || !node) return;
    setError(null);
    setLoading(true);
    setFiles([]);
    useFileViewerStore.getState().close();
    let cancelled = false;
    (async () => {
      try {
        const result = await commitDiff(repo.path, node.sha);
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
  }, [node?.sha, repo?.path]);

  if (!node) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-fg-muted">
        <p className="text-[13px]">No commit selected.</p>
        <p className="text-[11px] text-fg-subtle">
          Click a commit row in the graph to inspect it.
        </p>
      </div>
    );
  }

  return (
    <>
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-2 py-1.5">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted transition-all duration-200 hover:bg-white/[0.04] hover:text-fg"
          title="Return to working changes"
        >
          <ArrowLeft size={12} strokeWidth={1.5} />
          Back to working changes
        </button>
        <span className="font-mono text-[10px] text-fg-subtle" title={node.sha}>
          {node.short_sha}
        </span>
      </header>

      {error && (
        <div className="border-b border-danger/20 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
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
        {loading ? (
          <div className="flex items-center justify-center p-6 text-fg-muted">
            <Loader2 size={14} className="mr-2 animate-spin" strokeWidth={1.5} />
            <span className="text-[13px]">Loading diff…</span>
          </div>
        ) : (
          <DiffViewer
            worktree={repo?.path ?? ""}
            files={files}
            loading={false}
            onFileClick={(f) =>
              useFileViewerStore.getState().open(f, repo?.path ?? "", node.sha)
            }
          />
        )}
      </div>
    </>
  );
}
