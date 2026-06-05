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
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-panel flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
        style={{
          animation: "modal-scale 200ms cubic-bezier(0.25, 0.1, 0.25, 1.0) forwards",
        }}
      >
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
            <Settings size={16} strokeWidth={1.5} /> Hooks &amp; worktree config
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-5">
          <section className="mb-5">
            <h3 className="mb-1.5 text-[13px] font-semibold text-fg">`.config/wt.toml`</h3>
            <p className="mb-2 text-[11px] text-fg-muted">
              {snapshot?.config_path ?? "not installed"}
            </p>
            {snapshot?.installed ? (
              <div className="space-y-2">
                {snapshot.has_post_start_copy_ignored ? (
                  <div className="flex items-start gap-2 rounded-md border border-success/20 bg-success/10 p-3 text-[13px]">
                    <span className="mt-0.5 text-success">✓</span>
                    <div className="flex-1">
                      <p>
                        <code className="font-mono">[post-start]</code> hook is installed.
                      </p>
                      <p className="mt-0.5 text-[11px] text-fg-muted">
                        New worktrees will run <code className="font-mono">wt step copy-ignored</code>.
                      </p>
                    </div>
                    <button
                      onClick={() => uninstall(repo.path)}
                      disabled={loading}
                      className="flex items-center gap-1 rounded border border-danger/20 bg-danger/10 px-2 py-1 text-[11px] text-danger hover:bg-danger/20 disabled:opacity-50 transition-colors duration-150"
                    >
                      <Trash2 size={11} strokeWidth={1.5} /> Uninstall
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-warning/20 bg-warning/10 p-3 text-[13px]">
                    <span className="mt-0.5 text-warning">⚠</span>
                    <div className="flex-1">
                      <p>
                        Installed, but no <code className="font-mono">post-start</code> hook.
                      </p>
                      <p className="mt-0.5 text-[11px] text-fg-muted">
                        Add gitsu's recommended hook so new worktrees bring over
                        <code className="font-mono"> .env</code> + caches.
                      </p>
                    </div>
                    <button
                      onClick={() => install(repo.path, false)}
                      disabled={loading}
                      className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-[11px] text-white hover:bg-accent-hover disabled:opacity-50 transition-colors duration-150"
                    >
                      Add hook
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-white/[0.06] bg-bg p-3 text-[13px]">
                <p className="flex-1 text-fg-muted">
                  No <code className="font-mono">.config/wt.toml</code> yet.
                </p>
                <button
                  onClick={() => install(repo.path, true)}
                  disabled={loading}
                  className="rounded bg-accent px-2 py-1 text-[11px] text-white hover:bg-accent-hover disabled:opacity-50 transition-colors duration-150"
                >
                  Create
                </button>
              </div>
            )}
          </section>

          <section className="mb-5">
            <h3 className="mb-1.5 text-[13px] font-semibold text-fg">`.worktreeinclude`</h3>
            {snapshot?.worktreeinclude_path ? (
              <div>
                <p className="mb-1 text-[11px] text-fg-muted">{snapshot.worktreeinclude_path}</p>
                <pre className="max-h-48 overflow-auto rounded-md border border-white/[0.06] bg-bg p-2 text-[11px] text-fg-muted">
                  {snapshot.worktreeinclude_contents}
                </pre>
              </div>
            ) : (
              <p className="text-[11px] text-fg-muted">Not present.</p>
            )}
          </section>

          <section className="mb-2">
            <h3 className="mb-1.5 text-[13px] font-semibold text-fg">Recopy ignored files</h3>
            <p className="mb-2 text-[11px] text-fg-muted">
              Run <code className="font-mono">wt step copy-ignored --force</code> to re-copy
              <code className="font-mono"> .env</code>, <code className="font-mono">node_modules/</code>,
              etc. from one worktree to another.
            </p>
            <div className="flex items-center gap-2 text-[11px]">
              <label className="flex-1">
                <span className="mb-1 block text-fg-muted text-[12px]">From</span>
                <input
                  className="input font-mono text-[11px]"
                  value={recoFrom}
                  onChange={(e) => setRecoFrom(e.target.value)}
                />
              </label>
              <label className="flex-1">
                <span className="mb-1 block text-fg-muted text-[12px]">To</span>
                <input
                  className="input font-mono text-[11px]"
                  value={recoTo}
                  onChange={(e) => setRecoTo(e.target.value)}
                />
              </label>
              <button
                onClick={handleRecopy}
                disabled={busy || !recoFrom || !recoTo}
                className="mt-5 flex items-center gap-1 rounded border border-white/[0.08] bg-bg px-2 py-1.5 text-fg hover:border-accent/50 disabled:opacity-50 transition-colors duration-150"
              >
                <RotateCw size={11} strokeWidth={1.5} /> Recopy
              </button>
            </div>
            {error && (
              <p className="mt-2 rounded border border-danger/20 bg-danger/10 p-2 text-[11px] text-danger">
                {error}
              </p>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[11px] text-fg-muted">
          <span>
            <Copy size={11} className="mr-1 inline" strokeWidth={1.5} /> Click any field to copy.
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
