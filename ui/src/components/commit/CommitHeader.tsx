import React from "react";
import { Copy, GitBranch, GitCommit, Tag, User, Calendar, FileCode, ChevronRight, Sparkles } from "lucide-react";

interface CommitHeaderProps {
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

export function CommitHeader({
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
}: CommitHeaderProps) {
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
