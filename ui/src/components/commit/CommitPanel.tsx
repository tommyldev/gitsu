/**
 * CommitPanel — the right-pane detail view for a selected commit
 * or the working tree.
 *
 * Modes:
 *   - "commit": shows a commit's metadata + file list + diff
 *   - "workdir": shows the working tree's file list + diff
 *
 * When the user clicks a file, the panel swaps to a dedicated
 * "file focus" view that takes over the entire right pane. A back
 * button returns to the file list.
 *
 * The toggle lives in the panel header.
 */

import { useEffect, useMemo, useState } from "react";
import { Copy, GitBranch, GitCommit, Tag, User, Calendar, FileCode, ChevronRight, Loader2, Sparkles, ArrowLeft } from "lucide-react";
import clsx from "clsx";
import { useGraphStore } from "@/stores/graph";
import { useRepoStore } from "@/stores/repo";
import { invoke } from "@/lib/tauri";
import { WtRpcError, type IpcError, type FileDiff } from "@/lib/types";
import { DiffViewer } from "./DiffViewer";

type Mode = "commit" | "workdir";

export function CommitPanel() {
  const { graph, selectedSha } = useGraphStore();
  const { repo } = useRepoStore();
  const [mode, setMode] = useState<Mode>("commit");
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<FileDiff | null>(null);

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
    setActiveFile(null);
    let cancelled = false;
    (async () => {
      try {
        const result =
          mode === "workdir"
            ? await invoke<FileDiff[]>("workdir_diff", { repo: repo.path })
            : node
              ? await invoke<FileDiff[]>("commit_diff", {
                  repo: repo.path,
                  sha: node.sha,
                })
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
        {activeFile ? (
          <FileFocus
            file={activeFile}
            onBack={() => setActiveFile(null)}
          />
        ) : (
          <>
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

            {mode === "workdir" && (
              <div className="border-b border-white/[0.06] px-4 py-2 text-[13px]">
                <span className="font-medium text-fg">Uncommitted changes</span>
                <p className="text-[11px] text-fg-muted">
                  Showing staged + unstaged + untracked files in the working tree.
                </p>
              </div>
            )}

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
                onFileClick={(f) => setActiveFile(f)}
              />
            )}
          </>
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

function FileFocus({
  file,
  onBack,
}: {
  file: FileDiff;
  onBack: () => void;
}) {
  const path = file.new_path ?? file.old_path ?? "(unknown)";
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] bg-bg-subtle/40 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <button
          onClick={onBack}
          className="rounded p-1 text-fg-muted transition-colors duration-150 hover:bg-white/[0.04] hover:text-fg"
          title="Back to file list"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
        </button>
        <span className="truncate font-mono text-[12px] text-fg">{path}</span>
        <span className="ml-auto flex gap-2 font-sans text-[11px]">
          <span className="text-success">+{file.additions}</span>
          <span className="text-danger">−{file.deletions}</span>
        </span>
      </div>
      <div className="flex-1 overflow-auto bg-bg">
        {file.is_binary ? (
          <div className="flex h-full items-center justify-center text-[13px] text-fg-muted">
            Binary file — no preview.
          </div>
        ) : (
          <UnifiedDiff patch={file.patch} />
        )}
      </div>
    </div>
  );
}

function UnifiedDiff({ patch }: { patch: string }) {
  const lines = useMemo(() => parsePatch(patch), [patch]);
  return (
    <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed">
      <code>
        {lines.map((line, i) => (
          <div
            key={i}
            className={clsx(
              "flex",
              line.kind === "add" && "bg-success/10",
              line.kind === "del" && "bg-danger/10",
              (line.kind === "meta" || line.kind === "context") && "text-fg",
            )}
          >
            <span className="inline-block w-12 shrink-0 select-none pr-3 text-right text-fg-muted">
              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
            </span>
            <span className="whitespace-pre">{line.content}</span>
          </div>
        ))}
      </code>
    </pre>
  );
}

interface ParsedLine {
  kind: "context" | "add" | "del" | "meta";
  content: string;
}

function parsePatch(patch: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    if (
      raw.startsWith("diff --git ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("old mode") ||
      raw.startsWith("new mode") ||
      raw.startsWith("similarity ") ||
      raw.startsWith("rename ") ||
      raw.startsWith("copy ")
    ) {
      continue;
    }
    if (raw.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.length === 0) {
      out.push({ kind: "context", content: "" });
      continue;
    }
    const c = raw[0];
    const content = raw.slice(1);
    if (c === "+") out.push({ kind: "add", content });
    else if (c === "-") out.push({ kind: "del", content });
    else if (c === " ") out.push({ kind: "context", content });
    else out.push({ kind: "meta", content: raw });
  }
  return out;
}

function CommitHeader({
  sha,
  shortSha,
  summary,
  body,
  authorName,
  authorEmail,
  authorTime,
  committerTime,
  tree,
  branches,
  tags,
}: {
  sha: string;
  shortSha: string;
  summary: string;
  body: string;
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerTime: number;
  tree: string;
  branches: { name: string; upstream: string | null }[];
  tags: { name: string; is_annotated: boolean }[];
}) {
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.warn("clipboard", e);
    }
  };

  return (
    <div>
      {/* SHA bar */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <code className="font-mono text-[13px] text-fg" title={sha}>
          {shortSha}
        </code>
        <button
          onClick={() => copy(sha)}
          className="rounded p-1 text-fg-muted hover:bg-white/[0.04] hover:text-fg transition-colors duration-150"
          title="Copy full SHA"
        >
          <Copy size={12} strokeWidth={1.5} />
        </button>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-fg-muted">commit</span>
      </div>

      {/* Message */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <p className="whitespace-pre-wrap text-[13px] leading-snug text-fg">{summary}</p>
        {body && <pre className="mt-2 whitespace-pre-wrap text-[11px] text-fg-muted">{body}</pre>}
      </div>

      {/* Metadata */}
      <dl className="border-b border-white/[0.06] px-4 py-3 text-[13px]">
        <Row icon={<User size={12} strokeWidth={1.5} />} label="Author">
          <span>{authorName || "?"}</span>
          {authorEmail && (
            <span className="ml-1 text-fg-muted">&lt;{authorEmail}&gt;</span>
          )}
        </Row>
        <Row icon={<Calendar size={12} strokeWidth={1.5} />} label="Date">
          {new Date(authorTime * 1000).toLocaleString()}
        </Row>
        <Row icon={<GitCommit size={12} strokeWidth={1.5} />} label="Committer">
          {new Date(committerTime * 1000).toLocaleString()}
        </Row>
        <Row icon={<FileCode size={12} strokeWidth={1.5} />} label="Tree">
          <code className="font-mono text-[11px]">{tree.slice(0, 7)}</code>
        </Row>
      </dl>

      {/* Branches / tags */}
      {(branches.length > 0 || tags.length > 0) && (
        <div className="border-b border-white/[0.06] px-4 py-3">
          {branches.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted">Branches</p>
              <ul className="space-y-1">
                {branches.map((b) => (
                  <li
                    key={b.name}
                    className="flex items-center gap-1.5 font-mono text-[11px] text-fg"
                  >
                    <GitBranch size={11} className="text-accent" strokeWidth={1.5} />
                    {b.name}
                    {b.upstream && <span className="text-fg-muted">→ {b.upstream}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tags.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted">Tags</p>
              <ul className="space-y-1">
                {tags.map((t) => (
                  <li
                    key={t.name}
                    className="flex items-center gap-1.5 font-mono text-[11px] text-fg"
                  >
                    <Tag size={11} className="text-fg-muted" strokeWidth={1.5} />
                    {t.name}
                    {t.is_annotated && <span className="text-fg-muted">(annotated)</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* LLM commit composer (suggests a message) — M3 stretch */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-fg-muted">
          Compose commit
        </p>
        <button
          className="flex w-full items-center gap-2 rounded-md border border-white/[0.08] bg-bg px-2 py-1.5 text-left text-[11px] text-fg-muted hover:border-accent/50 hover:text-fg transition-colors duration-150"
          disabled
          title="Configure [commit.generation] in worktrunk to enable"
        >
          <Sparkles size={12} strokeWidth={1.5} />
          Generate message with LLM…
        </button>
        <p className="mt-1 text-[10px] text-fg-muted">
          Configure <code className="font-mono">[commit.generation]</code> in worktrunk to enable.
        </p>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-start gap-2 last:mb-0">
      <span className="mt-1 text-fg-muted">{icon}</span>
      <span className="w-20 shrink-0 text-fg-muted">{label}</span>
      <span className="flex-1 text-fg">{children}</span>
      <ChevronRight size={10} className="mt-1 text-fg-muted opacity-0" />
    </div>
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
