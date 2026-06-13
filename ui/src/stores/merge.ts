/**
 * Merge store (M7) — drives the MergeDialog.
 *
 * The store is intentionally lean: most of the state is derived from
 * the `preview` call and the `run` result. There's no polling —
 * the dialog opens → preview → user clicks Merge → execute → show
 * result. Simple, predictable.
 */

import { create } from "zustand";
import { mergePreview, wtMerge } from "@/lib/tauri";
import { type MergePreview, type MergeResult } from "@/lib/types";
import { parseError } from "@/lib/errors";

export type MergePhase =
  | "idle"
  | "previewing"
  | "ready"
  | "running"
  | "done"
  | "resolving" // M8: post-merge conflicts; user is resolving them
  | "error";

interface MergeState {
  phase: MergePhase;
  /** What the user is trying to merge. Set when the dialog opens. */
  context: {
    worktree: string;
    sourceBranch: string;
    targetBranch: string;
  } | null;
  preview: MergePreview | null;
  result: MergeResult | null;
  error: string | null;

  open: (worktree: string, sourceBranch: string, targetBranch: string) => void;
  close: () => void;
  /** Run the preview (called automatically on `open`). */
  runPreview: () => Promise<void>;
  /** Execute the merge via `wt merge <target>`. */
  runMerge: (opts: { noHooks?: boolean; noRemove?: boolean }) => Promise<void>;
  /** Enter the conflict-resolution phase (M8). Called when `done`
   *  with conflicts, or when the user clicks "Open editor" after a
   *  post-hoc failure. */
  enterResolving: () => void;
  /** Re-run `wt merge` after all conflicts are resolved. The
   *  worktree is expected to have a clean index + working tree
   *  before this call. */
  completeMerge: (opts: { noHooks?: boolean; noRemove?: boolean }) => Promise<void>;
}

export const useMergeStore = create<MergeState>((set, get) => ({
  phase: "idle",
  context: null,
  preview: null,
  result: null,
  error: null,

  open: (worktree, sourceBranch, targetBranch) => {
    set({
      context: { worktree, sourceBranch, targetBranch },
      phase: "previewing",
      preview: null,
      result: null,
      error: null,
    });
    void get().runPreview();
  },

  close: () => {
    set({
      phase: "idle",
      context: null,
      preview: null,
      result: null,
      error: null,
    });
  },

  runPreview: async () => {
    const { context } = get();
    if (!context) return;
    set({ phase: "previewing", error: null });
    try {
      const preview = await mergePreview(context.worktree, context.sourceBranch, context.targetBranch);
      set({ preview, phase: "ready" });
    } catch (e) {
      set({ phase: "error", error: parseError(e) });
    }
  },

  runMerge: async (opts) => {
    const { context, preview } = get();
    if (!context || !preview) return;
    set({ phase: "running", error: null });
    try {
      const result = await wtMerge(
        context.worktree,
        context.targetBranch,
        opts.noHooks ?? false,
        opts.noRemove ?? false,
      );
      // If `wt merge` returned conflicts (despite preview saying
      // clean, e.g. dirty workdir), jump to the resolving phase.
      const next = result.conflicts.length > 0 ? "resolving" : "done";
      set({ result, phase: next });
    } catch (e) {
      set({ phase: "error", error: parseError(e) });
    }
  },

  enterResolving: () => set({ phase: "resolving" }),

  completeMerge: async (opts) => {
    const { context } = get();
    if (!context) return;
    set({ phase: "running", error: null });
    try {
      const result = await wtMerge(
        context.worktree,
        context.targetBranch,
        opts.noHooks ?? false,
        opts.noRemove ?? false,
      );
      set({ result, phase: "done" });
    } catch (e) {
      set({ phase: "error", error: parseError(e) });
    }
  },
}));