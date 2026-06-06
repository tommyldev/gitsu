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
import { parsePatch } from "@/lib/diff";

interface Props {
  worktree: string;
  files: FileDiff[];
  loading: boolean;
  onFileClick?: (file: FileDiff) => void;
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

export function DiffViewer({ files, loading, onFileClick }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleClick = (file: FileDiff) => {
    if (onFileClick) {
      onFileClick(file);
    } else {
      toggle(file.new_path ?? file.old_path ?? "(unknown)");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 text-fg-muted">
        <span className="animate-pulse text-[13px]">Loading diff…</span>
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-[13px] text-fg-muted">
        No changes.
      </div>
    );
  }
  return (
    <div className="divide-y divide-white/[0.04]">
      {files.map((f) => {
        const key = f.new_path ?? f.old_path ?? "(unknown)";
        return (
          <FileDiffRow
            key={key + ":" + f.status}
            file={f}
            isOpen={open.has(key)}
            onToggle={() => handleClick(f)}
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
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] hover:bg-white/[0.03] transition-colors duration-150"
      >
        {isOpen ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronRight size={12} strokeWidth={1.5} />}
        <Icon size={12} className={tone} strokeWidth={1.5} />
        <span className={clsx("shrink-0", tone)}>{file.status}</span>
        <span className="truncate text-fg">{path}</span>
        {file.is_binary ? (
          <span className="ml-auto rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-fg-muted">
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
            <span className="inline-block w-12 shrink-0 select-none pr-2 text-right text-fg-muted">
              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
            </span>
            <span className="whitespace-pre">{line.content}</span>
          </div>
        ))}
      </code>
    </pre>
  );
}
