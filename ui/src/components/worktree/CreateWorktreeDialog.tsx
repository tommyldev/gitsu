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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-bg-subtle bg-bg-panel p-5 shadow-2xl"
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Plus size={18} /> New worktree
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-bg-subtle">
            <X size={16} />
          </button>
        </header>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-fg-muted">Branch name</span>
          <div className="flex items-center gap-2 rounded-md border border-bg-subtle bg-bg pr-2 focus-within:border-accent">
            <GitBranch size={14} className="ml-2 text-fg-subtle" />
            <input
              autoFocus
              className="w-full bg-transparent py-1.5 text-sm focus:outline-none"
              placeholder="feature/auth-flow"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-fg-muted">Base branch</span>
          <input
            className="input font-mono"
            placeholder="main"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-fg-muted">
            Run after switch <span className="text-fg-subtle">(optional)</span>
          </span>
          <input
            className="input font-mono"
            placeholder="code .   |   claude   |   zsh"
            value={execute}
            onChange={(e) => setExecute(e.target.value)}
          />
        </label>

        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={copyEnv}
            onChange={(e) => setCopyEnv(e.target.checked)}
            className="h-4 w-4 rounded border-bg-subtle bg-bg-panel accent-accent"
          />
          <span>Bring over <code className="font-mono text-xs">.env</code> &amp; build caches</span>
          <span className="pill ml-auto">via post-start hook</span>
        </label>

        {error && (
          <p className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <footer className="flex items-center justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !branch.trim()}>
            {busy ? "Creating…" : "Create worktree"}
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
