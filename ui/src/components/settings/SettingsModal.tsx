/**
 * Settings modal (M9) — global app preferences.
 *
 * v1 is intentionally minimal:
 *   - wt version + sidecar binary path (diagnostics)
 *   - Layout reset (clear localStorage; resizable panes remember
 *     their widths across sessions via the repo store)
 *   - Clear all hook approvals (M6)
 *
 * Future expansion: theme, keybind overrides, worktree path
 * template, default merge target, telemetry opt-in.
 */

import { useState } from "react";
import { invoke } from "@/lib/tauri";
import { useRepoStore } from "@/stores/repo";
import { WtRpcError, type IpcError, type VersionInfo } from "@/lib/types";
import { Copy, ExternalLink, RotateCcw, Settings as SettingsIcon, Trash2, X } from "lucide-react";

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const repo = useRepoStore((s) => s.repo);
  const version = useRepoStore((s) => s.version);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const resetLayout = () => {
    // The current layout widths are stored in component state. The
    // simplest reset is a page reload — the user accepts that as a
    // one-time action.
    if (confirm("Reset layout to defaults? This reloads the app.")) {
      window.location.reload();
    }
  };

  const clearApprovals = async () => {
    if (!repo) return;
    setClearBusy(true);
    setClearResult(null);
    try {
      await invoke<string>("wt_clear_approvals", { repo: repo.path });
      setClearResult("All hook approvals cleared. Worktrunk will re-prompt next time.");
    } catch (e) {
      setClearResult(parseError(e));
    } finally {
      setClearBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-bg-subtle bg-bg-panel shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-bg-subtle px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <SettingsIcon size={16} className="text-accent" /> Settings
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-subtle">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-auto p-4 text-sm">
          {/* Diagnostics */}
          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              About
            </h3>
            <div className="rounded-md border border-bg-subtle bg-bg p-3 text-xs">
              <Row label="gitsu version">0.1.0</Row>
              {version && <WorktrunkInfo version={version} />}
              <Row label="worktree">
                {repo ? (
                  <code className="font-mono">{repo.path}</code>
                ) : (
                  <span className="text-fg-muted">none open</span>
                )}
              </Row>
            </div>
          </section>

          {/* M6: hook approvals */}
          {repo && (
            <section>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                Hook approvals
              </h3>
              <div className="rounded-md border border-bg-subtle bg-bg p-3 text-xs">
                <p className="text-fg-muted">
                  When worktrunk runs a project hook for the first time, it asks for approval.
                  Approvals are saved in <code className="font-mono">~/.config/worktrunk/approvals.toml</code>.
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-fg-subtle">
                    {clearResult ?? "Re-clear to re-prompt next time."}
                  </span>
                  <button
                    onClick={clearApprovals}
                    disabled={clearBusy}
                    className="flex items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-danger hover:bg-danger/20 disabled:opacity-50"
                  >
                    <Trash2 size={11} /> Clear all
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Layout */}
          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Layout
            </h3>
            <div className="rounded-md border border-bg-subtle bg-bg p-3 text-xs">
              <p className="text-fg-muted">
                The 3-pane widths and the terminal strip height are remembered
                across sessions. Reset to return to the defaults.
              </p>
              <button
                onClick={resetLayout}
                className="mt-2 flex items-center gap-1 rounded-md border border-bg-subtle bg-bg-panel px-2 py-1 text-fg-muted hover:border-accent hover:text-fg"
              >
                <RotateCcw size={11} /> Reset to defaults (reloads)
              </button>
            </div>
          </section>

          {/* Docs */}
          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Resources
            </h3>
            <ul className="space-y-1 text-xs">
              <li>
                <a
                  href="https://worktrunk.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-accent hover:underline"
                >
                  worktrunk.dev <ExternalLink size={10} />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/max-sixty/worktrunk"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-accent hover:underline"
                >
                  worktrunk on GitHub <ExternalLink size={10} />
                </a>
              </li>
            </ul>
          </section>
        </div>

        <footer className="flex items-center justify-end border-t border-bg-subtle px-4 py-2">
          <button
            onClick={onClose}
            className="rounded-md border border-bg-subtle bg-bg-panel px-3 py-1.5 text-xs hover:border-bg-subtle"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-start gap-2 last:mb-0">
      <span className="w-24 shrink-0 text-fg-subtle">{label}</span>
      <span className="flex-1 text-fg">{children}</span>
    </div>
  );
}

function WorktrunkInfo({ version }: { version: VersionInfo }) {
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch((e) => console.warn("clipboard", e));
  };
  return (
    <>
      <Row label="wt version">
        <code className="font-mono">{version.wt || "—"}</code>
        {version.path && (
          <button
            onClick={() => copy(version.path!)}
            title="Copy sidecar path"
            className="ml-1 inline-flex items-center rounded p-0.5 text-fg-subtle hover:bg-bg-subtle hover:text-fg"
          >
            <Copy size={10} />
          </button>
        )}
      </Row>
      {version.path && (
        <Row label="sidecar path">
          <code className="font-mono text-[10px]">{version.path}</code>
        </Row>
      )}
    </>
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
