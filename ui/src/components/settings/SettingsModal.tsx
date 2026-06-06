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
import { wtClearApprovals } from "@/lib/tauri";
import { useRepoStore } from "@/stores/repo";
import { usePrefsStore } from "@/stores/prefs";
import { type VersionInfo } from "@/lib/types";
import { parseError } from "@/lib/errors";
import { Copy, ExternalLink, Eye, EyeOff, RotateCcw, Settings as SettingsIcon, Trash2, X } from "lucide-react";

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const repo = useRepoStore((s) => s.repo);
  const version = useRepoStore((s) => s.version);
  const hideGraphPanel = usePrefsStore((s) => s.hideGraphPanel);
  const setHideGraphPanel = usePrefsStore((s) => s.setHideGraphPanel);
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
      await wtClearApprovals(repo.path);
      setClearResult("All hook approvals cleared. Worktrunk will re-prompt next time.");
    } catch (e) {
      setClearResult(parseError(e));
    } finally {
      setClearBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-panel flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
        style={{
          animation: "modal-scale 200ms cubic-bezier(0.25, 0.1, 0.25, 1.0) forwards",
        }}
      >
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
            <SettingsIcon size={16} className="text-accent" strokeWidth={1.5} /> Settings
          </h2>
          <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-auto p-5 text-[13px]">
          {/* Diagnostics */}
          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              About
            </h3>
            <div className="rounded-md border border-white/[0.06] bg-bg p-3 text-[11px]">
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
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Hook approvals
              </h3>
              <div className="rounded-md border border-white/[0.06] bg-bg p-3 text-[11px]">
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
                    className="flex items-center gap-1 rounded-md border border-danger/20 bg-danger/10 px-2 py-1 text-danger hover:bg-danger/20 disabled:opacity-50 transition-colors duration-150"
                  >
                    <Trash2 size={11} strokeWidth={1.5} /> Clear all
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Layout */}
          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Layout
            </h3>
            <div className="rounded-md border border-white/[0.06] bg-bg p-3 text-[11px]">
              <p className="text-fg-muted">
                The 3-pane widths and the terminal strip height are remembered
                across sessions. Reset to return to the defaults.
              </p>
              <button
                onClick={resetLayout}
                className="mt-2 flex items-center gap-1 rounded-md border border-white/[0.08] bg-bg-panel px-2 py-1 text-fg-muted hover:border-accent/50 hover:text-fg transition-colors duration-150"
              >
                <RotateCcw size={11} strokeWidth={1.5} /> Reset to defaults (reloads)
              </button>
            </div>
          </section>

          {/* View */}
          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              View
            </h3>
            <div className="rounded-md border border-white/[0.06] bg-bg p-3 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-fg">Show graph &amp; file panel</p>
                  <p className="mt-0.5 text-fg-muted">
                    When hidden, the worktree list stays as a thin sidebar and
                    the terminal takes the rest of the view. Useful on small
                    windows or when you only need the worktree list and a shell.
                  </p>
                </div>
                <button
                  onClick={() => setHideGraphPanel(!hideGraphPanel)}
                  className={
                    hideGraphPanel
                      ? "flex shrink-0 items-center gap-1 rounded-md border border-white/[0.08] bg-bg-panel px-2 py-1 text-fg-muted hover:border-accent/50 hover:text-fg transition-colors duration-150"
                      : "flex shrink-0 items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-accent hover:border-accent/50 transition-colors duration-150"
                  }
                  aria-pressed={!hideGraphPanel}
                >
                  {hideGraphPanel ? (
                    <>
                      <EyeOff size={11} strokeWidth={1.5} /> hidden
                    </>
                  ) : (
                    <>
                      <Eye size={11} strokeWidth={1.5} /> visible
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* Docs */}
          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Resources
            </h3>
            <ul className="space-y-1 text-[11px]">
              <li>
                <a
                  href="https://worktrunk.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-accent hover:underline transition-colors duration-150"
                >
                  worktrunk.dev <ExternalLink size={10} strokeWidth={1.5} />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/max-sixty/worktrunk"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-accent hover:underline transition-colors duration-150"
                >
                  worktrunk on GitHub <ExternalLink size={10} strokeWidth={1.5} />
                </a>
              </li>
            </ul>
          </section>
        </div>

        <footer className="flex items-center justify-end border-t border-white/[0.06] px-4 py-2">
          <button
            onClick={onClose}
            className="rounded-md border border-white/[0.08] bg-bg-panel px-3 py-1.5 text-[11px] hover:border-white/[0.12] transition-colors duration-150"
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
      <span className="w-24 shrink-0 text-fg-muted">{label}</span>
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
            className="ml-1 inline-flex items-center rounded p-0.5 text-fg-muted hover:bg-white/[0.04] hover:text-fg transition-colors duration-150"
          >
            <Copy size={10} strokeWidth={1.5} />
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