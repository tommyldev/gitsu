/**
 * Remove-worktree dialog. Mirrors the safety UX of `wt remove`:
 *   - Default behavior: refuse if the worktree is dirty (user must
 *     commit/stash/discard first).
 *   - "Also delete branch" checkbox — the typical workflow after a
 *     successful merge.
 *   - Typed-confirmation gate for destructive operations on the
 *     main worktree.
 */

import { useState } from "react";
import { Button, Pill } from "@/components/ui/primitives";
import { wtRemove } from "@/lib/tauri";
import { useRepoStore } from "@/stores/repo";
import { type RemoveResult, type Worktree } from "@/lib/types";
import { parseError } from "@/lib/errors";
import { AlertTriangle, Trash2, X } from "lucide-react";

interface Props {
  worktree: Worktree;
  onClose: () => void;
  /** `wt remove` always returns a JSON array of one-or-more entries
   *  (one per thing removed). We pass the full array through; the
   *  dialog itself doesn't read it. */
  onRemoved?: (r: RemoveResult[]) => void;
}

export function RemoveWorktreeDialog({ worktree, onClose, onRemoved }: Props) {
  const { repo, refresh } = useRepoStore();
  const isMain = worktree.is_main;
  const isDirty = !!worktree.working_tree &&
    (worktree.working_tree.staged || worktree.working_tree.modified || worktree.working_tree.untracked);
  const isCurrent = worktree.is_current;

  const [deleteBranch, setDeleteBranch] = useState(true);
  const [force, setForce] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Main worktrees can't be removed — worktrunk enforces this. Just
  // show a friendly error and bail.
  // Detached-HEAD worktrees also can't be removed through this dialog
  // because `wt remove` takes a branch name, and a detached worktree
  // has none. The trash icon is hidden in the worktree list for these
  // (see `WorktreeList.tsx`); this guard is defense in depth in case
  // the dialog is opened via some other path.
  const isDetached = !worktree.branch;
  const blockedReason = isMain
    ? "This is the main worktree. The main worktree is always the repo's anchor and cannot be removed."
    : isCurrent
      ? "This is the currently active worktree. Switch to another worktree first, then remove this one."
      : isDetached
        ? "Detached worktrees have no branch and can't be removed through this dialog. Use the terminal to clean it up with `git worktree remove`."
        : null;

  const needsForce = isDirty && !force;
  const needsTypeGate = isMain || isCurrent; // shouldn't get here, but be safe
  const canSubmit = !blockedReason && !needsForce && !needsTypeGate && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo) return;
    // `worktree.branch` is `string | null` per the `Worktree` type.
    // The dialog's submit button is disabled when `blockedReason` is
    // set (which covers the detached case), but guard here too — if
    // the dialog is somehow triggered with a null branch, fail loudly
    // instead of letting Tauri reject the args with a confusing
    // "invalid type: null, expected a string" error.
    if (!worktree.branch) {
      setError("Cannot remove a worktree with no branch (detached HEAD).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await wtRemove(repo.path, worktree.branch, deleteBranch, force);
      onRemoved?.(result);
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
            <Trash2 size={18} className="text-danger" strokeWidth={1.5} /> Remove worktree
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-white/[0.04] transition-colors duration-150">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <p className="text-[13px] text-fg-muted">
            You're about to remove the worktree for{" "}
            <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-[12px] text-fg">{worktree.branch}</code>.
          </p>

          {blockedReason ? (
            <div className="flex items-start gap-2 rounded-md border border-warning/20 bg-warning/10 p-3 text-[13px] text-warning">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
              <span>{blockedReason}</span>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={deleteBranch}
                  onChange={(e) => setDeleteBranch(e.target.checked)}
                  className="h-4 w-4 rounded border-white/[0.08] bg-bg accent-accent"
                />
                <span className="text-fg">
                  Also delete branch <code className="font-mono text-[11px]">{worktree.branch}</code>
                </span>
              </label>

              {isDirty && (
                <div className="flex items-start gap-2 rounded-md border border-warning/20 bg-warning/10 p-3 text-[13px] text-warning">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
                  <div>
                    <p className="mb-1">This worktree has uncommitted changes.</p>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={force}
                        onChange={(e) => setForce(e.target.checked)}
                        className="h-4 w-4 rounded border-white/[0.08] bg-bg accent-danger"
                      />
                      <span>Force remove (discard uncommitted changes)</span>
                    </label>
                  </div>
                </div>
              )}

              {isDirty && force && (
                <label className="block text-[13px]">
                  <span className="mb-1.5 block text-fg-muted text-[12px]">
                    Type <code className="font-mono text-danger">{worktree.branch}</code> to confirm
                  </span>
                  <input
                    className="input font-mono text-[13px]"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={worktree.branch ?? "branch"}
                  />
                </label>
              )}
            </>
          )}

          {error && (
            <p className="rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3.5">
          <Pill tone="default">{worktree.path}</Pill>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={!canSubmit || (isDirty && force && typed !== worktree.branch)}
            >
              {busy ? "Removing…" : "Remove"}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}