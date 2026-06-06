import { File as FileIcon } from "lucide-react";
import { EmptyHint } from "./DirectoryTree";
import type { DirEntry } from "@/lib/types";

export function SearchResults({
  root,
  results,
  onOpenFile,
}: {
  root: string;
  results: string[] | null;
  onOpenFile: (entry: DirEntry) => void;
}) {
  if (results === null) {
    return <EmptyHint>Searching…</EmptyHint>;
  }
  if (results.length === 0) {
    return <EmptyHint>No matches</EmptyHint>;
  }
  // Show each match as `path/relative/to/root`. Highlight the
  // matching filename in the row.
  const rootPrefix = root.endsWith("/") ? root : root + "/";
  return (
    <div>
      {results.map((abs) => {
        const rel = abs.startsWith(rootPrefix) ? abs.slice(rootPrefix.length) : abs;
        const name = rel.split("/").pop() ?? rel;
        return (
          <button
            key={abs}
            onClick={() =>
              onOpenFile({ name, path: abs, is_dir: false, size: null })
            }
            title={abs}
            className="flex w-full min-w-0 items-center gap-1.5 px-2 py-0.5 text-left text-[11px] transition-colors duration-150 hover:bg-white/[0.04] focus:bg-white/[0.04] focus:outline-none"
          >
            <FileIcon size={11} strokeWidth={1.5} className="text-fg-muted shrink-0" />
            <span className="truncate font-mono text-fg" title={rel}>
              {rel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
