/**
 * CreateBranchDialog — small modal for the "Branch" button on the
 * graph's action bar.
 *
 * Distinct from CreateWorktreeDialog in two ways:
 *   1. There is no new worktree / directory; the new branch is
 *      created in the *current* worktree's HEAD.
 *   2. There's no base/execute/copyEnv — just a name.
 *
 * v1 doesn't support switching after create (a future enhancement
 * could add a "Switch to it" checkbox). The graph remains on the
 * current branch so the user can keep reviewing the same history
 * while their new branch sits in the local refs.
 */

import { useEffect, useRef, useState } from "react";
import { GitBranch, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { invoke } from "@/lib/tauri";
import { WtRpcError, type BranchCreateResult, type IpcError } from "@/lib/types";

interface Props {
  worktree: string;
  onClose: () => void;
  onCreated: (result: BranchCreateResult) => void;
}

export function CreateBranchDialog({ worktree, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Defer autofocus a tick so the modal-scale animation doesn't
    // eat the focus event.
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<BranchCreateResult>("git_branch_create", {
        worktree,
        name: trimmed,
      });
      onCreated(result);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="modal-panel w-full max-w-sm overflow-hidden rounded-lg border border-white/[0.08] bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
        style={{ animation: "modal-scale 200ms cubic-bezier(0.25, 0.1, 0.25, 1.0) forwards" }}
      >
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
            <GitBranch size={18} strokeWidth={1.5} /> New branch
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <div className="space-y-3 p-5">
          <p className="text-[12px] text-fg-muted">
            Creates a new local branch at this worktree's HEAD. It does
            <em> not </em>make a new worktree directory — for that, use
            <kbd className="ml-1 rounded bg-bg-subtle px-1.5 py-0.5 text-[10px]">⌘N</kbd>.
          </p>
          <label className="block text-[13px]">
            <span className="mb-1.5 block text-fg-muted text-[12px]">Branch name</span>
            <div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-bg px-3 py-2 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/10 transition-all duration-150">
              <GitBranch size={14} className="text-fg-muted shrink-0" strokeWidth={1.5} />
              <input
                ref={inputRef}
                className="w-full bg-transparent text-[13px] text-fg placeholder:text-fg-muted focus:outline-none"
                placeholder="feature/auth-flow"
                value={name}
                onChange={(e) => setName(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </label>

          {error && (
            <p className="rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            <Plus size={14} strokeWidth={1.5} />
            {busy ? "Creating…" : "Create branch"}
          </Button>
        </footer>
      </form>
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
