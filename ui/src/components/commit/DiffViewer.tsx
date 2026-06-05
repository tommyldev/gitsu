/**
 * DiffViewer — renders a unified diff with per-line +/- coloring.
 *
 * For v1, we render with simple gutter colors (no per-token
 * syntax highlighting — Shiki per-line rendering is slow and the
 * +/- prefix already gives the visual signal). M3.5 will swap in
 * rich Shiki rendering once we have a per-line tokenizer.
 */

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileMinus,
  FileEdit,
  FileSymlink,
  type LucideIcon,
} from "lucide-react";
import type { FileDiff, DiffStatus } from "@/lib/types";

interface Props {
  worktree: string;
  files: FileDiff[];
  loading: boolean;
}

const STATUS_ICON: Record<DiffStatus, LucideIcon> = {
  added: FilePlus,
  deleted: FileMinus,
  modified: FileEdit,
  renamed: FileSymlink,
  copied: FileSymlink,
  typechange: FileEdit,
  untracked: FilePlus,
  ignored: FileMinus,
};

const STATUS_TONE: Record<DiffStatus, string> = {
  added: "text-success",
  deleted: "text-danger",
  modified: "text-warning",
  renamed: "text-accent",
  copied: "text-accent",
  typechange: "text-fg-muted",
  untracked: "text-fg-muted",
  ignored: "text-fg-subtle",
};

export function DiffViewer({ files, loading }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 text-fg-muted">
        <span className="animate-pulse text-sm">Loading diff…</span>
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-fg-muted">
        No changes.
      </div>
    );
  }
  return (
    <div className="divide-y divide-bg-subtle">
      {files.map((f) => {
        const key = f.new_path ?? f.old_path ?? "(unknown)";
        return (
          <FileDiffRow
            key={key + ":" + f.status}
            file={f}
            isOpen={open.has(key)}
            onToggle={() => toggle(key)}
          />
        );
      })}
    </div>
  );
}

function FileDiffRow({
  file,
  isOpen,
  onToggle,
}: {
  file: FileDiff;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const path = file.new_path ?? file.old_path ?? "(unknown)";
  const Icon = STATUS_ICON[file.status] ?? FileEdit;
  const tone = STATUS_TONE[file.status] ?? "text-fg-muted";

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-bg-subtle"
      >
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Icon size={12} className={tone} />
        <span className={clsx("shrink-0", tone)}>{file.status}</span>
        <span className="truncate">{path}</span>
        {file.is_binary ? (
          <span className="ml-auto rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] text-fg-subtle">
            binary
          </span>
        ) : (
          <span className="ml-auto flex gap-1.5 font-sans text-[10px]">
            <span className="text-success">+{file.additions}</span>
            <span className="text-danger">−{file.deletions}</span>
          </span>
        )}
      </button>
      {isOpen && !file.is_binary && (
        <div className="bg-bg">
          <UnifiedPatch patch={file.patch} />
        </div>
      )}
    </div>
  );
}

function UnifiedPatch({ patch }: { patch: string }) {
  const lines = useMemo(() => parsePatch(patch), [patch]);
  return (
    <pre className="overflow-x-auto p-2 font-mono text-[11px] leading-relaxed">
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
            <span className="inline-block w-12 shrink-0 select-none pr-2 text-right text-fg-subtle">
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
  // Skip diff metadata; render hunks only.
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
