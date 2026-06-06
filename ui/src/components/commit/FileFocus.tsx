import { ArrowLeft } from "lucide-react";
import { type FileDiff } from "@/lib/types";
import { UnifiedDiff } from "./UnifiedDiff";

interface FileFocusProps {
  file: FileDiff;
  onBack: () => void;
}

export function FileFocus({ file, onBack }: FileFocusProps) {
  const path = file.new_path ?? file.old_path ?? "(unknown)";
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] bg-bg-subtle/40 px-3 py-2 shadow-[inset_0-1px_0_rgba(255,255,255,0.04)]">
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
