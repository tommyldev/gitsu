/**
 * HooksManager — modal view of the current `.config/wt.toml` and
 * `.worktreeinclude` plus install / uninstall / recopy controls.
 */

import { useEffect, useState } from "react";
import { Copy, X, Trash2, RotateCw, Settings } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useHooksStore } from "@/stores/hooks";
import { WtRpcError, type IpcError } from "@/lib/types";

interface Props {
  onClose: () => void;
}

export function HooksManager({ onClose }: Props) {
  const repo = useRepoStore((s) => s.repo);
  const snapshot = useHooksStore((s) => s.snapshot);
  const install = useHooksStore((s) => s.install);
  const uninstall = useHooksStore((s) => s.uninstall);
  const recopy = useHooksStore((s) => s.recopy);
  const loading = useHooksStore((s) => s.loading);

  const [recoFrom, setRecoFrom] = useState("");
  const [recoTo, setRecoTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repo) return;
    setRecoFrom(repo.path);
    setRecoTo(repo.path);
  }, [repo]);

  if (!repo) return null;

  const handleRecopy = async () => {
    setBusy(true);
    setError(null);
    try {
      await recopy(repo.path, recoFrom, recoTo);
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
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-bg-subtle bg-bg-panel shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-bg-subtle px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Settings size={16} /> Hooks &amp; worktree config
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-bg-subtle"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-4">
          <section className="mb-5">
            <h3 className="mb-1.5 text-sm font-semibold">`.config/wt.toml`</h3>
            <p className="mb-2 text-xs text-fg-muted">
              {snapshot?.config_path ?? "not installed"}
            </p>
            {snapshot?.installed ? (
              <div className="space-y-2">
                {snapshot.has_post_start_copy_ignored ? (
                  <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm">
                    <span className="mt-0.5">✓</span>
                    <div className="flex-1">
                      <p>
                        <code className="font-mono">[post-start]</code> hook is installed.
                      </p>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        New worktrees will run <code className="font-mono">wt step copy-ignored</code>.
                      </p>
                    </div>
                    <button
                      onClick={() => uninstall(repo.path)}
                      disabled={loading}
                      className="flex items-center gap-1 rounded border border-danger/30 bg-danger/10 px-2 py-1 text-xs text-danger hover:bg-danger/20 disabled:opacity-50"
                    >
                      <Trash2 size={11} /> Uninstall
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                    <span className="mt-0.5">⚠</span>
                    <div className="flex-1">
                      <p>
                        Installed, but no <code className="font-mono">post-start</code> hook.
                      </p>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        Add gitsu's recommended hook so new worktrees bring over
                        <code className="font-mono"> .env</code> + caches.
                      </p>
                    </div>
                    <button
                      onClick={() => install(repo.path, false)}
                      disabled={loading}
                      className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      Add hook
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-bg-subtle bg-bg p-3 text-sm">
                <p className="flex-1 text-fg-muted">
                  No <code className="font-mono">.config/wt.toml</code> yet.
                </p>
                <button
                  onClick={() => install(repo.path, true)}
                  disabled={loading}
                  className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            )}
          </section>

          <section className="mb-5">
            <h3 className="mb-1.5 text-sm font-semibold">`.worktreeinclude`</h3>
            {snapshot?.worktreeinclude_path ? (
              <div>
                <p className="mb-1 text-xs text-fg-muted">{snapshot.worktreeinclude_path}</p>
                <pre className="max-h-48 overflow-auto rounded-md border border-bg-subtle bg-bg p-2 text-xs">
                  {snapshot.worktreeinclude_contents}
                </pre>
              </div>
            ) : (
              <p className="text-xs text-fg-muted">Not present.</p>
            )}
          </section>

          <section className="mb-2">
            <h3 className="mb-1.5 text-sm font-semibold">Recopy ignored files</h3>
            <p className="mb-2 text-xs text-fg-muted">
              Run <code className="font-mono">wt step copy-ignored --force</code> to re-copy
              <code className="font-mono"> .env</code>, <code className="font-mono">node_modules/</code>,
              etc. from one worktree to another.
            </p>
            <div className="flex items-center gap-2 text-xs">
              <label className="flex-1">
                <span className="mb-1 block text-fg-muted">From</span>
                <input
                  className="input font-mono"
                  value={recoFrom}
                  onChange={(e) => setRecoFrom(e.target.value)}
                />
              </label>
              <label className="flex-1">
                <span className="mb-1 block text-fg-muted">To</span>
                <input
                  className="input font-mono"
                  value={recoTo}
                  onChange={(e) => setRecoTo(e.target.value)}
                />
              </label>
              <button
                onClick={handleRecopy}
                disabled={busy || !recoFrom || !recoTo}
                className="mt-5 flex items-center gap-1 rounded border border-bg-subtle bg-bg px-2 py-1.5 text-fg hover:border-accent disabled:opacity-50"
              >
                <RotateCw size={11} /> Recopy
              </button>
            </div>
            {error && (
              <p className="mt-2 rounded border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
                {error}
              </p>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between border-t border-bg-subtle px-4 py-2 text-xs text-fg-subtle">
          <span>
            <Copy size={11} className="mr-1 inline" /> Click any field to copy.
          </span>
          <span>worktrunk reads <code className="font-mono">.config/wt.toml</code> on every worktree create.</span>
        </footer>
      </div>
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
