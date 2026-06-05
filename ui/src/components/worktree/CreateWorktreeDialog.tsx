/**
 * Create-worktree dialog. The v1 form maps 1:1 to `wt switch --create`:
 *   - branch name
 *   - base branch (default: worktrunk's default branch)
 *   - execute (optional command after switch — gitsu v1 uses this to
 *     spawn the per-worktree terminal or open an editor)
 *   - copy env/caches (writes a post-start hook to the repo's
 *     .config/wt.toml on submit; out of scope for v1's first cut)
 */

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { invoke } from "@/lib/tauri";
import { useRepoStore } from "@/stores/repo";
import { WtRpcError, type IpcError, type SwitchResult } from "@/lib/types";
import { GitBranch, Plus, X } from "lucide-react";

interface Props {
  onClose: () => void;
  onCreated?: (r: SwitchResult) => void;
}

export function CreateWorktreeDialog({ onClose, onCreated }: Props) {
  const { repo, worktrees, refresh } = useRepoStore();
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState(worktrees?.default_branch ?? "main");
  const [execute, setExecute] = useState("");
  const [copyEnv, setCopyEnv] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo) return;
    if (!branch.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<SwitchResult>("wt_switch_create", {
        repo: repo.path,
        branch: branch.trim(),
        base: base.trim() || null,
        execute: execute.trim() || null,
      });
      onCreated?.(result);
      await refresh();
      onClose();
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
        className="modal-panel w-full max-w-md overflow-hidden rounded-lg border border-white/[0.08] bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
        style={{
          animation: "modal-scale 200ms cubic-bezier(0.25, 0.1, 0.25, 1.0) forwards",
        }}
      >
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
            <Plus size={18} strokeWidth={1.5} /> New worktree
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <label className="block text-[13px]">
            <span className="mb-1.5 block text-fg-muted text-[12px]">Branch name</span>
            <div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-bg px-3 py-2 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/10 transition-all duration-150">
              <GitBranch size={14} className="text-fg-muted shrink-0" strokeWidth={1.5} />
              <input
                autoFocus
                className="w-full bg-transparent text-[13px] text-fg placeholder:text-fg-muted focus:outline-none"
                placeholder="feature/auth-flow"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
          </label>

          <label className="block text-[13px]">
            <span className="mb-1.5 block text-fg-muted text-[12px]">Base branch</span>
            <input
              className="input font-mono text-[13px]"
              placeholder="main"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            />
          </label>

          <label className="block text-[13px]">
            <span className="mb-1.5 block text-fg-muted text-[12px]">
              Run after switch <span className="text-fg-subtle">(optional)</span>
            </span>
            <input
              className="input font-mono text-[13px]"
              placeholder="code .   |   claude   |   zsh"
              value={execute}
              onChange={(e) => setExecute(e.target.value)}
            />
          </label>

          <label className="flex items-center gap-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={copyEnv}
              onChange={(e) => setCopyEnv(e.target.checked)}
              className="h-4 w-4 rounded border-white/[0.08] bg-bg accent-accent"
            />
            <span className="text-fg">Bring over <code className="font-mono text-[11px]">.env</code> &amp; build caches</span>
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
          <Button type="submit" variant="primary" disabled={busy || !branch.trim()}>
            {busy ? "Creating…" : "Create worktree"}
          </Button>
        </footer>
      </form>
      <style>{`
        @keyframes modal-in {
          from { opacity: 0; transform: scale(1); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
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
