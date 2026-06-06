import React from "react";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
} from "lucide-react";
import clsx from "clsx";
import { useDirectoryStore } from "@/stores/directory";
import { formatSize } from "@/lib/format";
import type { DirEntry } from "@/lib/types";

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-fg-muted">
      {children}
    </div>
  );
}

export function DirectoryTree({
  root,
  onOpenFile,
  onToggle,
}: {
  root: string;
  onOpenFile: (entry: DirEntry) => void;
  onToggle: (dir: string) => Promise<void>;
}) {
  const cache = useDirectoryStore((s) => s.cache);
  const expanded = useDirectoryStore((s) => s.expanded);
  const loading = useDirectoryStore((s) => s.loading);

  const renderNode = (dir: string, depth: number): React.ReactNode => {
    const entries = cache.get(dir) ?? [];
    const isExpanded = expanded.has(dir);
    const isLoading = loading.has(dir);
    return (
      <div key={dir}>
        <DirectoryRow
          depth={depth}
          entry={{
            name: dir.split("/").pop() || dir,
            path: dir,
            is_dir: true,
            size: null,
          }}
          isExpanded={isExpanded}
          isLoading={isLoading}
          onClick={() => void onToggle(dir)}
        />
        {isExpanded && entries.length > 0 && (
          <div>
            {entries.map((entry) =>
              entry.is_dir ? (
                renderNode(entry.path, depth + 1)
              ) : (
                <DirectoryRow
                  key={entry.path}
                  depth={depth + 1}
                  entry={entry}
                  isExpanded={false}
                  isLoading={false}
                  onClick={() => onOpenFile(entry)}
                />
              ),
            )}
          </div>
        )}
        {isExpanded && entries.length === 0 && !isLoading && (
          <div
            className="pl-6 py-1 text-[10px] text-fg-subtle"
            style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
          >
            (empty)
          </div>
        )}
      </div>
    );
  };

  return <div>{renderNode(root, 0)}</div>;
}

function DirectoryRow({
  entry,
  depth,
  isExpanded,
  isLoading,
  onClick,
}: {
  entry: DirEntry;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  onClick: () => void;
}) {
  const indent = depth * 12;
  const isDir = entry.is_dir;
  return (
    <button
      onClick={onClick}
      title={entry.path}
      className={clsx(
        "flex w-full min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-left text-[11px] transition-colors duration-150",
        "hover:bg-white/[0.04] focus:bg-white/[0.04] focus:outline-none",
      )}
      style={{ paddingLeft: `${indent + 6}px` }}
    >
      {isDir ? (
        isExpanded ? (
          <ChevronDown size={10} strokeWidth={1.5} className="text-fg-muted shrink-0" />
        ) : (
          <ChevronRight size={10} strokeWidth={1.5} className="text-fg-muted shrink-0" />
        )
      ) : (
        <span className="w-2.5 shrink-0" />
      )}
      {isDir ? (
        isExpanded ? (
          <FolderOpenIcon size={11} strokeWidth={1.5} className="text-accent shrink-0" />
        ) : (
          <FolderIcon size={11} strokeWidth={1.5} className="text-accent shrink-0" />
        )
      ) : (
        <FileIcon size={11} strokeWidth={1.5} className="text-fg-muted shrink-0" />
      )}
      <span className="truncate font-mono text-fg">{entry.name}</span>
      {isDir && isLoading && (
        <span className="ml-auto text-[9px] text-fg-subtle">…</span>
      )}
      {!isDir && entry.size != null && (
        <span className="ml-auto shrink-0 text-[10px] text-fg-subtle tabular-nums">
          {formatSize(entry.size)}
        </span>
      )}
    </button>
  );
}
